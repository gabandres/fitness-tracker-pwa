# A watch push parks instead of dropping, and the widget's intent runs in the app

## Status

**accepted (2026-08-14) — code exists, BEHAVIOUR UNVERIFIED.** This ADR records
the decisions and their reasoning; it does not claim the watch updates. That
claim belongs to `STATUS.md` and may only be made once a complication has been
watched to move on a wrist after a meal logged with the app closed.

That caveat is not boilerplate here. Two speculative fixes were shipped to this
exact surface on 2026-08-13 and neither was distinguishable from the other on
the device, which is why half of what this ADR decides is instrumentation.

Amends [ADR-0020](0020-quick-add-native-write-path.md), whose "where `perform()`
runs" claim was half wrong and cost two bugs. Depends on the WatchConnectivity
transport built in #37/#38/#44 and on the two-queue assert from 2026-08-10.
Depends on [ADR-0021](0021-fasting-live-activity.md) for one incidental fact:
`NSSupportsLiveActivities` is already declared, which the intent routing below
requires.

## Context

The complication updated after a meal logged **in the app's foreground**, and
only then. Measured on the owner's iPhone against build 49 with a paired watch:

| How the meal was logged | Phone widget | Watch |
|---|---|---|
| In-app (foreground) | ✅ | ✅ |
| Siri, app cold | ✅ | ❌ |
| Siri, app "open in background" | ✅ | ❌ |
| Widget quick-add chip | ✅ | ❌ |

One symptom, and the temptation is to look for one cause. There are two, and
they are not the same kind of thing.

### Cause 1 — "cannot" and "not yet" were the same branch

`QuickAdd.assertToWatch` guarded on `session.activationState == .activated` and
returned silently otherwise. That guard was written to express an Apple
limitation, and it did — but it also swallowed a completely different case.

`WatchLinkModule` owns `WCSession.default` and activates it at app launch.
**Activation is asynchronous**: `activate()` returns immediately and the state
flips later, on `session(_:activationDidCompleteWith:)`. An App Intent performed
on a cold or background launch runs inside that window. So the guard's answer
there was not *no*, it was *not yet* — and it returned as though it were *no*,
skipping the complication transfer **and** the cheaper application context, so
nothing whatsoever reached the watch.

This is the whole of the Siri story, and Siri-with-the-app-closed is precisely
what Siri quick-add exists for. The path that was hardest to reach was the one
the feature was built for.

### Cause 2 — a widget chip cannot reach a watch from where it runs

`WCSession` does not exist in an iOS app extension. Apple's limitation,
documented, not negotiable. `LogQuickAddSlotIntent` lives in `targets/_shared/`,
which `@bacons/apple-targets` globs into every target, so `Today.appex` carries
its own copy and WidgetKit performs **that** one, in the extension's process.

No amount of care inside `assertToWatch` can fix this. The framework is absent.

ADR-0020's own doc comment asserted the opposite — *"App Shortcuts declared in
the app target are performed by launching the app in the background, and so is a
widget `Button(intent:)`"* — and the second half of that sentence has now cost
two bugs. The first was the keychain: a process cannot reach another's default
keychain group, so every widget tap returned `.signedOut` and did nothing at
all, on six shipped binaries, with nothing anywhere recording it. The second is
this one.

## Decision

### 1. Park the envelope before waiting, not after failing

`assertToWatch` writes the envelope into the App Group under
`Glance.watchPendingKey` **first**, then waits up to 3s for the session to
activate, then sends over both queues, then clears the park.

Parking first is the load-bearing ordering. Parking on failure leaves a race:
activation completing between the wait's timeout and the park write means the
drain never fires and the push is lost — the same bug, in a narrower window,
which is the worst kind to ship because it reproduces once a week.

Latest-wins, exactly like the application context it mirrors. A second park
overwrites the first, because the only question this transport ever answers is
"what should the wrist show now".

### 2. Wait for the owner; never activate, never take the delegate

The constraint that shaped the old code is unchanged and is worth restating,
because it is the thing every obvious fix breaks: a second `WCSessionDelegate`
here would silently displace `WatchLinkModule`'s and break the re-assert that
keeps a newly-paired watch in step. So this only ever *waits*.

Polling `activationState` every 50ms is not a shortcut, it is the consequence:
this file may not have the callback, so it has to ask. The wait gives up early
if no delegate has been claimed after 500ms — nobody is going to activate the
session, and holding a Siri reply for the full budget to discover that is worse
than answering.

3s is generous against activation, which normally completes in well under a
second, and small against a Siri intent's budget before its reply looks slow.
**Only a cold launch pays any of it**; the warm path does not wait at all.

### 3. Drain the park natively, on activation — not in JS

`WatchLinkSession.drainPending()` runs from
`session(_:activationDidCompleteWith:)` and from `sessionWatchStateDidChange`.

The alternative was a JS drain on app start, and it was rejected on timing.
Activation completes milliseconds after the park, well before React Native has
finished booting and long before any screen mounts. Draining in JS would convert
a millisecond gap into a multi-second one — which is exactly the eventual
consistency this change exists to end. The requirement was real-time.

