# Plan — Apple Health (HealthKit) + Android Health Connect

> **Status (2026-07-23): SHIPPED AND LIVE.** Every phase in this plan is built
> and in the App Store 1.0 build (`0a355deb`), and the owner confirmed it works
> on a real device in prod. Activity import (steps / active energy) — listed
> below as a Phase 2/3 extra — landed 2026-07-23 and is the last gap closed.
> **This doc is now historical design rationale, not a work list.** Read
> `packages/core/src/health-mapping.ts` and `apps/mobile/src/lib/health.ts`
> for what actually exists.

Original status when written: **PLAN ONLY** (not started). Sync the app's body/nutrition/workout data
with the OS health store so users don't double-log (a smart scale that writes
to Health auto-fills weight) and the app contributes to the Health ecosystem
(activity rings, trends). Fits the privacy stance: **on-device, per-type user
consent, no server** — Health data never touches our backend.

## Why / value
- **Import weight** from Apple Health / Health Connect: users with a smart
  scale (Withings, Renpho, Apple Watch) already have weight there — pull it in
  instead of asking them to re-type it. Biggest single win.
- **Export** logged nutrition (energy + macros), workouts, and weight so Macro
  Log shows up in the Health app's dashboards. Table-stakes vs MyFitnessPal /
  MacroFactor, which both integrate.
- **$0 recurring**, no new Cloud Function — all on-device.

## Data map (app ↔ health store)
| App concept | Firestore | HealthKit type | Health Connect type | Direction |
|---|---|---|---|---|
| Weight | `dailyWeights/{date}` (lb) | `bodyMass` | `Weight` | **two-way** |
| Body-fat % | derived (`latestNavyBodyFat`) | `bodyFatPercentage` | `BodyFat` | export |
| Calories | `DailyLog.calories` | `dietaryEnergyConsumed` | `TotalCaloriesBurned`→`Nutrition` | export |
| Protein/Carbs/Fat | `DailyLog.{protein,carbs,fat}` | `dietaryProtein/Carbohydrates/FatTotal` | `Nutrition` | export |
| Water | `dailyWater/{date}` (fl oz) | `dietaryWater` | `Hydration` | export |
| Sleep | `dailySleep/{date}` (hrs) | `sleepAnalysis` | `SleepSession` | two-way |
| Workout | `workoutSessions` | `HKWorkout` (traditionalStrengthTraining) | `ExerciseSession` | export |

Recommended v1 direction: **weight two-way; everything else export-only** (import
of nutrition/workouts is rarely useful and complicates dedup).

## Libraries (both need a dev build — do NOT work in Expo Go)
- **iOS:** [`@kingstinct/react-native-healthkit`](https://github.com/kingstinct/react-native-healthkit)
  — TypeScript, actively maintained, ships a config plugin that sets
  `NSHealthShareUsageDescription` / `NSHealthUpdateUsageDescription` and the
  HealthKit entitlement.
- **Android:** [`react-native-health-connect`](https://matinzd.github.io/react-native-health-connect/)
  — Health Connect API (built into Android 14+), config plugin + permission
  declarations.

## Architecture (mirror the ledger seam)
- **Pure mapping in `packages/core`** (`health-mapping.ts`): convert between app
  shapes and a neutral `HealthSample { dateKey, kind, value, unit }` — unit math
  (lb↔kg, fl oz↔mL, kcal↔kJ) and dedup keys live here, unit-tested, reused by
  both platforms. NO native SDK imports.
- **Per-frontend adapter** `apps/mobile/src/lib/health.ts`: thin `readWeights()`
  / `writeNutrition()` etc. that call the platform module and translate via core
  — exactly like `ledger.ts`. Platform split (`Platform.OS`) picks HealthKit vs
  Health Connect behind one interface.
- **Dedup:** Health samples we wrote carry our bundle id as source; on import,
  skip samples whose source is us, and key by `dateKey` so a re-sync is
  idempotent (matches the CSV-import + `markExercised` precedents).
- **Settings toggle:** a "Connect Apple Health / Health Connect" row in Settings
  that requests permission and a per-type on/off, plus a manual "Sync now".

## Owner-gated prerequisites (I cannot do these from code)
1. **EAS dev build** — Health modules are native; Expo Go can't load them. This
   is the same blocker as Google Sign-In / ML Kit (see `MOBILE_RELEASE.md`).
2. **iOS:** enable the **HealthKit capability** on the Apple Developer app id.
   App Store review requires a clear health-data usage description and forbids
   using Health data for advertising/data-mining (Guideline 5.1.3) — our privacy
   stance already complies.
3. **Android:** declare Health Connect permissions + link a **privacy policy**
   from the permissions rationale screen (Google requires it). We have `/privacy`
   — it must be updated to disclose the Health integration.
4. **Privacy policy update** (both stores): add a Health-integration clause
   stating data stays on-device / in the user's own store and is never sold.

## Phasing
- **Phase 0 (owner):** dev build + entitlements/permissions.
- **Phase 1 (highest value):** read `bodyMass` → import weight (dedup by date);
  write app-logged weight → Health. Ship behind the Settings toggle.
- **Phase 2:** export nutrition (energy + macros) per logged day; export
  workouts as `HKWorkout` / `ExerciseSession`.
- **Phase 3:** sleep two-way, water + body-fat export, optional steps read for
  a Today display.

## Open decisions for the owner (grill these before Phase 1)
- **Import cadence:** on app open? a manual "Sync now"? a background delivery
  observer (iOS `HKObserverQuery` — adds a background entitlement + battery
  cost)? Recommend manual + on-open first; background later if requested.
- **Conflict rule** when Health and the app both have a weight for a day:
  newest-wins vs Health-wins vs ask. Recommend newest-`endDate`-wins.
- **Scope of v1:** weight-only (fastest, clearest win) vs weight + nutrition
  export together. Recommend weight-only Phase 1 to derisk permissions UX.
- **Android priority:** iOS-first (HealthKit is the common request) and Health
  Connect as a fast follow, or both at once. Recommend iOS-first.

_No code changes yet — this is the plan. Phase 1 is a focused, dev-build-gated
project once the owner completes Phase 0._
