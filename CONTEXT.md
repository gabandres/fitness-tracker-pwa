# Ignia — Domain Glossary

This file is the canonical name list for Ignia. One concept,
one term. When the codebase still has legacy synonyms, the canonical name
is in **bold** and the synonyms are called out so you know what to grep
for. Architecture decisions live in [`docs/adr/`](docs/adr/README.md).

Keep this file under ~400 lines. It is a glossary, not documentation —
add a term when a real ambiguity exists, not preemptively.

---

## Logging concepts

- **DailyLog** — One row of intake. Fields: `id`, `calories`, `protein?`,
  `carbs?`, `fat?` (grams, added 2026-06 — older rows lack them; treat
  absent as unknown, not zero), `weight?`, `mealLabel?`, `mealType?`,
  `exerciseCompleted?`, and a `date` (a JS `Date`
  derived from a Firestore `Timestamp`). Stored at
  `users/{uid}/dailyLogs/{id}`. Despite the name, a `DailyLog` is a single
  meal/entry — a day usually has several. Arrays of `DailyLog` are
  always returned **oldest-first** (the adapter reverses the underlying
  desc-ordered Firestore query).
- **Log** / **Entry** / **Meal** — All three names appear in the UI and
  code. The canonical type is `DailyLog`. Prefer "log" or "entry" in new
  code; "meal" is fine when the row actually represents food (weight-only
  rows are still `DailyLog`s).
- **MealLabel** — Optional free-text name on a `DailyLog`
  (`log.mealLabel`). Powers the recent-entries one-tap-relog row and
  recipe deduplication. Empty for weight-only or 0-cal training-marker
  rows.
- **MealType / meal slot** — Optional diary slot on a `DailyLog`:
  `breakfast | lunch | dinner | snack` (enum enforced in rules; added
  2026-06-12). Distinct from `mealLabel` (free text — "Quest bar"). The
  day view groups entries by slot with per-slot kcal subtotals; rows
  without one land in an **"other" bucket** and are never silently
  reassigned — a day whose rows are all unslotted renders flat (legacy
  look). New entries default by wall-clock hour
  (`defaultMealTypeForHour` in `utils/meal-draft.ts`); the chip
  selector toggles off so an entry can be deliberately unslotted.
- **MealPreset** / **Preset** — A reusable `{ name, calories, protein? }`
  saved by the user under `users/{uid}/presets`. Free tier capped at
  `PRESET_LIMIT_FREE = 10`. `PresetLimitError` carries the cap so the UI
  can show a specific message.
- **RecipeBuilder** — The "build a recipe" sheet on the entry form. Sums
  several component lines into one preset/log. See
  `src/app/components/recipe-builder/`.