The cost is that `watch-link` gains two storage constants and stops being a
strictly dumb pipe. This is smaller than it looks: the parked value is the same
opaque one-key envelope the module already forwards without inspecting, read as
`[String: String]` and handed straight to `assert`. Nothing decodes a snapshot;
the wire shape still lives entirely in `Glance.swift`. Two constants duplicated
by convention across the CocoaPods/apple-target wall is the same trade ADR-0020
already made for the keychain service, account and access group.

**Drain before re-assert.** The park is the newer fact — an intent wrote it
moments ago, in this launch — while `desired` on a cold launch is nothing at all.

### 4. The widget's intent runs in the app's process (`LiveActivityIntent`)

`LogQuickAddSlotIntent` conforms to `LiveActivityIntent`, which is Apple's
documented lever for making the system perform an app intent in the **app's**
process, launching the app in the background when it is not running.

Three protocols force app-process execution. `ForegroundContinuableIntent` is
unavailable in extensions and continues in the *foreground*, which would defeat
a one-tap chip. `AudioPlaybackIntent` is a lie about what this app does.
`LiveActivityIntent` is accurate enough — this app ships a Live Activity (N3)
and declares `NSSupportsLiveActivities`, which the routing requires.

It also retires the shared keychain access group as the *load-bearing* half of
ADR-0020's amendment: in the app's process the credential is simply there. The
group stays regardless — an extension-performed fallback has to keep working,
and every envelope written before the group existed still lives in the app's
default keychain.

The conformance is declared in an `#if os(iOS)` extension rather than on the
struct. `_shared` is globbed into the **watch** targets too, and
`LiveActivityIntent`'s watchOS availability is not a fact worth discovering by
spending a build. Extension-declared conformance is what Apple's metadata
extractor reads, so it routes identically.

### 5. Record which guard fired, and which process ran

Every push writes `{outcome, atMs, process}` to `Glance.watchAssertKey` in the
App Group. `WatchDiagnosticsCard` renders it raw.

Outcomes: `sent`, `sent:after-wait`, `parked:appex`, `parked:not-activated`,
`skipped:unsupported`.

This is the half that makes the next device test a **reading** rather than
another speculative build. From the wrist all five look identical — a number
that did not move — and there is no other channel: sentry-cocoa does not support
iOS widgets (getsentry/sentry-cocoa#3695), throws inside them (#3513), and
app-extension reports often never upload (#1656). The extension's silence is not
information. The App Group is the only thing both processes can see.

`process` is the load-bearing field, and it is what falsifies decision 4: a chip
tap reporting `parked:appex` means the `LiveActivityIntent` routing did not take.

## Consequences

**The risk, stated plainly.** Decision 4 changes where a **shipped** button
runs. If the system declines to launch the app for this intent, the tap does
nothing at all rather than logging from the extension — a regression to the
build 27–32 behaviour, on a surface that has already been broken for six
binaries once. Decision 5 exists because of decision 4: one device test now
names the process instead of costing another build to guess.

**JS bounds the park's staleness, and only that.** `assertWatchSnapshot` and
`persist()` clear the pending key after asserting, because anything JS asserts
is strictly newer. Without it, a park made on a phone with no watch survives
until a watch is paired — an event that fires `sessionWatchStateDidChange` and
drains it verbatim, days late. The day-key guard in `Glance.swift` is the
backstop that makes that degrade to the empty face instead of presenting
yesterday's calories as today's, and it should stay a backstop.

**A duplicate delivery is a no-op by construction.** The payload is latest-wins
and `WatchLinkSession.assert` dedupes against the live application context, so a
park draining after a successful send costs nothing — not a wake, not one of the
day's 50 complication transfers, and certainly not a second meal.

**This needs a binary.** Swift under `modules/` moves the fingerprint (measured
2026-08-10) and Swift under `targets/` does not move it while still requiring a
build — so no OTA carries any of this, and the gate's answer is the wrong
question. Say which cohort out loud when reporting.

**Android has none of this.** The Android widget and its complication have never
been watched working on a device at all, which is a separate open item and not
this ADR's scope.

## Alternatives rejected

**Activate the session from the intent.** The obvious fix, and it breaks the
re-assert that keeps a newly-paired watch in step — the constraint the old code
was written around. Waiting achieves the same thing without owning anything.

**A silent push to wake the watch.** Server-triggered complication updates would
work from any process, and they cost a Cloud Function on every meal logged, on a
billing account whose largest line item is already storage nobody is watching.
The failure mode this repo has is forgotten recurring cost, not latency.

**Instrumentation first, fix later.** The 2026-08-13 session ended recommending
exactly this, and it is right about the diagnosis order. It is wrong about the
sequencing here for one reason: `targets/`/`modules/` Swift cannot ship over the
air, so instrumentation alone would have cost a full build and a TestFlight
round trip to learn one fact. Both ship together, and the instrumentation is
built to falsify the fix rather than to confirm it.
