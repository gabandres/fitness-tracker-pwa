# The fasting Live Activity draws its own timer, and reconciles instead of reacting

## Status

proposed (2026-08-08) — **the code exists and nothing has run it.** No Live
Activity has been started on a simulator or a device. This ADR records the
decisions and their reasoning so they survive the first thing that goes wrong;
it does **not** claim the feature works. `STATUS.md` owns that, and will say so
only once a Lock Screen has actually counted.

Covers the backlog item `UX_AUDIT.md` §S15 calls **N3** (Fasting Live Activity /
Dynamic Island). iOS-only. Extends the fasting timer already shipped free, which
Cronometer paywalls at $59.99/yr.

Depends on [ADR-0020](0020-quick-add-native-write-path.md) for one thing only —
the wall it documents between an Expo Module and `targets/_shared/`, which this
hits again and solves differently. It shares **no** mechanism with it: N1 was App
Intents, this is ActivityKit, and none of that knowledge transfers.

## Context

Fasting state in this app is **one field**: `profile.fastStartedAt`
(`Timestamp | null`, `packages/core/src/types.ts`). Both frontends read and write
it, `DailyMetrics` counts elapsed time from it, and there is no goal, no
schedule, and no history. That is the whole domain.

That simplicity is the opportunity. Every other glanceable surface this app has
is a **snapshot**: the app computes numbers, writes a blob into the App Group,
and asks WidgetKit to reload (`WIDGET.md`). Snapshots go stale, which is why
`Glance.load` carries a staleness guard and why the widget's most dangerous
possible bug is rendering yesterday's calories as today's.

A fast is not a snapshot. It is an elapsed timer from a fixed start date, and a
timer has a property nothing else here has: **the device can compute it without
being told anything.**

## Decision

### 1. Nothing is ever pushed to the Live Activity

`Text(timerInterval:)` renders a live-updating timer that SwiftUI redraws from
the system clock, on-device. Apple documents `TimeDataSource` as built for
exactly this — "Widgets, Live Activities and watchOS Complications … update
automatically without manual state management."

So the Activity is started once and ended once. There is no push token
(`pushType: nil`), no APNs, no background refresh, no Cloud Function, no new
secret, and no new Firestore field. `ContentState` is **empty**, because there is
genuinely nothing to update.

This is what makes N3 cost $0 at runtime, which `CLAUDE.md`'s cost discipline
requires and which is the reason it was approved. The moment a field appears in
`ContentState` that something has to push, that stops being true — so
`src/__tests__/fast-activity-contract.test.ts` asserts `pushType: nil` and the
absence of `.token`. It is a cheap guard on the one property that justifies the
feature.

### 2. The eight-hour ceiling is accepted, not worked around

iOS ends a Live Activity **8 hours** after it starts, removes it from the Dynamic
Island then, and drops it from the Lock Screen 4 hours later. A 16:8 fast
outlives both. An Activity can only be *requested* with the app in the
foreground, so there is no background hook that could extend or replace one.

There is no workaround. Every scheme that keeps a Lock Screen alive past 8 hours
requires either the user opening the app or a push, and a push is the thing
decision 1 exists to avoid.

What makes it survivable is that `startedAt` in the attributes is **the fast's
true start, not the Activity's**. Re-requesting produces a timer at the correct
elapsed time rather than one restarting from zero. So the feature's honest shape
is:

> A fast shows a Lock Screen timer for as long as the app has been opened within
> the last 8 hours, and shows nothing otherwise.

That is stated in the code, in this ADR, and should be stated to testers. It is a
property of ActivityKit, not a defect to be fixed in a later build — and writing
it down now is what stops a future session from scoping "fix the disappearing
Live Activity" as work.

### 3. Reconcile against Firestore; do not react to start/break

The obvious wiring — start the Activity in `startFast`, end it in `breakFast` —
is wrong here, because **three** things change the truth without emitting an
event this app can observe:

1. the 8-hour ceiling ending the Activity;
2. the user swiping it away, which is always allowed;
3. the **web PWA**, which writes the same `profile.fastStartedAt` — so a fast can
   be broken and restarted while this app is closed, leaving a Lock Screen
   counting from an instant nothing would ever correct.

So `src/lib/fast-activity.ts` reconciles: read what iOS is showing, compare it
against what Firestore says, fix the difference. `useFastActivity` runs it on
mount, on any change to the fast or the locale, and on every foreground — the
same three-trigger shape `useWidgetSync` already uses, for the same reason.

