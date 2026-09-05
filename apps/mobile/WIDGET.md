# Glanceable surfaces — design, seams and device QA

> **This file owns the *design* of every surface that renders the widget
> snapshot: how it gets its data, what was decided, and how to verify it on
> hardware. It does not track state.** Whether a surface is built, in a binary,
> or verified is in **`STATUS.md`**, which has the command to re-check. Do not
> restate build or quota status here — this doc carried a "BUILT, unverified"
> banner and an EAS quota date, and both were the kind of claim that goes stale
> silently.

Scope: **today's calories + protein remaining**, on every surface that can show
them without opening the app — the iOS home-screen widget, the three iOS Lock
Screen accessory families, the Android home-screen widget, the Apple Watch
complication, and the watch's one read-only screen. All render the same
last-known snapshot the app writes on each log. Runtime cost: **$0** (local
shared storage and, on the watch, WatchConnectivity — no network, no auth, no
Cloud Function anywhere in the chain).

Expo has **no built-in widget support** — widgets are OS-native extensions, so
this is the most native-heavy of the pipeline features (iOS needs Swift).

## The core constraint: widgets can't run our data layer
A widget process cannot hold our Firestore `onSnapshot` subscriptions — it wakes
briefly on an OS timeline and reads whatever's already on disk. So the pattern
is **snapshot, not subscribe**:

1. The app computes today's numbers (it already does — `useToday` exposes
   `summary: DaySummary` via `summarizeDay(todayKey, logs, weights)` and
   `targets: DailyTargets` via `dailyTargets(...)`).
2. On every relevant change (log add/edit/delete, app foreground, day rollover),
   the app writes a tiny JSON snapshot to **storage shared with the widget**.
3. The widget reads that snapshot on its refresh timeline and renders it.

