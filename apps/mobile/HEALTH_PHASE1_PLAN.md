# Implementation Plan — Health Sync Phase 1 (Weight two-way)

> **Status (2026-07-23): SHIPPED — and superseded by its own success.** Phase 1
> never shipped alone; the work landed as all phases at once in the App Store
> 1.0 build, and is device-confirmed working in prod. Import covers
> weight/sleep/water/steps/activeEnergy; export covers
> weight/water/bodyFat/nutrition/workouts. **Historical rationale, not a work
> list.**

Scope of this doc: the **first shippable slice** of `HEALTHKIT_PLAN.md` — import
body weight from Apple Health / Android Health Connect and export app-logged
weight back. Weight only. Everything else (nutrition/workout export, sleep,
water, body-fat) is Phase 2/3 and out of scope here.

Why weight-first: highest value, smallest permission surface, and it quietly
answers the "sync with a Bluetooth scale" request — a Withings/Renpho/Apple
Watch scale that already writes to Health flows straight into `dailyWeights`
with **no BLE code of our own**. Runtime cost: **$0** (on-device, no Cloud
Function, no server ever sees health data).

## Prerequisites (owner-gated — cannot be done from code)
These block Phase 1; none are code changes.
1. **EAS dev build.** HealthKit / Health Connect are native modules; Expo Go
   cannot load them. `eas.json` already has a `development` profile with
   `developmentClient: true` — run `eas build --profile development` once and
   install it. Same gate as Google Sign-In / ML Kit.
2. **iOS:** enable the **HealthKit capability** on the `fit.ignia.app` App id in
   the Apple Developer portal (the config plugin sets the entitlement in the
   build, but the capability must also be enabled on the identifier).
3. **Android:** nothing extra for the dev build; the config plugin declares the
   Health Connect permissions. (Production listing later needs the Play
   Health-app declaration + privacy-policy link — Phase 1 dev/testing does not.)
4. **Privacy policy:** add a Health-integration clause to `/privacy` (web) before
   store submission — "Health data stays on your device and in your OS health
   store; it is never uploaded to our servers or sold." Not a blocker for
   internal testing, but must land before the feature ships publicly.