- **CustomFood** — A user-saved, *portionable* food record at
  `users/{uid}/customFoods` (added 2026-07, [ADR-0013](docs/adr/0013-food-resolution-my-foods-library.md)).
  Distinct from **MealPreset**: a preset is a minimal `{name, calories,
  protein?}` quick-add capped at 10; a `CustomFood` carries `brand?`,
  `barcode?`, a **serving definition** (`servingSize` + `servingUnit`,
  grams-first), full per-serving macros, and a `source`
  (`barcode | label | text | manual`). Logging is `quantity × serving` and
  writes a **macro snapshot** into the `DailyLog` (never a reference-link, so
  editing the food doesn't rewrite history — same as `WorkoutSession`).
- **My Foods** — The UI surface listing the user's **CustomFood** library +
  recents/favorites for one-tap re-logging. The stickiness/data-lock-in
  engine (mirrors MacroFactor/Cronometer custom-foods).
- **Food-resolution pipeline** — The shared `packages/core` flow that turns
  a **barcode**, a **Nutrition Facts label** photo, or a **text** description
  into an editable macro draft, then a `CustomFood`. Barcode → OFF/USDA-
  Branded live lookup; label → on-device ML Kit OCR + deterministic panel
  parse; text → quantity/unit parse + USDA fuzzy/embedding match. On-device
  and $0 by default; an LLM decomposes *only* (never emits macro numbers) and
  a paid cloud vision-LLM is a rare opt-in fallback. See
  [ADR-0013](docs/adr/0013-food-resolution-my-foods-library.md). NOT the same
  as the legacy meal-photo `analyzePhoto` path (deliberately de-emphasized —
  meal-photo guessing has a ~26–36% error floor).
- **ResolvedProduct** — One Open Food Facts product reduced to a **single
  nutriment basis**, the output of `resolveOffProduct(body, barcode)` in
  `packages/core/src/off-product.ts` (the barcode arm of the
  **food-resolution pipeline**). The basis precedence is the whole point:
  per-serving when the product declares a serving weight, else per-100g, else
  per-serving macros with `grams: null` — so the returned `grams` always
  describes the same portion as the returned macros (ADR-0013 honest grams).
  Carries the barcode-keyed `serving` save-context both frontends previously
  assembled by hand. Pure: each frontend keeps its own `fetch` and scanner
  adapter (web `BarcodeService` = `BarcodeDetector`, mobile
  `lib/barcode.ts` + expo-camera). Failures raise `OffLookupError` with a
  `FOOD_NOT_FOUND` / `FOOD_NO_NUTRITION` code — the module never emits a
  user-facing string, so callers translate. **Not** the same path as
  `functions/src/food-search.ts` `buildOffServings`, which serves the cached
  `getFoodDetail` portion picker, emits `ServingOption[]`, and stays separate
  by ADR-0013 step 2.
- **FoodSearch** — The shared client for the `searchFoods` / `getFoodDetail`
  Cloud Functions (typeahead over FDC + OFF → portion picker). Lives once in
  `packages/core/src/food-search.ts`: the wire types (`FoodSearchHit`,
  `ServingOption`, `FoodDetail`), legacy-tolerant `normalizeHit`/`normalizeDetail`,
  the unit-preference `sortServings`, and a transport-injected `makeFoodSearch(call)`
  client. Each frontend supplies a one-line transport adapter (web
  `CallableGateway`, mobile `httpsCallable`); `functions/src/food-search.ts` is
  the server wire source (separate project, kept in sync). **FoodDbSource**
  (`'fdc' | 'off'`, which *database*) is distinct from the CustomFood
  **FoodSource** (`'barcode' | 'label' | 'text' | 'manual'`, how it was *captured*).
- **Firestore mappers** — The shared doc→domain read-path mappers, single-sourced
  in `packages/core/src/firestore-mappers.ts` (the read-path twin of
  `prune-undefined`, the write-path pruner). Owns the `Timestamp → Date`
  conversion (via a structural `TimestampLike { toDate(): Date }` — no `firebase`
  import, ADR-0012), the `oldestFirst` reverse (see *Log array order*), and the
  per-collection mappers `toDailyLog` / `toMeasurement` / `toCustomFood` /
  `toWeeklyReport` / `toDomainProfile`(+`Patch`). Mobile's `lib/ledger.ts` maps
  here (the web `FirestoreLedgerCore` did too until ADR-0036 retired it),
  keeping its own `onSnapshot`/`getDocs` I/O and the `Timestamp` import. The
  three **workout** mappers (`toWorkoutExercise` / `toWorkoutTemplate` /
  `toWorkoutSession`) are also shared, in the sibling
  `packages/core/src/workout-mappers.ts` (arch review E) — they return the
  un-barreled `workout.ts` read-model types and do the field-copy + `toDate`
  only; the web adapter post-applies `normalizeClusterGroups` where mobile does
  not, so that one asymmetry stays at the call site, not in the shared mapper.
- **Firestore writers** — The shared domain→doc **write-path** serializers in
  `packages/core/src/firestore-writers.ts`, the twin of the mappers above. Every
  stored shape both apps write is assembled there (`toLogDoc`/`toLogPatch`,
  `toPresetDoc`, `toCustomFoodDoc`, `toMeasurementDoc`/`Patch`, `toExerciseDoc`,
  `toTemplateDoc`/`Patch`, `toSessionDoc`/`Patch`) plus `BATCH_CHUNK`, so a new
  field lands once and neither adapter can drift past `firestore.rules`.
  Where a read could recognize a `Timestamp` structurally, a write must
  **produce** SDK values, so each adapter injects a **DocCodec**
  (`{ timestamp(d), remove() }` → `Timestamp.fromDate` / `deleteField`) — the
  same injection `prune-undefined` uses for `isOpaque`. Two conventions: create
  paths return a typed doc while **patch** paths return a loose record (a
  sentinel-or-value field can't be typed honestly), and `now` is always a
  parameter, never an SDK `now()` call, so stamps stay assertable. The adapters
  keep all I/O, the collection paths, their `pruneUndefined` binding, and
  `mergeExercises` (a rewrite rule over fetched docs, not a serializer).
- **Daily scalars** — The four per-day, one-number-per-doc collections keyed by
  `dateKey`: `dailyWeights` (lb), `dailyWater` (fl oz, legacy `ml` branch),
  `dailySleep` (hours), `dailyActivity` (`{steps?, activeKcal?}` — both metrics
  in one doc, so a day may carry either, both or neither). Distinct from the
  *shaped* collections the Firestore mappers handle; their readers live in
  `packages/core/src/daily-scalars.ts` (`readWeightLb` / `readWaterFlOz` /
  `readSleepHours` / `readActivity`) and both adapters call them, so the `ml`
  fallback and the "absent ≠ zero" rule exist once. `readWaterFlOz` rounds the
  legacy branch for display and takes `{ exact: true }` for the Health importer,
  which must not diff against a rounded value.
- **Meal slot default** — `withDefaultMealSlot` (core `meal-slots.ts`), applied
  at the **write** (`addLog`, both adapters), never by a form. Fills an absent
  `mealType` from the entry's own timestamp; an explicit choice always wins and
  marker rows (`exerciseCompleted`, weight-bearing) stay untagged. Widget/tile
  quick-add deliberately bypasses it — it writes through `addLogWithId`.
- **Legacy log fields** — `liftCompleted` and `cardioCompleted` exist on
  historic docs. New writes only set `exerciseCompleted`. Aggregation
  treats any of the three as "exercised that day". `toLogPatch` removes both on
  every edit, so any row that gets touched migrates forward.
  **`cardioCompleted` is NOT the cardio feature and must not be revived by it.**
  A **Cardio block** (below) lives on the `WorkoutSession`, not on the
  `DailyLog`; finishing a session still stamps only `exerciseCompleted`, and
  the marker log it writes is worth **zero** calories however much a ring
  reported (`WORKOUT_MARKER_KCAL`). The name collision is the whole reason this
  sentence exists.

## Time windows over logs

These three windows look similar and are NOT interchangeable. See
[ADR-0004](docs/adr/0004-log-window-typed-queries.md).

- **RecentLogs** — A **14-ROW rolling cache** (mobile `useToday`'s recent
  rows; the web's `FitnessStore.logs()` until ADR-0036). A heavy logger
  (7 meals/day) sees ~2 days; a sparse logger sees weeks. Use it for the
  "recent entries" row, today's totals, the budget-crossed signal — any
  consumer that wants "the latest N rows", not "the last N days".
- **AllTimeLogs** — every `DailyLog` the user owns (mobile `useHistory`).
  Lazily hydrated; may be empty until then — gate derived values on the
  hydration flag. Source of truth for any calendar-day window.
- **LogWindow** — `logWindow(...)` in `packages/core/log-window.ts`. The
  canonical "last N calendar days" query. Always prefer this over slicing `_logs`
  or doing millisecond arithmetic (which drifts across DST).
- **HistoryWindow** — The discriminated `{ loaded: false } | { loaded:
  true; logs }` returned by `logsForLastDaysState(n)` and
  `allHistoryState()`. The lazy all-time cache is empty until it hydrates,
  and "empty window" must not be confused with "not loaded yet" — so the
  load state rides in the return type and a caller can't reach `logs`
  without handling `loaded: false`. Replaced the old bare-array
  `logsForLastDaysSync` + manual `isHistoryHydrated()` gate. See
  [ADR-0004](docs/adr/0004-log-window-typed-queries.md).
- **Free-tier 90-day cap** — `CHART_HISTORY_DAYS_FREE = 90`. Applied
  inside `allTimeLogs()`; the underlying `_allTimeLogs` stays uncapped
  so CSV export and `monthlySummary` still see lifetime history.
- **TierLimits** — `src/app/models/tier-limits.ts`, the one module that
  states what "free" means: `PRESET_LIMIT_FREE`,
  `CHART_HISTORY_DAYS_FREE`, `CUSTOM_TEMPLATE_LIMIT_FREE`,
  `WORKOUT_HISTORY_DAYS_FREE`. Never re-declare these numbers; the gate
  check itself stays `SubscriptionService.isPaid()`. Server-side photo /
  consultation caps live in `functions/src/daily-quota.ts` (deliberate
  twin, no shared package).

## Aggregations

- **DaySummary** — The canonical per-day rollup
  (`src/app/utils/day-summary.ts`). Pure function: `summarizeDay(dateKey,
  logs, dailyWeights?)`. Returns `{ dateKey, totalCalories, totalProtein,
  mealCount, exercised, weightLb }`. Used by the Today card, weekly-
  report prompt, CSV export, milestone math. See
  [ADR-0003](docs/adr/0003-day-summary-as-pure-module.md). `mealCount`
  is also exposed as `count` via `FitnessStore.summaryFor()` for legacy
  callers.
- **WeeklyReport** — The Gemini-generated narrative readout, **Pro-only**,
  cached under `users/{uid}/reports`. State lives in `WeeklyReportStore`.
  Generation gates server-side in the `generateWeeklyReport` Cloud
  Function (entitlement check + 6-day rate limit + admin-SDK writes).
  Past reports stay readable on tier downgrade; only new generations
  are blocked.
- **Coach panel** — The single Trends *AI surface* that presents two
  actions with their own gates: **"Ask the coach"** (the free, quota'd
  consultation Q&A — 3 free / 30 paid; shown first as the free hook) and
  the Pro **WeeklyReport** (lock badge inline → upsell when free).
  Replaced the former two stacked AI cards. Names only the surface; the
  consultation flow and `generateWeeklyReport` CF are unchanged.
- **WeeklyDigest** — The transactional weekly email, **free for opted-in
  users**, computed entirely server-side in the `weekly-digest` Cloud
  Function. Distinct from `WeeklyReport`: the digest is short, email,
  rule-based; the report is long-form, in-app, AI-generated.
- **Weekly insights** — The **free, rule-based** *computation*
  (`utils/weekly-insights.ts`, pure): best/toughest day vs target, avg vs
  target, and a least-squares weight slope. The $0 sibling of
  **WeeklyReport** — no AI, computed client-side from `DaySummary[]`. Don't
  conflate the two: insights = free/rules; report = Pro/Gemini/long-form.
  Sibling computations from the same module: **WeeklyBudget** (calorie
  banking over the ISO week, `weekly-budget.ts`) and the
  **WeightProjection** (linear-fit forecast, also `weekly-insights.ts`).
- **Weekly panel** — The single Trends *surface* that presents the
  **Weekly insights**, **WeeklyBudget**, and weekly-averages
  (avg kcal/protein, adherence %, weight Δ) computations through one
  toggleable card. Replaced the former four-card stack (averages +
  insights + budget as separate cards). The underlying computations stay
  distinct and separately named; "Weekly panel" names only the surface so
  "Weekly insights" no longer doubles as both a computation and a card.
- **Trends card contract** — The rule that every Trends card is in exactly one
  of three states and decides which ITSELF, from its own evidence, with no
  user-facing switch (ADR-0034): **absent** (the source has not answered, or
  the feature cannot apply), **stub row** (it applies but has too little data —
  one hairline-bounded row, which must ACT and must not lie about *why* it is
  empty), or **card**. **Names the states a surface may be in, not a surface**
  — so it does not collide with **Weekly panel** or **Coach panel** above,
  which name surfaces, nor with Today's **Nudge vs utility** rule, which is
  about priority among promotional prompts. The gate lives in `packages/core`
  as a pure function returning `null`, so no component holds a threshold.
  This is what Trends has instead of configuration.
- **MonthlySummary** — `FitnessStore.monthlySummary()`. 30-day stats:
  weight delta, adherence %, avg calories, weight count, etc.
- **TodaySummary** — `{ totalCalories, totalProtein }` for the current
  local date. Read off `FitnessStore.todaySummary()`.

## Targets + derivations

- **DailyTargets projection** — `dailyTargets(profile, logs, dailyWeights)`
  in `packages/core/src/targets.ts`: the one pure home for the
  TDEE → calorie-target → protein-target → current-weight chain, plus the
  `mergeDailyWeights` overlay, `currentWeight` resolution, `toProfileFields`
  gate, and `computeGoalProgress`. **Both** frontends derive targets from it
  (mobile `useDailyTargets`)
  — the web store no longer re-implements the precedence inline, it only
  assembles the snapshot (it alone picks the source-log window). Change the
  target math here, not per-frontend.
- **TDEE** — `FitnessStore.tdee()` (reads `DailyTargets projection`).
  Switches between **formula mode** (Mifflin-St Jeor with the user's
  profile) and **measured mode** (weight trend + calorie history once
  there's enough signal). Result includes `source: 'formula' | 'measured'`
  and `newDailyTarget`.
- **TargetCalories** — `FitnessStore.targetCalories()`, derived by
  `dailyTargets` in `@macrolog/core`. The user-facing daily kcal goal.
  Resolution order:
  1. `tdee.newDailyTarget` when TDEE is **measured AND reliable**.
  2. Manual heuristic target from 2-question onboarding
     (`profile.manualCaloriesTarget`, weight × {11|14|17} by goal).
  3. `tdee.newDailyTarget` (Mifflin-St Jeor formula, or the seed fallback).
  Whichever branch wins is then clamped up to **`profile.calorieFloor`**
  (default `MIN_DAILY_TARGET`, 1500) on the way out of `dailyTargets` — the
  clamp used to live inside `calculateTdee`, where it covered only branches
  1 and 3, so a manual or seed target could sit below the user's floor.
  The Day-3 Refine Targets sheet stamps **`targetsRefinedAt`** on the
  profile, the latch that hides the prompting card and drops the manual
  targets. Invariant: **`targetsRefinedAt` present ⟺ manual targets
  absent** — re-running onboarding clears the stamp.
- **ProteinTarget** — `FitnessStore.proteinTarget()`, same projection.
  Resolution order: `profile.proteinPerKg` live off current weight →
  frozen `manualProteinTarget` snapshot → the **1.6 g/kg** default. Clamped
  up to **`profile.proteinFloor`** if set; unlike the calorie floor it has
  no default, so unset means no floor. `proteinMinTarget()` is the
  1.6 g/kg muscle-retention reference and is deliberately NOT clamped —
  it is a physiological minimum, not a user preference.
- **Streak** — `FitnessStore.streak()`. Consecutive days with at least
  one log. Pro users get `STREAK_FREEZE_MAX_GAP_PRO = 7` consecutive
  missed days tolerated mid-streak; `streakFreezeUsed()` is true when
  the active streak only spans because a gap was forgiven.
- **Milestone** — A **record of something the user already did**, stored one
  document per key at `users/{uid}/milestones/{key}` = `{ earnedAt }`
  (`packages/core/src/milestones.ts`). Write-once: `firestore.rules` denies
  `update`, so a broken **Streak** cannot remove one and `earnedAt` cannot move.
  **The word "achievement" is deliberately not used, and neither is a badge.**
  `UX_AUDIT.md` §S12 rejects shame-based gamification; Milestones are a
  *narrowing* of that, permitted because a retrospective record applies no
  forward pressure while a meter does. Nothing in the app may name an unearned
  Milestone or the distance to one — the core module cannot express it and two
  tests fail the build if that changes. Locale names are **Hitos** (es-PR) and
  **Marcos** (pt-BR), never *Logros* / *Conquistas*. Distinct from **Streak**,
  which is a live count that can fall to zero: a Milestone is what a Streak
  *reached* once. Its Today surface is a **utility**, not a **Nudge**.
- **GoalProgress** — `{ startWeight, currentWeight, goalWeight, pct,
  remaining }`. Driven by `currentWeight` (overlays `dailyWeights` then
  falls back to `log.weight`).
- **EMA** — Exponentially weighted moving average of daily calories.
  Used by the trend chart.

## Body

- **Weight** — Always lb. Daily weight is **one row per local-date key**
  in `users/{uid}/dailyWeights/{YYYY-MM-DD}` (a flat map collection, not
  a time series of rows). The `mergeDailyWeights` helper overlays this
  map onto `DailyLog.weight` so derivations don't miss daily-weight-only
  users.
- **Plausible weight** — `packages/core/src/weight-bounds.ts` (pure,
  shared by both frontends): `checkWeightEntry(lb, prev?)` (soft 50–500 lb
  range hard-reject + a day-over-day `WEIGHT_DELTA_WARN_LB` confirm) and
  `isStorableWeight` (absolute 30–700 store backstop). The one home for "is
  this a real logged bodyweight" — web logger, mobile logger, workout-finish
  mirror, and store backstop all call it. NOT the calculator/onboarding
  INPUT range (`CALC_WEIGHT_MIN_LB`/`CALC_WEIGHT_MAX_LB` in
  `macro-heuristic.ts`, 60–700) — that bounds what a user may *type* into
  the TDEE calculator; renamed apart so the two never collide in the shared
  barrel.
- **Measurement** — `users/{uid}/measurements`. Optional waist / chest
  / bicep / hip / neck (inches) per dated row (`neck` added 2026-06 for
  the body-fat estimate). Latest two are exposed as `latestMeasurement`
  + `previousMeasurement` with a `measurementDeltas` derivation.
- **Body-fat estimate** — U.S. Navy circumference formula
  (`utils/body-fat.ts`, pure): waist + neck + height (+ hip for female)
  → est. %. Always framed as an estimate, never clinical. Surfaced on
  the Body tab off the latest **Measurement** + profile height/sex.
- **Progress Photo** — *Removed 2026-07-05* (pre-launch scope cut to shrink the
  health-data/breach surface; [ADR-0010](docs/adr/0010-progress-photos-firebase-storage.md)
  is now reverted). Was a dated, owner-private before/after body photo in
  **Firebase Storage** at `users/{uid}/photos/{date}.jpg`. No longer written by
  either app; Storage is deny-all and account deletion still purges any legacy
  `users/{uid}/photos/` bytes (`functions/src/gdpr.ts`).
- **Water** — Stored in **US fluid ounces** under
  `users/{uid}/dailyWater/{YYYY-MM-DD}` as `{ flOz }` (the app is imperial
  throughout). Docs written before the 2026-06 unit migration carry `{ ml }`;
  reads fall back to converting them, so an unrewritten legacy doc still
  renders. Every write clamps to `[0, WATER_MAX_FLOZ]` (676 fl oz, ~5 gal,
  mirrored in `firestore.rules`) via `clampWaterFlOz` in
  `packages/core/src/health-mapping.ts` — the canonical bound, applied by both
  Firestore adapters, the in-memory adapter, and `BodyMetricStore`. Sleep is
  the same pattern: `{ hours }` per date, `clampSleepHours` → `[0, 24]` snapped
  to the half hour.
- **FastWindow** — The fast that is running RIGHT NOW, and nothing else.
  Owned by `FastingStore`; profile carries `fastStartedAt`. `isFasting()` is
  computed from the start time being non-null. **There is no target and there
  never was one** — this entry said "target 16h" until 2026-08-26, when
  ADR-0032 went looking and found no `fastGoal`, `fastingGoal` or
  `targetFastHours` anywhere in `packages/core`, `apps/mobile` or `src/app`.
  A goal is deferred on purpose (ADR-0032), so nothing may render one.
- **CompletedFast** — A fast that has ENDED, stored as an interval in
  `users/{uid}/fasts` (ADR-0032, #97). Distinct from **FastWindow**, which is
  the running one: a document exists here only once the fast is over, and
  `fastStartedAt` is the pointer to the one that is not. Before #97 there was
  no such thing — `breakFast` nulled the profile field and the fast was gone.
- **CompletedFastHours** — The length of the fasts that ENDED on a given day
  (`completedFastHours` in `packages/core/src/fasting-history.ts`). The
  headline number, and the one in History rows and the CSV. One fast lands on
  exactly one day.
- **FastingOverlapHours** — How many of a given day's own hours were spent
  fasting, intersecting each interval with `dayRange` (`fastingOverlapHours`).
  Bounded to [0, 24]; an overnight fast marks BOTH days. **Not
  interchangeable with CompletedFastHours** — different question, different
  rule, and a test asserts the two disagree. Neither is called "fasting
  hours".

## Workout (Train tab)

See [ADR-0007](docs/adr/0007-workout-train-tab.md). Three user-owned
collections + a `WorkoutStore` facet back the Train tab.

- **Exercise** — Per-user catalog entry at `users/{uid}/exercises`. The
  stable identity (`exerciseId`) that progression charts + PRs aggregate
  over. Shipped library lives in `models/workout-seed.ts`
  (`EXERCISE_LIBRARY`); cloned into the user's catalog on demand.
- **WorkoutTemplate** — Editable blueprint at
  `users/{uid}/workoutTemplates`. Ordered `TemplateExercise[]` (each
  references an `exerciseId` + snapshot name, plus `targetLoad`, `cues`,
  a `ProgressionRule`, and a `plannedSets` scaffold). Rest config
  (`restMiniSec` / `restClusterSec`) lives on the template, not the
  session. Free-tier cap `CUSTOM_TEMPLATE_LIMIT_FREE = 3` (cosmetic,
  like `PRESET_LIMIT_FREE`).
- **WorkoutSession** — One logged instance at
  `users/{uid}/workoutSessions`. Starting a session **snapshots** the
  template's exercises into the session doc, so template edits never
  rewrite history. `status: 'active' | 'completed'` drives live-write +
  resume; there is at most **one active session** (enforced in
  `WorkoutStore.startSession`). The session's `date` is stored as the
  `timestamp` field at the seam.
- **Cardio block** — The canonical term for one logged cardio effort: a run, a
  ride, a walk. Type `CardioBlock` in `packages/core/src/cardio.ts`, stored as
  `cardio: CardioBlock[]` **on the session**, beside `exercises[]`
  ([ADR-0025](docs/adr/0025-cardio-is-a-block-on-the-workout-session.md)). Not
  a "cardio session", not a "cardio entry", and **not** the legacy
  `cardioCompleted` log flag (see "Legacy log fields"). A lifting day with a
  finisher is ONE session carrying both arrays; a run on its own is a session
  with `exercises: []`. That is what keeps Train to one history, one streak
  marker and one template concept, and it is why no strength derivation may
  read `cardio` — pinned by `cardio-strength-independence.test.ts`.
  - **Modality** — the closed union of what the effort was (`run | walk | ride
    | swim | row | elliptical | stair | hike | sport | other`). `other` plus a
    free-text `label` absorbs everything else rather than growing the union.
  - **RPE** — perceived effort, 1-10, the cardio counterpart of RIR. Optional;
    a `durationSec` alone is a complete block (`isLoggedCardioBlock`).
  - **Reported kcal** — `CardioBlock.kcal` is what the device said, rendered as
    **display provenance only**. It never reaches a target: past 14 logged days
    the target comes from energy balance, which already contains the workout
    ([ADR-0024](docs/adr/0024-continuous-activity-multiplier-floored-at-fao-minimum.md)
    decision 4, extended to the event stream). Pinned by
    `cardio-energy-independence.test.ts`.
  - **Source vs provider** — `source` is `manual | health` (how it got here);
    `provider` is which wearable authored it (`oura | apple-watch | garmin |
    whoop | other`). Apple Health is a *store*, not a source
    ([ADR-0026](docs/adr/0026-oura-through-the-os-health-store.md)).
  - **The naming footgun** — `CardioBlock.durationSec` is how long ONE effort
    took; `WorkoutSession.durationMin` is how long the whole gym session took.
    Different unit, different question, one careless autocomplete apart. Both
    declarations carry a doc comment saying so.
- **SetKind** — `warmup | activation | working | mini | drop | mobility`. A
  set's optional `group` clusters it (C1/C2); no group → plain straight set.
  Warmups, drops and mobility are excluded from PR + progression math.
  `mobility` shipped 2026-08-27 per
  [ADR-0028](docs/adr/0028-stretching-mobility-model.md). The union is
  hand-mirrored in **FOUR** places, not three — `packages/core/src/workout.ts`,
  `src/app/models/workout.ts`, `apps/mobile/src/lib/workout.ts`, and the web
  template editor's `SET_KINDS`; missing the last compiles cleanly and silently
  never offers the kind. Read the three entries below **before** using any of
  these three words, because two of them already mean something narrower than
  they sound.
- **Warm-up** — **the load ramp for one lift, and nothing else.** Two things
  carry the name: `packages/core/src/warmup.ts`, whose `generateWarmup()`
  produces empty bar → ~50/70/90% of the working weight; and the `SetKind`
  value `'warmup'`, which `isWorkingSet` excludes from PR and progression math.
  **It is NOT stretching, mobility work, or a general pre-session routine** —
  in RAMP terms (Jeffreys 2006) it is *Potentiate* alone. The stored string
  `'warmup'` keeps its value: renaming it is a Firestore data migration for a
  cosmetic gain. ([ADR-0028](docs/adr/0028-stretching-mobility-model.md))
- **Activation** — **cluster-training vocabulary, not RAMP's "Activate".** The
  `SetKind` value `'activation'` is the set that *opens a cluster*, with the
  `mini` sets after it inheriting its group number (`cluster-groups.ts`). It
  says nothing about warming a muscle up. Mapping RAMP's letters onto `SetKind`
  is wrong in a way the type system cannot catch, which is why
  [ADR-0028](docs/adr/0028-stretching-mobility-model.md) rules that **RAMP's
  letters are never identifiers.**
- **Mobility set** — the canonical term for a stretch, a hold or a joint-prep
  movement: a catalog `Exercise` with `logStyle: 'time'`, no `ProgressionRule`,
  logged as a `WorkoutSet` of kind `mobility` inside the ordinary `exercises[]`
  array. It is **not** a new collection, not a block on the session, and not a
  `phase` field — **position in the ordered array is the pre/post
  distinction**, because the array already renders in order and a stored
  position could drift out of sync with it.
  ([ADR-0028](docs/adr/0028-stretching-mobility-model.md))
  - **"Stretch" is user-facing English for one movement** ("Couch stretch"),
    never the name of the feature or of a type. A stretch is one kind of
    mobility work; mobility is the wider concept.
  - **Mobility is invisible to every strength derivation**, by the same
    mechanism warmups already are — `isWorkingSet` excludes it, so
    `computeExercisePRs`, `metricForSet` and `trainHeroStats.topSet` skip it.
    Without that exclusion a 60-second pre-lift hold would set a
    `maxDurationSec` PR and the app would congratulate the user for the one
    thing the evidence says costs strength.
  - **The copy rule is part of the vocabulary.** Nothing anywhere may say or
    imply that stretching reduces soreness, aids recovery or prevents injury —
    the Cochrane evidence tests that claim and rejects it. Only two claims are
    defensible: range of motion improves with bounded-dose stretching, and a
    structured dynamic warm-up is the supported pre-training practice.
  - **Third member of the `durationSec` neighbourhood.** `WorkoutSet.durationSec`
    is a hold; `CardioBlock.durationSec` is how long one effort took;
    `WorkoutSession.durationMin` is the whole session, in minutes. Two of the
    three are seconds. See "The naming footgun" above.
- **Progression / PRs** — Pure module `utils/workout-progression.ts`
  (per [ADR-0003](docs/adr/0003-day-summary-as-pure-module.md)):
  `suggestProgression` (deterministic double-progression — hit
  `targetReps` for `holdSessions` → `+incrementLb`), `computeExercisePRs`
  + `estimateOneRepMax` (Epley). No AI in v1.
- **Train view derivations** — The session/screen layer over the module above,
  in `packages/core/src/train-view.ts`: `trainHeroStats` (7-day count +
  volume + all-time top WORKING set), `sessionVolume`, `bestE1RMByExercise` +
  `improvedExercises` (the PR-celebration crossing), `exerciseHistory` +
  `exerciseSeries` (sparkline, oldest-first), `workingSetCells`,
  `lastPerformed`, `exerciseIsFullyDone`, `sessionCounts` / `templateCounts`.
  Both Train tabs read these; each renders its own wording, so nothing here
  takes a translator. They were per-frontend copies until 2026-08-09 and had
  diverged on what counts as a top set.
- **RestTimer** — `components/train/rest-timer.ts`. The between-set rest
  countdown, one instance per session sheet (plain class, not
  injectable). Interface: `start(s)` / `stop()` / `remaining` / `label`;
  the interval handle, tick, clamp, and `m:ss` formatting are internal.
  Mini-sets get `restMiniSec`, everything else `restClusterSec` (both
  off the template).
- **finishWorkout** — Hub orchestration on `FitnessStore`: flips the
  session to `completed`, mirrors session bodyweight into `dailyWeights`,
  and stamps the day's exercise marker via `markExercised`.
  `WorkoutStore` owns no cross-cutting writes (no circular dep). Free
  exercise-history window `WORKOUT_HISTORY_DAYS_FREE = 30` (like
  `CHART_HISTORY_DAYS_FREE`).

## Profile

- **Profile** — The **domain** shape of the user doc, exposed by
  mobile's `subscribeProfile` in `lib/ledger.ts` (the web `LEDGER_PORT.profile` until ADR-0036). All date
  fields are JS `Date | null` (`createdAt`, `lastSeenAt`,
  `ageConfirmedAt`, `onboardingV2CompletedAt`, `targetsRefinedAt`,
  `compedUntil`, `welcomeEmailSentAt`, `lastWeeklyDigestSentAt`,
  `referralRewardGrantedAt`). UI/derivations only ever see `Profile`.
- **UserProfileDoc** — The **stored** shape at `users/{uid}`. Identical
  to `Profile` except every date is a Firestore `Timestamp`. Lives only
  inside the Firestore adapter and the Cloud Functions; never crosses
  the ledger seam. The adapter's `toDomainProfile` / `toProfileDoc`
  mapper is the single conversion point — see the *Date type at the
  seam* convention below.
- **FirestoreLedgerCore** / **LEDGER_PORT** / **FirebaseService** — RETIRED
  2026-08-30 with the web logging app (ADR-0036). They were the web's
  Firestore adapter behind a hexagonal port (ADR-0009). Mobile's
  `apps/mobile/src/lib/ledger.ts` is now the only client implementation
  of every collection verb; `firestore.rules` is the contract.

## Stores — RETIRED (ADR-0036)

`FitnessStore` and its facets (`FastingStore`, `BodyMetricStore`,
`WorkoutStore`, `WeeklyReportStore`, `MilestoneTracker` — ADR-0005) were the
web logging app's reactive layer and went with it on 2026-08-30. The
derivations they owned (TDEE, targets, streak, weekly, envelope, EMA, goal
progress, summaries) live in `packages/core` and are consumed by mobile's
per-tab hooks (`useToday`, `useHistory`, `useBody`, `useTrain` — ADR-0016).
When a doc still names a `FitnessStore.*` accessor, read it as "the mobile
hook that owns that slice".

## External systems

- **Firestore** — User-owned collections under `users/{uid}/`:
  `dailyLogs` (the per-meal `DailyLog` rows), `dailyWeights` (flat
  `{YYYY-MM-DD: lb}` map, one doc per date), `dailyWater` (same shape,
  ml), `presets` (`MealPreset`), `customFoods` (`CustomFood` library,
  [ADR-0013](docs/adr/0013-food-resolution-my-foods-library.md)), `reports`
  (`WeeklyReport` cache), `measurements`. Profile fields live directly on
  `users/{uid}`.
- **Food databases** — Grounding sources for the **food-resolution
  pipeline**. **USDA FoodData Central** (CC0 public domain): a curated
  whole-foods subset (~1–2 MB) is bundled/precached client-side. **Open Food
  Facts** (ODbL — share-alike on cached copies): queried **live** for
  barcodes with attribution, never bundled. See
  [ADR-0013](docs/adr/0013-food-resolution-my-foods-library.md).
- **Gemini** — Two paths. **Client-key** path drives in-app chat /
  photo-macro analysis from the browser, protected by referrer + API
  restrictions on the GCP key (the key is in the bundle). **Server-key**
  path drives the `generateWeeklyReport` Cloud Function — runs under
  admin SDK with the entitlement check. See
  [ADR-0002](docs/adr/0002-firestore-no-backend-architecture.md).
- **Cloud Functions** — Key callables: `analyzePhoto` (photo macros),
  `generateWeeklyReport` (Pro-gated), `exportUserData` / `deleteAccount`
  (GDPR), `consultationStream` (SSE AI coach — onRequest, server-held
  Gemini key, verifies ID token + reserves the consultation quota),
  `checkAccessStatus`, `sendPasswordReset`, `sendVerificationEmail`.
  **Schedules: exactly three, and that is a hard ceiling** —
  `hourlyTasks`, `statusPulse`, `weeklyFirestoreBackup`. Cloud Scheduler's
  free tier is 3 jobs and all 3 are spent, so recurring work folds into
  the `hourlyTasks` dispatcher rather than getting its own `onSchedule`
  (see `CLAUDE.md`). Daily reminders, the day-three coach push, the weekly
  digest and the user-count publish are **tasks inside that dispatcher**,
  not functions — this list previously named them as schedules, which
  reads as headroom that does not exist. Triggers: `onDailyLogCreated`,
  `onSubscriptionWritten`, `sendWelcomeEmail`.
- **CallerAccess** (`functions/src/caller-access.ts`) — the Cloud
  Functions caller-resolution module: auth check, per-uid rate limit,
  and tier resolution in one `resolveCaller(request, rateLimit?)` call.
  `CallerTier` = `admin | comped | paid | free`; `comped` folds together
  the `config/accessList` friends list AND a future referral
  `compedUntil` — both grant the same unlimited tier everywhere (see
  [ADR-0008](docs/adr/0008-cf-caller-access-daily-quota.md)). Admin
  email list lives here (sync with `subscription.service.ts`).
- **AdminGuard** (`functions/src/admin-guard.ts`) — the claim-based admin
  gate: `requireAdmin(request, message?)` throws unless the caller carries
  the `admin` custom claim (set by `setAdminClaims`), then returns the
  audit-ready `AdminCaller` `{ uid, email }`. `writeAuditLog` takes that
  `admin` and stamps `adminUid`/`adminEmail` itself, so no callable
  hand-writes the pair. The single home the admin callables (`admin-ops`,
  `admin-claims`, `impersonation`) share. Distinct from
  `CallerAccess.isAdmin` (an email-list, Firestore-free quota-bypass check):
  AdminGuard *gates access* on the claim, CallerAccess *bypasses quota* on
  the list — different questions, so it stays a pure function, not a method
  on the db-backed CallerAccess.
- **DailyQuota** (`functions/src/daily-quota.ts`) — the daily-quota
  ledger for the `photo` and `consultation` kinds. Owns the
  `${uid}_${utcDay}` doc-key format, per-tier limits (3 free / 30 paid),
  the atomic `reserve` transaction, the never-below-zero `release`
  refund, `peek`, the admin `resetToday`, and the GDPR `deleteAll` /
  `dump` walks. Callables only decide *whether* a caller is subject to
  quota (`Caller.unlimited`); this module decides everything else.
  Emulator-tested in `functions/test/`.
- **`CallableGateway`** (`services/callable.gateway.ts`) — the single
  client→callable seam. `Functions` is injected once here, not in each
  service. `call<Req, Res>(name, payload?)` collapses the
  `httpsCallable(...)` → `await fn(payload)` → `.data` dance into one
  line and returns `.data` unwrapped. `CallableName` is the union of all
  first-party function names (autocomplete + typo protection; the
  runtime-namespaced `ext-*-createPortalLink` widens to `string`). Add a
  new callable's name to that union. Future cross-cutting concerns
  (error mapping, telemetry, retry) belong in `call()`, not at sites.

## UI surfaces (post-#4 rename — see [ADR-0006](docs/adr/0006-drop-v2-suffix-component-naming.md))

These are the top-level routes / tabs. Each has a component folder of
the same name under `src/app/components/`.

- **Today** — Tab. Current-day summary, log entry, plus a **Nudge** and
  any contextual **utility** cards (see below).
- **Nudge** vs **utility** (Today) — A **Nudge** is a promotional/optional
  prompt: what's-new banner, Day-3 refine card, push-enable prompt, iOS
  install hint. At most **one** Nudge renders at a time (priority: refine
  → push → install → what's-new); the rest queue. A **utility** is a
  contextual *action* the user wants (e.g. repeat-yesterday when today is
  empty) — utilities are NOT Nudges and are never gated by the one-Nudge
  rule.
- **Body** — Tab. Weight + sparkline (with **WeightProjection** caption),
  goal progress, collapsible measurements (now also home to
  the **Body-fat estimate**), and a collapsed-by-default Progress Photos
  card last.
- **Trends** — Tab. On web, three surfaces: the 7-day chart, the **Weekly
  panel** (insights ⇄ budget toggle), and the **Coach panel** (free Ask + Pro
  WeeklyReport). Down from the former six stacked cards. Mobile additionally
  carries the **Sleep card** (ADR-0033) and the **Fasting card** (ADR-0034),
  each governed by the **Trends card contract**.
- **Train** — Tab (`/train`). Resume/start a workout, templates (start /
  edit / delete / clone starter), exercise catalog → progression detail.
  Components under `components/train/` (`train`, `session-sheet`,
  `template-editor`, `exercise-detail`).
- **History** — Route (`/history`). Grid of past days.
- **DayDetail** — Route (`/history/{YYYY-MM-DD}`). One-day deep-dive.
- **Settings** — `settings-sheet` component. Profile, data export,
  subscription, sign-out.
- **Ui*** prefix — In the `src/app/components/ui/` folder, class names
  like `UiCard`, `UiButton`, `UiFab`, `UiRing` mark **shared primitives**
  (design-system atoms). They are NOT feature surfaces.

### Mobile-only surfaces (see [ADR-0014](docs/adr/0014-mobile-dark-first-identity-center-log-nav.md))

- **Hero ring** — The mobile Today centerpiece: one concentric dual-ring
  element, calories outer / protein inner (the app icon's geometry), with
  the remaining-kcal count-up in the center. NOT the same as the PWA's
  `UiRing` primitive or the two side-by-side rings it replaced.
- **Log button** — The center-docked "+" in the mobile tab bar (4 tabs +
  center slot). Opens the EntrySheet from any tab. Replaced the
  Today-only FAB; History left the tab bar for the calendar affordance in
  Today's header.
- **Celebration** — A reward animation tied to a *product* event (log
  saved → ring re-sweep + haptic tick; protein target hit → inner-ring
  flare; streak extended → flame-chip animation). Distinct from ambient
  motion (entrances, press-springs), which is not event-tied. No
  confetti/mascot layer by decision.
- **Widget snapshot** — The ~150-byte glanceable blob defined by
  `packages/core/src/widget-snapshot.ts`: today's kcal/protein consumed
  and target, the `dateKey` staleness guard, and the locale. **One term
  for the blob no matter which surface reads it.** The name says "widget"
  because the stored key `ignia.widget.snapshot.v1` cannot change without
  orphaning the blob the already-installed home-screen widget is reading;
  renaming the symbol alone would leave a `Glance*` constant pointing at a
  `"widget"` string, which is more drift, not less
  ([#38](https://github.com/gabandres/fitness-tracker-pwa/issues/38) §6).
- **Glanceable surface** — Any renderer of the widget snapshot: the iOS
  home-screen widget, the three iOS Lock Screen accessory families, the
  Android home-screen widget, the Apple Watch complication, and the watch
  mirror screen. They differ in layout and in empty-state copy; they never
  differ in the decode, the version gate, or the staleness rule. On Apple
  those shared rules live in exactly one file,
  `apps/mobile/targets/_shared/Glance.swift`.
- **Watch mirror screen** — The Apple Watch app's single read-only screen.
  A **reader** of the widget snapshot, not an exception to it: it adds no
  fields and shows the denominators (`1,240 / 2,000`) the face has no room
  for. It is also **link 2 of the watch transport** — WatchConnectivity
  delivers to the watch *app*, never to a complication — so it exists even
  when nobody opens it
  ([#39](https://github.com/gabandres/fitness-tracker-pwa/issues/39)).

## Platforms (post-#12 — see [ADR-0012](docs/adr/0012-expo-native-app-shared-core.md))

Two frontends over one Firebase backend. Both are Firestore-direct clients
under the same security rules (ADR-0002 unchanged).

- **Web shell** (legacy names: **PWA**, **web app**) — The Angular app at the
  repo root. Since ADR-0036 (2026-08-30) it is the marketing/SEO/legal pages
  plus `/admin`; the logging product it used to carry is retired and its old
  routes render a "moved to the apps" page.
- **Mobile app** / **Expo app** — The React Native (Expo) app under
  `apps/mobile/`. **The product** (ADR-0015, ADR-0036). Ships only the
  logged-in *product* surfaces, never the marketing/SEO ones.
- **Shared core** — `packages/core/`: the framework-free brain (pure
  `utils`, `models`, domain types) imported by the mobile app and the
  Cloud Functions. New product logic lands here first. "The math" lives
  here; "the skin" is per-frontend.

## Conventions

- **localDateKey** — `YYYY-MM-DD` in the user's local timezone. The
  canonical key shape across every dated collection (`dailyWeights`,
  `dailyWater`, `DaySummary.dateKey`, all `logsForLastDays` windowing).
  Use `localDateKey(date)` from `src/app/utils/date.ts`; never construct
  date keys ad-hoc.
- **`v2` namespace** — The `v2.*` prefix in i18n keys and the `v2-`
  prefix on CSS classes are **legacy** carried over from the rebuild.
  Do not add new `v2.*` keys, but do not refactor existing ones either.
  See [ADR-0001](docs/adr/0001-v2-rebuild-replaces-v1.md) and
  [ADR-0006](docs/adr/0006-drop-v2-suffix-component-naming.md).
- **Pro vs free** — Real gating is **server-side** via the Stripe
  custom-claim role (`stripeRole=paid`, set by the firestore-stripe-
  payments extension). Client-side `isPaid()` is cosmetic — never use
  it as the only barrier in front of paid functionality. CFs that gate
  Pro features (e.g. `generateWeeklyReport`) check the claim directly.
- **Log array order** — Always oldest-first when returned from the
  ledger port, even though the underlying Firestore query is desc-
  ordered. Adapters reverse before returning.
- **Regression suite** — the Maestro flows in
  `apps/mobile/.maestro/regression/`, the only layer that tests what a
  user can SEE. jest/RNTL runs no Yoga layout pass, so a collapsed or
  clipped view passes every unit test; the suite's **screenshots** are
  the audit and its assertions are only the skeleton. `coverage.md`
  there is the screen × state × platform checklist, and
  `scripts/qa-regression-verify.mjs` is the Firestore ground truth
  behind its end-to-end rows. Not the same thing as the smoke flows one
  directory up in `.maestro/`.
- **Date type at the seam** — Firestore writes use `Timestamp`; the
  ledger port surface always exposes JS `Date`. UI / derivations never
  see `Timestamp`. This holds for **every** dated field, **including
  profile fields** — the port returns [`Profile`](#profile) (Date),
  never the stored `UserProfileDoc` (Timestamp). The Firestore adapter's
  `toDomainProfile` / `toProfileDoc` mapper is the only place the
  conversion happens; a `Timestamp` import anywhere outside the adapter
  (or a `.toDate()` / `.toMillis()` call on a profile field in app code)
  is a bug against this convention.