Snapshot shape (pure, put the builder in `packages/core` so both platforms and
any future web-equivalent agree):
```ts
// packages/core/src/widget-snapshot.ts (NEW)
export interface WidgetSnapshot {
  dateKey: string;          // guard against showing yesterday after midnight
  kcalConsumed: number;
  kcalTarget: number;
  proteinConsumed: number;
  proteinTarget: number;
  updatedMs: number;
}
export function buildWidgetSnapshot(
  summary: DaySummary, targets: DailyTargets, dateKey: string, nowMs: number,
): WidgetSnapshot { /* ... */ }
```
The widget renders "kcalTarget − kcalConsumed left" and a ring =
`kcalConsumed / kcalTarget`. If `snapshot.dateKey !== today`, show an empty/zero
state (the app hasn't been opened yet today) rather than stale numbers.

## iOS
- **Integration:** [`@bacons/apple-targets`](https://github.com/EvanBacon/expo-apple-targets)
  (expo-apple-targets) config plugin — lets us add a **WidgetKit** extension
  target to the managed Expo project without ejecting. The widget UI is
  **SwiftUI** (Swift, hand-written — there's no JS escape hatch on iOS).
- **Shared storage:** an **App Group** (`group.fit.ignia.app`). The RN side
  writes the snapshot JSON to the App Group's shared `UserDefaults` via
  `ExtensionStorage` (from `@bacons/apple-targets`); the Swift widget reads the
  same key back.
- **Refresh:** WidgetKit `TimelineProvider` — `ExtensionStorage.reloadWidget`
  on our write, plus a pre-scheduled midnight entry as the backstop for the one
  moment nothing pushes.
- **Families:** `.systemSmall` on the Home Screen, and
  `.accessoryCircular` / `.accessoryRectangular` / `.accessoryInline` on the
  Lock Screen. `.accessoryCorner` is deliberately absent — it is the only family
  with no Lock Screen counterpart, so it would be the only net-new layout.
- **Owner gate:** the widget-extension target + App Group capability must be
  registered on the `fit.ignia.app` App id in the Apple Developer portal.

## Android
- **Integration:** [`react-native-android-widget`](https://saleksovski.github.io/react-native-android-widget/)
  — widgets are defined in **JS/TSX** (no Kotlin needed for the UI), which makes
  Android markedly cheaper than iOS here.
- **Shared storage:** the library's task handler runs in a JS context and can
  read the same snapshot the app persists (AsyncStorage / a file). Write the
  snapshot on log change; call the library's `requestWidgetUpdate` after writes.
- **Refresh:** on-demand via `requestWidgetUpdate` + an `updatePeriodMillis`
  backstop (Android clamps this to ≥30 min — fine for a "remaining" display).
- **Every widget component must start with `'use no memo';`.** `app.json` sets
  `experiments.reactCompiler: true`, and the React Compiler rewrites any
  PascalCase function returning JSX to call `useMemoCache`. This library never
  mounts widgets in a React renderer — `buildWidgetTree` invokes the component
  as a **raw function** — so the injected hook throws
  `Invalid Hook Call detected in <Name>` and the widget draws **nothing**: a
  transparent empty box, no background, no text.

  **This shipped broken in Android vc 4, 6 and 8** and was invisible for a
  month. `tsc` passes, jest passes, `expo export` bundles cleanly, and the
  widget appears in the picker and places normally — the failure is entirely at
  render time inside the widget task handler. It was found on 2026-08-06 the
  first time anyone put the widget on a home screen, and diagnosed from
  **Sentry**, which is the only place the throw surfaces. Enforced by
  `src/__tests__/widget-no-memo.test.ts`.

## Apple Watch

The complication is the same shape as the iPhone widget, one hop further out —
and that hop is the whole design problem. **App Groups are per-device**, so the
watch cannot read the container the phone writes. Decisions live on the #31 map
(#33, #37, #38, #39, #40, #43, #44); this is the shape they landed on.

- **Transport: BOTH WatchConnectivity queues, since 2026-08-10.** $0, no auth.
  Reading Firestore on the watch is **structurally unavailable** — Firebase's
  own platform matrix has a blank watchOS cell for Cloud Firestore.
  `sendMessage` does not wake the counterpart.
  - `transferCurrentComplicationUserInfo` — the **waking** path, and the only
    one Apple documents as reaching a watch app that is backgrounded or has
    never been opened. Requires `isComplicationEnabled` (**false in the Smart
    Stack**, true on a face) and is capped at **50/watch/day**
    (`remainingComplicationUserInfoTransfers`). Arrives at
    `session(_:didReceiveUserInfo:)`.
  - `updateApplicationContext` — the **durable** path. Latest-wins, never
    queues, and readable later as `receivedApplicationContext` by a watch app
    that starts after delivery. Arrives at
    `session(_:didReceiveApplicationContext:)`.
  - Both carry the identical envelope into the same `store()`, so there is one
    decode path and one staleness guard; a double delivery writes identical
    bytes twice. The phone's `sameContext` dedupe gates both, which is what
    protects the hard 50/day.
  - **Why it is not `updateApplicationContext` alone any more.** That was the
    whole transport until 2026-08-10 and it is why the face went stale: Apple
    delivers it opportunistically and it does not reliably wake a sleeping
    watch app. No wake → no App Group write → the complication has nothing new,
    and the hourly re-ask in its timeline cannot help because it re-reads the
    same container. WidgetKit push carries no payload, so it is not a
    substitute either.
- **The payload is a one-key envelope** carrying the *already-serialized*
  snapshot JSON, byte-identical to what `ExtensionStorage` writes. Sending the
  eight fields as a native dictionary would have created a second decode path in
  Swift and made the dictionary's key set a third thing to keep in step.
- **The watch app is link 2 of the transport, not decoration.** WatchConnectivity
  delivers to the app, never to a complication, so the app owns the `WCSession`
  delegate, the `.backgroundTask(.watchConnectivity)`, the App Group write and
  the `reloadAllTimelines`. Its one screen is additive to a job it must do
  regardless — and a watch binary whose only screen is empty is the
  minimum-functionality shape that has already cost this app two rejections.
- **The delegate writes blindly; the guard runs at render.** One guard
  implementation means the screen and the face can never disagree about what
  "stale" means, and on a transient two-clock disagreement a validating delegate
  would discard the only copy of data it has no way to re-request. There is no
  pull on this transport.
- **How fresh it honestly is:** seconds-to-minutes with the watch on the wrist
  and the phone in pocket; 15–60 minutes once the day's reloads throttle;
  **unbounded** while the two devices are apart. Apple promises no latency at
  all. That ceiling is why the rectangular face carries an unconditional
  `as of 8:04 AM` and the watch screen always does — and why there is no refresh
  affordance anywhere on the watch.
- **Sign-out** pushes an empty envelope, which fails the decode and collapses to
  the same empty face as an absent blob. The honest bound is *cleared on next
  contact, or at the watch's local midnight, whichever comes first* — the
  day-key guard is a privacy backstop, not just a freshness one.
- **`deploymentTarget: "10.0"`, pinned on both watch targets.** 9.4 looks free
  and is not: it sits below the line where the **Smart Stack** exists, which is
  where an Apple Watch widget is actually discovered today.

## Shared work (both platforms)
- `packages/core/src/widget-snapshot.ts` + unit tests (pure; export from
  `index.ts`).
- A `apps/mobile/src/lib/widget.ts` adapter: `writeSnapshot(snapshot)` that
  persists to the shared store and triggers the platform reload. Called from the
  same place logs are written — cleanest hook is a small `useEffect` in the
  Today screen keyed on `summary`/`targets`, plus a call on app-foreground and
  on day rollover.
- Both plugins added to `app.json` `plugins[]`; `group.fit.ignia.app` App Group
  in the iOS config.

## Provisioning — the owner-gated seam

A widget needs an EAS **dev build**; it cannot run in Expo Go (same gate as
Health and Google Sign-In). Build availability and quota live in `STATUS.md` §3.

1. **iOS App Groups — probably NOT a manual step.** EAS Build's *auto capability
   signing* reads the local entitlements and enables matching capabilities on
   the Apple Developer Console during the build; **App Groups is on its
   supported list**, and `app.json` already resolves to
   `{"com.apple.security.application-groups":["group.fit.ignia.app"]}`. So the
   build is expected to register the group itself.

   *(An earlier revision of this doc claimed the build would fail at signing
   without a manual portal step. That was wrong — auto capability signing
   covers it.)*

   **The one part still worth watching:** the widget runs in its own extension
   target with its own bundle id (`fit.ignia.app.Today`) and its own
   provisioning profile. If the first build fails on the *extension's*
   entitlements rather than the app's, create the group manually in the portal
   and re-run — that's the fallback, not the default expectation.
2. No Play/store metadata needed for internal testing.

## Device QA checklist (first thing after the build exists)

Tick a box only for a platform you actually watched. **iOS was run on a physical
iPhone from TestFlight build 13 on 2026-08-03.** **Android was placed on a home
screen for the first time on 2026-08-06 (vc 8) and rendered an empty box** — the
React Compiler defect above. The fix is committed but **is not in any Android
binary yet**, so every box below stays unticked until a build carrying it is
installed and watched.

- [x] **iOS** — widget appears in the gallery and renders kcal left + protein left.
- [x] **Android** — widget appears in the picker. *(Owner-reported 2026-09-05, OnePlus 8T: placed on the home screen, renders, "looks good".)*
- [ ] Add it with the app **never opened on that device** → "Open Ignia to start"
      (not "0 left").
- [x] **iOS** — log a meal → the numbers move within seconds (this proves the App
      Group write + `reloadWidget`, the single riskiest seam). This is the one
      that mattered: it makes the whole chain proven, not just the render.
- [ ] **Android** — same check, via the `index.js` task handler.
- [!] **Tap it → the app opens with the add-entry sheet already up.** **BROKEN
      from build 29 through build 40 and fixed 2026-08-09**: the face tap is
      `ignia://?openAdd=1`, and build 29's "de-duplication" of the explicit
      `CFBundleURLTypes` deleted the `ignia` scheme — an explicit
      `ios.infoPlist` array REPLACES what Expo generates from `scheme`, it does
      not merge. Found by the Maestro regression suite failing to open the
      link on the simulator; confirmed against build 40's shipped Info.plist.
      The verifier now requires both schemes with whole-line matching (its
      first version used `includes()` and passed, because `ignia` is a
      substring of `fit.ignia.app`). Re-verify this row on hardware on 41+.
- [ ] Tap it → the app opens **with the add-entry sheet already up**.
- [ ] Cross midnight with the app closed → it blanks instead of showing
      yesterday's totals as today's.
- [ ] Set the app to es-PR → the widget's words follow the *profile*, not the
      phone's language.
- [ ] Sign out → the widget blanks (it must not keep the old account's numbers
      on the home screen).

**Quick-add (ADR-0020) — Android, vc 18. Every box below is UNTICKED and none of
it has been run on hardware.** The unit tests cover the decisions; what they
cannot cover is whether Android lets any of it happen, and that is the whole risk
in this feature. The two starred rows are the ones that would make it worthless.

- [ ] Designate a preset in Settings → Quick add → the widget grows a `+ <name>`
      button **without reopening the app**.
- [ ] ★ **Tap the widget button → the numbers move, and the row is in History.**
      This proves the headless write, which is the seam everything rests on.
- [ ] Tap it twice quickly → **two** rows (two real meals), not one — the id is
      minted per tap, so this is not a dedup case.
- [!] **Airplane mode → tap → the numbers still move; re-enable, open the app,
      the row lands.** **THIS WAS BROKEN from the day the feature shipped and is
      fixed 2026-08-08.** Firestore's `setDoc` does not reject when it cannot
      reach the backend — it waits — so `logQuickAdd`'s catch never ran, nothing
      was parked, the numbers never moved, and the headless task was killed at
      its 15s ceiling with the row inside it. A tap on a bad connection was
      silently lost. Found on the emulator; see `.maestro/README.md`. Re-run
      this row on hardware to confirm the fix.
- [ ] Airplane mode → tap → the numbers still move; re-enable, open the app, the
      row appears **on the day it was tapped**.
- [~] ★ **PARTLY VERIFIED 2026-08-08 on the emulator, and the logging half
      found a REAL bug** (now fixed — see the airplane-mode row above). The tile is in the Quick Settings panel and **is labelled with
      the preset's name** (`Log Chicken + rice`), which proves `setTileState`
      and the JS→Kotlin mirror. But signed in with slot 1 designated, **no tap
      wrote a row** — four `cmd statusbar click-tile` attempts and one real
      `input tap` through the open shade all left today's `dailyLogs` empty, and
      one click took `onClick`'s `openApp()` fallback, the branch for a tile
      that is not ready — which was itself a wrong suspect. The real cause was
      a Firestore write that hangs instead of throwing, killing the headless
      task with the row un-parked. **Still unconfirmed**: whether a tap logs on
      a healthy connection, since the emulator's Firestore transport errors.
      Detail in `.maestro/README.md`.
- [ ] ★ **The Quick Settings tile appears in the edit list, is labelled with the
      preset's name, and one tap logs it** without opening the app.
- [ ] Tap the tile with the app **fully swiped away** — this is the
      `startService`-from-background case, and the honest pass condition is
      *either* a silent log *or* the app opening and logging. A tile that does
      nothing is the failure.
- [ ] Tap the tile from the **lock screen** → it logs (or prompts to unlock, then
      logs). Never nothing.
- [ ] Delete the bound preset elsewhere → the button and the tile stop offering
      it rather than logging a ghost.
- [ ] Rename the bound preset → the widget button **and** the tile caption follow.
- [x] **Sign out → the tile goes inactive and its tap opens the app; it must not
      keep the previous account's preset name in the shade.** **The tap-opens-the-app
      half is VERIFIED 2026-08-08 on the `ignia-a35` emulator** — the first
      Android row in this file confirmed by anything at all.
      `cmd statusbar click-tile` started `fit.ignia.app/.MainActivity` through an
      `ignia:///` deep link and wrote no row. The shade-label half is still
      unchecked: it needs a signed-in session first, and the demo password is not
      available to an automated run. Method in `.maestro/README.md`; it needs no
      phone.
- [ ] Set the app to es-PR → the tile reads `Registrar <name>`, following the
      **profile**, not the phone.

**Quick-add — iOS. The write path is PROVEN as of 2026-08-08; the rest is not.**
It differs in kind from Android's: a Swift App Intent talking to the Firestore
REST API with a token it minted itself (ADR-0020), and nothing in it is exercised
by any test that runs on a machine. The starred Siri row below has now been run on
hardware and passed, which retires the single largest unknown — keychain, token
exchange, `PATCH` and rules all work. Treat the remaining rows as testing
*variations* on a working path (locked device, offline, revoked token, sign-out),
not the path itself.

**Do not read that as the feature being verified.** Build 27 shipped this whole
surface unusable — iOS registered no App Shortcuts at all — and every machine-side
check passed on it, including confirming `Metadata.appintents` was present in the
binary. The rows below are the only thing that distinguishes working from shipped.

- [x] ★ **"Hey Siri, log a preset in Ignia" → Siri offers the designated presets,
      and picking one logs it.** This proves the whole REST path: keychain read,
      token exchange, PATCH, rules acceptance.
      **PASSED on the owner's device, build 28, 2026-08-08** — Siri asked which
      preset, and the row landed in History. So the REST write path is real: the
      Keychain envelope is readable from the intent process, the refresh-token
      exchange works, the `PATCH` passes `firestore.rules`, and the app sees the
      row. Every other iOS quick-add row now tests a *variation* on a path known
      to work, rather than the path itself.
      **This row could not be run at all until build 28.** On build 27 iOS
      registered no App Shortcuts, so there was no phrase to say — see the
      required-parameter trap in `AGENTS.md`.
- [ ] Siri's reply names what it did. A queued write must say it will sync — never
      "logged".
- [ ] ★ **The widget button logs without the app appearing.** If the app visibly
      launches, `openAppWhenRun` is wrong somewhere.
- [ ] "Log 300 calories in Ignia" writes a one-off labelled *Quick add*.
- [ ] "Log 40 grams of protein in Ignia" → Siri **asks for calories** rather than
      inventing a number.
- [ ] Airplane mode → a Siri log says it will sync; open the app → the row lands
      on the day it was spoken.
- [ ] Sign out → Siri says to sign in again, and nothing is written.
- [ ] Change the account password on another device (revoking the refresh token)
      → the next Siri attempt says to sign in again rather than failing silently
      or retrying forever.
- [ ] The shortcuts appear in the **Shortcuts app** under Ignia, and
      `LogQuickAddSlotIntent` does **not** (it is `isDiscoverable: false` — "Log
      quick-add slot 2" is meaningless to a human).
- [ ] **Build 25 still renders its widget** after this build's blob format
      reaches it. This is the additive-field claim; if it blanks, the `quickAdd`
      field was not as optional as intended.

**Apple Watch** — none of this is reachable until the watch targets compile and
a build carries them. The layout half is a **simulator** readout (#46) and needs
no hardware; everything below needs a real paired watch.

- [ ] Complication appears in the face gallery (Smart Stack presence is the
      whole reason for the `10.0` pin).
- [ ] Add it with the phone having **never pushed** → `Waiting for iPhone`, not
      zeros, and the watch screen carries the explanatory subline.
- [ ] Log a meal with the watch on the wrist and phone in pocket → the face
      moves. **This is the one that matters** — it proves the whole hop, not
      just the render, the same way the iPhone check did.
- [ ] Tap the face → the mirror screen opens and shows the denominators
      (`1,240 / 2,000`, `protein 88/150`) plus `as of`.
- [ ] Walk out of range, log on the phone, come back → the face catches up on
      next contact. (Latency here is unmeasurable by design; the check is that
      it *converges*, not how fast.)
- [ ] Cross midnight with the two devices apart → the face blanks. This is the
      privacy backstop, not just freshness.
- [ ] Sign out with the watch nearby → the face blanks on next contact.
- [ ] Sign out with the watch **in a drawer** → it stays populated until local
      midnight. That is the documented bound, not a bug; confirm it is the
      bound and not "forever".

**iOS — fasting Live Activity (N3, ADR-0021)** — iOS-only; there is no Android
half. Unlike everything above, **most of this is checkable in the iOS
Simulator** on `ignia-mac` at no build quota, because Live Activities render
there and the Dynamic Island appears on any iPhone 14 Pro or newer simulator.
Only the starred row and the ceiling row need real time on a real device.

- [x] ★ **Start a fast → a Lock Screen card appears with a counting timer.**
      **VERIFIED 2026-08-08 on the iPhone 17 Pro simulator (iOS 26.5).**
      `liveactivitiesd` logged the activity created — `attributesType:
      FastActivityAttributes, requester: fit.ignia.app, state: active,
      sceneTargets: [lockscreen: widget(containingProcess: fit.ignia.app)]` —
      and the Dynamic Island rendered the flame with a counting `1:00`. So the
      `NSClassFromString` bridge resolves, `Activity.request` succeeds, and the
      extension is wired to the presentation. **This was the row that could
      fail silently**, and it does not. Method in `.maestro/README.md`.
- [x] **End the fast → the card disappears immediately.** VERIFIED in the same
      session: the Dynamic Island was empty within seconds, so
      `dismissalPolicy: .immediate` is doing its job rather than leaving a
      finished fast on screen for four hours.
- [ ] ★ **Start a fast → a Lock Screen card appears with a counting timer.**
      This is the row that proves the whole thing: the `NSClassFromString`
      bridge resolved, `Activity.request` succeeded, and the extension found
      the attributes type. If it fails, nothing else below is meaningful — and
      it fails *silently* (the fast still starts and still writes Firestore),
      which is the same shape that shipped build 27's Siri support dead.
- [ ] The Dynamic Island shows the flame when collapsed, and long-press expands
      to label + timer + `since 8:14 PM`.
- [ ] The timer **keeps counting with the app force-quit**. This is the whole
      $0 claim — if it freezes, `Text(timerInterval:)` is not doing what
      ActivityKit's docs say and the design needs a push after all.
- [ ] End the fast → the card disappears **immediately**, not after four hours.
      (`dismissalPolicy: .immediate`; the default would leave a finished fast
      counting on the Lock Screen.)
- [ ] Set the app to es-PR → the card reads `Ayuno` / `desde las …`, following
      the **profile** locale, not the phone's. Changing the language while a
      fast runs must replace the card, because attributes are immutable.
- [ ] Break the fast from **outside this install** while the app is closed —
      a second device, or edit the profile's fasting fields in the Firestore
      console (the web app that used to serve this step is retired, ADR-0036)
      — then reopen the app → the card ends. Same again for break-then-restart: the card must
      re-arm to the *new* start time. Nothing but the reconciler catches this.
- [ ] Swipe the card away, then foreground the app → it comes back.
- [ ] Turn Live Activities **off for Ignia** in iOS Settings → starting a fast
      still works, logs nothing to the user, and shows no card. A preference,
      never a nag.
- [ ] Sign out mid-fast → the card ends. (Currently implied by `fastStartedAt`
      going null; confirm rather than assume.)
- [ ] ★ **Leave a fast running 9+ hours without opening the app** → the card is
      gone, and opening the app brings it back **showing ~9:xx, not 0:00**.
      This is the documented 8-hour ceiling and its mitigation; the failure to
      watch for is a timer that restarts from zero, which would be worse than
      no card at all.
- [ ] The **Today widget still renders** after this build. N3 turned
      `index.swift`'s `@main` into a `WidgetBundle`, which is the one change
      that could drop the existing widget while exiting 0.

## Locked decisions
Settled 2026-07-23, before any code existed.

| Decision | Locked as |
|---|---|
| **What it shows** | **kcal remaining + protein remaining, text-first.** The home-screen faces stay text-first and still ignore `progress`; the ring arrived later, on the accessory families, where a `Gauge` is the whole idiom. |
| **Platforms** | **Both.** Android's TSX widget is cheap and validates the snapshot pipeline before the Swift cost is paid; nothing ships on Play until the 12-tester gate is met. |
| **Sizes** | **iOS `.systemSmall` / Android 2×2** for the home screen; `systemMedium` is still additive later. The Lock Screen and watch accessory families were added afterwards and are governed by the #31 map, not by this table. |
| **Tap target** | **Deep-link to the add-entry sheet** (`ignia://?openAdd=1` — the same param the in-app FAB route uses), so the widget drives logging. |
| **Empty state** | **"Open Ignia to start."** Never zeros — a "0 left" reads as a fully-eaten day. |
| **Theme** | **One fixed brand face, dark in both themes** (the `heroPanel` family, ADR-0014). A widget sits on the wallpaper and can't follow the in-app theme. |
| **App Intents / Siri** | **Out of *that* batch — reopened by ADR-0020.** The reasoning below still governs the pace: the Android tile shipped alone in vc 18, and the wider 4×2 face was held back to keep that binary to one untested native surface. iOS App Intents are a separate build again. |

## Component map — where each half of the seam lives

| File | Role |
|---|---|
| `packages/core/src/widget-snapshot.ts` | The whole contract: `buildWidgetSnapshot` (app side) + `parseWidgetSnapshot`/`widgetView` (widget side). Pure. 29 tests. |
| `apps/mobile/src/lib/widget.ts` | Storage + reload adapter. iOS → App Group `UserDefaults` via `ExtensionStorage`; Android → `AsyncStorage` + `requestWidgetUpdate`. Native modules lazy-required (Expo Go / web safe). |
| `apps/mobile/src/hooks/useWidgetSync.ts` | Mounted on Today. Writes on every summary/target change + on app foreground. No new Firestore listeners (ADR-0016). |
| `apps/mobile/src/widgets/*` | Android widget UI (TSX), string table, task handler. |
| `apps/mobile/targets/_shared/Glance.swift` | **The one Swift mirror** of `widget-snapshot.ts` — decode, version gate, staleness guard, `Metric`, the contract constants and the string table. The apple-targets plugin globs `_shared/*` and links it into **every** target, so this single file reaches the widget, the watch app and the complication. |
| `apps/mobile/targets/widget/index.swift` | iOS SwiftUI widget: `systemSmall` + the three accessory families. Views and `TimelineProvider` only. |
| `apps/mobile/targets/watch/index.swift` | watchOS app — `WCSession` delegate, background task, App Group write, `reloadAllTimelines`, and the one read-only mirror screen. |
| `apps/mobile/targets/watch-widget/index.swift` | Watch face complication: circular, rectangular, inline. |
| `apps/mobile/modules/watch-link/` | The phone half of the transport. A custom Expo Module — the repo's first — that forwards the envelope over `WCSession`. Deliberately a dumb pipe: it never learns the contract, and it cannot see `_shared` (Expo Modules are CocoaPods targets, not apple-targets). |
| `apps/mobile/index.js` | Custom entry; registers the Android task handler before React mounts. |

**The mirroring is the thing to watch, and it is held at exactly one copy.**
iOS can't run our JS, so the decode / staleness / over-vs-left rules exist
twice — in `widget-snapshot.ts` and in `Glance.swift` — and **not once per
Apple surface**. `widget-snapshot.ts` is the spec and its vitest suite is the
reference; a change to one side is a bug until it lands on the other. Android
keeps its own table in `strings.ts` because it renders in JS. Two tables total,
not three.

**Views are deliberately NOT shared.** The `_shared` group is linked into the
*main app* target too, so everything in it compiles against the phone app's iOS
floor — `Gauge` is iOS 16+, `.containerBackground` is iOS 17+, and shared
SwiftUI would need `@available` guards on code that can only be compiled by
spending an EAS build. The dividing line, stated once: **what can silently show
wrong _numbers_ is shared; what can only look wrong is not.** A drifted layout
is visible to anyone who looks at it; a drifted staleness guard is not.

**Prebuild must be re-run on any add/rename/remove in `targets/_shared/`** — the
glob runs at prebuild time and is non-recursive (one level).

### Locale rides in the blob
Our locale is `profile.preferredLocale` — behind auth and Firestore, neither of
which a widget process has. Using the *device* locale instead would hand an
English widget to someone who set the app to Spanish, so `locale` is a field on
the snapshot and each widget keeps its own small string table.

## Deferred / separate (NOT this plan)
- **Fasting Live Activity** (iOS lock-screen fast countdown) — natural given the
  existing Fasting feature, but a distinct ActivityKit effort (~1 wk, iOS-only).
- **Interactive widgets** (log from the widget without opening the app) — **no
  longer deferred; see ADR-0020.** Android's is shipped (a quick-add button on the
  2×2 face, plus a Quick Settings tile); iOS 17+ `AppIntent` buttons are the
  remaining half. Note this is still a different thing from a quick-log affordance
  *on the watch*, which stays rejected: it needs a watch→phone write path this
  design does not have, and ADR-0020 did not add one.
- **`.accessoryCorner`** — the one accessory family not shipped. Absent from the
  corner slots of the Infograph faces is the accepted cost.
- **Wear OS** — Android glanceable surfaces beyond the home-screen widget are
  out of scope on the #31 map.