## Libraries
- iOS: [`@kingstinct/react-native-healthkit`](https://github.com/kingstinct/react-native-healthkit)
  — TS, config plugin sets `NSHealthShareUsageDescription` /
  `NSHealthUpdateUsageDescription` + the HealthKit entitlement.
- Android: [`react-native-health-connect`](https://matinzd.github.io/react-native-health-connect/)
  — config plugin declares Health Connect read/write permissions.

Add both plugins to `apps/mobile/app.json` `plugins[]` with the usage strings:
- Share (read): "Ignia reads your weight from Apple Health so you don't have to
  re-type it."
- Update (write): "Ignia writes the weight you log to Apple Health."

## Architecture — mirror the ledger seam (ADR-0009 spirit)
Three layers, same split the app already uses for Firestore:

### 1. Pure mapping — `packages/core/src/health-mapping.ts` (NEW, unit-tested)
No native imports, no Firebase. Just types + math + dedup keys, reused by both
platforms (and unit-tested with zero devices).

```ts
export type HealthKind = 'weight'; // widened in later phases
export interface HealthSample {
  dateKey: string;   // localDateKey — the app's day bucket
  kind: HealthKind;
  valueLb: number;   // canonical app unit for weight is lb (dailyWeights)
  endMs: number;     // sample end time (epoch ms) — conflict tie-break
  fromUs: boolean;   // true if this sample's source bundle id is ours
}

export const LB_PER_KG = 2.20462;
export const kgToLb = (kg: number) => kg * LB_PER_KG;
export const lbToKg = (lb: number) => lb / LB_PER_KG;

// Collapse many same-day samples to one weight per dateKey (latest endMs wins),
// dropping samples we wrote (fromUs) so import never re-imports our own exports.
export function reduceImportedWeights(
  samples: HealthSample[],
): Record<string, number> { /* ... */ }

// Merge policy for a single day when Health and the app disagree.
// Recommended: newest-endMs-wins (see open decision below).
export function resolveWeightConflict(
  appLb: number | null, appUpdatedMs: number | null,
  healthLb: number, healthEndMs: number,
): number { /* ... */ }
```
Reuse `isStorableWeight` from `weight-bounds.ts` to reject junk samples (0 lb,
implausible values) before writing to Firestore — same guard the manual logger
uses. Use `localDateKey` from core to bucket a sample's `endDate` into the day.

### 2. Per-frontend native adapter — `apps/mobile/src/lib/health.ts` (NEW)
Thin, like `ledger.ts`. `Platform.OS` picks HealthKit vs Health Connect behind
one interface; both translate through `health-mapping.ts`.

```ts
export interface HealthPort {
  isAvailable(): Promise<boolean>;
  requestWeightPermissions(): Promise<boolean>;
  readWeights(sinceDays: number): Promise<HealthSample[]>;
  writeWeight(dateKey: string, valueLb: number): Promise<void>;
}
export const health: HealthPort = Platform.OS === 'ios' ? healthKit : healthConnect;
```
- **Dedup on import:** tag our writes with the app's bundle id as source
  metadata; on read, mark `fromUs` and drop them in `reduceImportedWeights` so a
  re-sync is idempotent (matches the CSV-import + `markExercised` precedents).
- **Dedup on export:** only write a day's weight to Health if we don't already
  have a matching sample from us for that day.

### 3. Wiring — Settings toggle + import/export glue
- **Settings row** in `apps/mobile/src/app/(app)` settings screen: "Connect Apple
  Health / Health Connect". On enable → `requestWeightPermissions()`, persist a
  local flag (AsyncStorage — this is a device preference, not user data, so it
  does NOT go to Firestore) + a "Sync now" button.
- **Import path:** on connect and on app-open (foreground), call
  `readWeights(400)` → `reduceImportedWeights` → for each `{dateKey, lb}` that
  differs from the current `dailyWeights[dateKey]`, apply `resolveWeightConflict`
  then `setDailyWeight(uid, dateKey, lb)` (existing `ledger.ts:181`). The live
  `subscribeDailyWeights` in `useToday`/`useBody` re-renders automatically — no
  new subscription needed.
- **Export path:** when the user logs weight (the Body weight sheet →
  `setDailyWeight`), if Health is connected, also `writeWeight(dateKey, lb)`.
  Wrap in try/catch; a Health write failure must NOT fail the Firestore write
  (log + swallow, surface a subtle toast at most).

Web PWA: **no change.** Web has no Health API; this is a mobile-only feature.
`BodyMetricStore.setDailyWeight` on web is untouched.

## Firestore / rules
No schema change — we write existing `dailyWeights/{dateKey} = { weight }`.
**No `firestore.rules` change** (no new top-level field). This is the rare
feature that needs no rules deploy.

## Open decisions to lock before coding (grill these)
- **Import cadence:** manual "Sync now" + on-app-open is the recommendation.
  Background delivery (iOS `HKObserverQuery`) adds a background entitlement +
  battery cost — defer unless requested.
- **Conflict rule** when both sides have a weight for one day: recommend
  **newest-`endMs`-wins**. Alternatives: Health-wins, or ask. `dailyWeights`
  docs have no updatedAt today, so "app updated time" is unknown — simplest
  correct rule is: on import, Health overwrites only if the app value differs
  and the user hasn't edited that day since last sync. Pragmatic v1:
  **Health import overwrites the day** (a scale reading is authoritative), and
  manual edits re-export. Confirm with owner.
- **Platform order:** iOS-first (HealthKit is the common request), Health
  Connect as a fast follow — or both at once. Recommend iOS-first to derisk the
  permissions UX, then Android.
- **History depth on first import:** 400 days (matches `LOG_WINDOW`) vs last 90.
  Recommend 400 so measured-mode TDEE benefits immediately.

## Test plan
- `packages/core`: unit-test `reduceImportedWeights` (multi-sample/day, fromUs
  filtering, empty), `resolveWeightConflict`, `kg↔lb`, and `isStorableWeight`
  rejection of junk samples. Zero devices needed.
- Manual (dev build): add a weight in Apple Health → open Ignia → Sync → appears
  in Body. Log a weight in Ignia → appears in Health. Re-sync → no duplicates
  (idempotent). Toggle off → no reads/writes.

## Effort estimate (after Phase 0 dev build exists)
**~3–4 focused days:** ~0.5d plugins/permissions/build config, ~1d core mapping
+ tests, ~1–1.5d native adapter (both platforms, or iOS-only first), ~1d
Settings UI + import/export wiring + manual QA.

## Explicitly NOT in Phase 1
Nutrition/macro export, workout export, water, body-fat export, sleep two-way,
steps read, background observers. All are Phase 2/3 in `HEALTHKIT_PLAN.md` and
reuse this same seam (`health.ts` + `health-mapping.ts` widen `HealthKind`).
