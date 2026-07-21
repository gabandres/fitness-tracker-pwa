# Implementation Plan — Home-screen Widget (Today's rings)

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

## Prerequisites (owner-gated)
1. **EAS dev build** (native modules — same gate as Health/Google Sign-In).
2. **iOS:** register the widget-extension target + App Group on the App id.
3. No Play/store metadata needed for internal testing.

## Open decisions to lock before coding
- **What the widget shows:** kcal-only (simplest) vs kcal + protein vs a full
  rings mini. Recommend **kcal remaining + protein remaining** (two numbers),
  since protein is half the product's identity. A graphical ring is more iOS
  Swift work — do text-first, ring as a fast follow.
- **Sizes:** iOS small + medium; Android 2×2. Recommend ship **small/2×2 only**
  first.
- **Tap target:** deep-link into the app's add-entry sheet (the PWA already has
  `?action=add`; mobile can route to the entry sheet) so the widget drives
  logging, not just display. Recommend yes — it's the engagement payoff.
- **Empty/first-run state:** before the app has ever written a snapshot, show
  "Open Ignia to start" rather than zeros that look like a logged 0.

## Effort estimate (after Phase 0 dev build exists)
- Shared core snapshot + adapter + wiring: **~1 day.**
- **Android** widget (JS/TSX): **~2–3 days.**
- **iOS** widget (SwiftUI + App Group bridge + native module + timeline):
  **~4–5 days** (Swift is the cost driver).
- Total for both: **~1.5 weeks.** Android-first is a cheaper way to validate the
  snapshot pipeline before paying the iOS Swift cost.

## Deferred / separate (NOT this plan)
- **Fasting Live Activity** (iOS lock-screen fast countdown) — natural given the
  existing Fasting feature, but a distinct ActivityKit effort (~1 wk, iOS-only).
- **Apple Watch complication / app** — separate target, larger.
- **Interactive widgets** (log from the widget without opening the app) —
  iOS 17+ AppIntents; defer until the display widget ships.