Reconciling requires reading a running Activity's attributes back, which JS
cannot otherwise do (they are immutable and not exposed). Hence the status call
returns `running:<startedAtEpochMillis>:<locale>` rather than a bare `running`.
Without the payload the reconciler would find "running", conclude there was
nothing to do, and case 3 above would be permanent.

### 4. It lives in the existing widget extension, not a new target

A Live Activity is a WidgetKit widget with an `ActivityConfiguration`, and
`Today.appex` is already a WidgetKit extension with the App Group and the iOS 17
floor this needs. A second extension would mean another target, another
entitlement set, another `expo-target.config.js`, and another thing to verify
nested in the `.ipa` — for nothing, since the two faces share no code but do
share a host. `targets/widget/index.swift`'s `@main` is therefore a
`WidgetBundle` as of N3, and adding a widget is now one line in it.

### 5. The attributes have ONE declaration, and the Expo Module reaches it at runtime

`Activity.request` needs `FastActivityAttributes`, and it must be the same type
the widget extension renders against. Apple's arrangement is one source file with
two target memberships — the app and the extension, which are already two
distinct Swift modules. `targets/_shared/` is this repo's version of that and the
only directory that reaches both.

An Expo Module is neither. It is a CocoaPods target and **cannot see `_shared`** —
the wall `QuickAddCredentialsModule.swift` and `modules/watch-link` document, and
the one ADR-0020's amendment settled for a compromise on.

Two options, and the choice is about which failure is detectable:

- **Declare a second copy of the attributes in the pod.** ActivityKit matches
  these by name, so it would very likely work. But two declarations are free to
  drift, and drift would be invisible until a device showed no Lock Screen.
- **Reach the app target through the Objective-C runtime.** All three targets link
  into one binary, so `NSClassFromString("IgniaFastActivity")` resolves at runtime
  with no build-time dependency in either direction.

The second was chosen. It keeps one declaration of the type, and it moves the
coupling from *two structs that must stay identical* to *four strings that must
match* — which a test can check, and which
`src/__tests__/fast-activity-contract.test.ts` does. The `@objc(...)` names are
pinned explicitly on both sides rather than synthesised, so Swift name mangling
cannot move them.

This is deliberately the same trade `QuickAddCredentialsModule` makes with its
Keychain `SERVICE`/`ACCOUNT` constants: an agreement by convention, written down
on both sides, with the failure mode named. Here the failure mode is that the
fast still starts, Firestore is still written, and the Lock Screen simply stays
empty — silent, exactly like build 27.

## Consequences

**It needs a binary.** `NSSupportsLiveActivities` goes in the app's `Info.plist`
via `app.json` → `ios.infoPlist`, which **is** hashed into the fingerprint. Swift
under `targets/` is not (`apps/mobile/AGENTS.md`), so the `app.json` line is what
moves it — but the Swift is what matters, and no OTA can ever carry it.

**Nothing on a build machine can prove it works.** The compile proves the Swift is
well-formed; `Metadata.appintents` proved as much for build 27's dead Siri
support. The contract test proves four strings match, not that ActivityKit starts
anything. **The first real evidence is a Lock Screen counting**, on a simulator or
a device. Until then every status doc must say unverified.

**It is verifiable without spending a build.** Live Activities render in the iOS
Simulator, so the bridge and both faces can be exercised on `ignia-mac` at no
quota and no queue. This is the first native surface in this repo with that
property — App Intents needed real hardware — and it is why `WIDGET.md`'s
one-untested-native-surface-per-binary rule does not have to hold N3 behind build
29's unverified Siri phrases.

**Android gets nothing.** There is no Android equivalent; an ongoing notification
is a different mechanism with a different cost and is not in scope. This is a
deliberate, temporary break from the bidirectional-parity rule in `CLAUDE.md`,
for the same reason the Quick Settings tile was iOS-less: the platforms genuinely
differ here.

**The web PWA gets nothing**, and cannot. It is also the reason decision 3 exists
rather than simple event wiring.

**`ContentState` being empty is load-bearing.** Adding a field to it is the moment
this feature acquires a cost. Anything that wants to push state — a goal, a
progress ring, a "you can eat now" alert — is a new decision, not an increment,
and belongs in an amendment here.
