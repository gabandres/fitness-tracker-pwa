# Implementation Plan — Home-screen Widget (Today's rings)

> **Status (2026-07-23): BUILT, unverified on device.** All code below is
> written, typechecked and unit-tested; nothing has ever run on hardware,
> because a widget needs an EAS build and the quota resets **August 2026**
> (`docs/aug-2026-build-batch.md`). Device QA is the only remaining step.
> Decisions previously listed as open are now **locked** — see
> §"Locked decisions".

Scope: a home-screen widget showing **today's calories + protein remaining**
(and optionally a small ring), refreshed from a last-known snapshot the app
writes on each log. Greenfield — nothing exists yet. Runtime cost: **$0** (reads
local shared storage, no network, no Cloud Function).

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
  writes the snapshot JSON to the App Group's shared `UserDefaults` (or a file
  in the group container); the Swift widget reads the same key. Bridge from RN
  via a tiny native module or `react-native-shared-group-preferences`.
- **Refresh:** WidgetKit `TimelineProvider` — reload on our write via
  `WidgetCenter.shared.reloadAllTimelines()` (call from the native module after
  each snapshot write) + a periodic timeline entry as a backstop.
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

## Prerequisites (owner-gated — STILL OPEN)
1. **EAS dev build** (native modules — same gate as Health/Google Sign-In).
   Quota resets August 2026.
2. **iOS App Groups — probably NOT a manual step.** EAS Build's *auto capability
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
3. No Play/store metadata needed for internal testing.

## Device QA checklist (first thing after the build exists)
- [ ] Widget appears in the iOS widget gallery and the Android picker.
- [ ] Add it with the app **never opened on that device** → "Open Ignia to start"
      (not "0 left").
- [ ] Log a meal → the numbers move within seconds (this proves the App Group
      write + `reloadWidget`, the single riskiest seam).
- [ ] Tap it → the app opens **with the add-entry sheet already up**.
- [ ] Cross midnight with the app closed → it blanks instead of showing
      yesterday's totals as today's.
- [ ] Set the app to es-PR → the widget's words follow the *profile*, not the
      phone's language.
- [ ] Sign out → the widget blanks (it must not keep the old account's numbers
      on the home screen).

## Locked decisions
Settled 2026-07-23, before any code existed.

| Decision | Locked as |
|---|---|
| **What it shows** | **kcal remaining + protein remaining, text-first.** No ring — it's a fast-follow once the seam is proven on device. |
| **Platforms** | **Both.** Android's TSX widget is cheap and validates the snapshot pipeline before the Swift cost is paid; nothing ships on Play until the 12-tester gate is met. |
| **Sizes** | **iOS `.systemSmall` / Android 2×2 only.** Medium is additive later. |
| **Tap target** | **Deep-link to the add-entry sheet** (`ignia://?openAdd=1` — the same param the in-app FAB route uses), so the widget drives logging. |
| **Empty state** | **"Open Ignia to start."** Never zeros — a "0 left" reads as a fully-eaten day. |
| **Theme** | **One fixed brand face, dark in both themes** (the `heroPanel` family, ADR-0014). A widget sits on the wallpaper and can't follow the in-app theme. |
| **App Intents / Siri** | **Out of this batch.** Keeps the binary to one untested native surface; three is how the previous two rejections happened. |

## What was built (2026-07-23)

| File | Role |
|---|---|
| `packages/core/src/widget-snapshot.ts` | The whole contract: `buildWidgetSnapshot` (app side) + `parseWidgetSnapshot`/`widgetView` (widget side). Pure. 29 tests. |
| `apps/mobile/src/lib/widget.ts` | Storage + reload adapter. iOS → App Group `UserDefaults` via `ExtensionStorage`; Android → `AsyncStorage` + `requestWidgetUpdate`. Native modules lazy-required (Expo Go / web safe). |
| `apps/mobile/src/hooks/useWidgetSync.ts` | Mounted on Today. Writes on every summary/target change + on app foreground. No new Firestore listeners (ADR-0016). |
| `apps/mobile/src/widgets/*` | Android widget UI (TSX), string table, task handler. |
| `apps/mobile/targets/widget/index.swift` | iOS SwiftUI widget — the hand-written Swift **mirror** of `widget-snapshot.ts`. |
| `apps/mobile/index.js` | Custom entry; registers the Android task handler before React mounts. |

**The mirroring is the thing to watch.** iOS can't run our JS, so the decode /
staleness / over-vs-left rules exist twice. `widget-snapshot.ts` is the spec and
its vitest suite is the reference; a change to one side is a bug until it lands
on the other. The same applies to the widget string table (`strings.ts` ↔ the
`strings()` func in `index.swift`) and the palette hexes.

### Locale rides in the blob
Our locale is `profile.preferredLocale` — behind auth and Firestore, neither of
which a widget process has. Using the *device* locale instead would hand an
English widget to someone who set the app to Spanish, so `locale` is a field on
the snapshot and each widget keeps its own small string table.

## Effort — actual
The ~1.5wk estimate assumed a bridge would have to be hand-written. It didn't:
`@bacons/apple-targets` ships `ExtensionStorage` (App Group `UserDefaults` +
`reloadWidget`), which removed the entire custom-native-module line item, and
`react-native-android-widget` needed no Kotlin. What's left of the estimate is
**device QA**, which is build-gated rather than effort-gated.

## Deferred / separate (NOT this plan)
- **Fasting Live Activity** (iOS lock-screen fast countdown) — natural given the
  existing Fasting feature, but a distinct ActivityKit effort (~1 wk, iOS-only).
- **Apple Watch complication / app** — separate target, larger.
- **Interactive widgets** (log from the widget without opening the app) —
  iOS 17+ AppIntents; defer until the display widget ships.
