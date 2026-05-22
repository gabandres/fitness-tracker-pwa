# Macro Log — Domain Glossary

This file is the canonical name list for the Macro Log PWA. One concept,
one term. When the codebase still has legacy synonyms, the canonical name
is in **bold** and the synonyms are called out so you know what to grep
for. Architecture decisions live in [`docs/adr/`](docs/adr/README.md).

Keep this file under ~400 lines. It is a glossary, not documentation —
add a term when a real ambiguity exists, not preemptively.

---

## Logging concepts

- **DailyLog** — One row of intake. Fields: `id`, `calories`, `protein?`,
  `weight?`, `mealLabel?`, `exerciseCompleted?`, and a `date` (a JS `Date`
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
- **MealPreset** / **Preset** — A reusable `{ name, calories, protein? }`
  saved by the user under `users/{uid}/presets`. Free tier capped at
  `PRESET_LIMIT_FREE = 10`. `PresetLimitError` carries the cap so the UI
  can show a specific message.
- **RecipeBuilder** — The "build a recipe" sheet on the entry form. Sums
  several component lines into one preset/log. See
  `src/app/components/recipe-builder/`.
- **Legacy log fields** — `liftCompleted` and `cardioCompleted` exist on
  historic docs. New writes only set `exerciseCompleted`. Aggregation
  treats any of the three as "exercised that day".

## Time windows over logs

These three windows look similar and are NOT interchangeable. See
[ADR-0004](docs/adr/0004-log-window-typed-queries.md).

- **RecentLogs** — `FitnessStore.logs()` / `_logs()`. A **14-ROW rolling
  cache** populated by `LEDGER_PORT.getRecentLogs(14)`. A heavy logger
  (7 meals/day) sees ~2 days; a sparse logger sees weeks. Use it for the
  "recent entries" row, today's totals, the budget-crossed signal — any
  consumer that wants "the latest N rows", not "the last N days".
- **AllTimeLogs** — `FitnessStore.allTimeLogs()` (UI-facing, tier-gated)
  / `_allTimeLogs` (internal, uncapped) / `rawAllTimeLogs()` (uncapped,
  used by milestone math). Lazily hydrated by `_loadAllTimeLogs()`;
  may be empty until then — gate computeds on
  `FitnessStore.isHistoryHydrated()`. Source of truth for any
  calendar-day window.
- **LogWindow** — `FitnessStore.logsForLastDays(n)` (async, awaits
  hydration) and `logsForLastDaysSync(n)` (computed-safe, returns `[]`
  until hydrated). The canonical "last N calendar days" query. Always
  prefer this over slicing `_logs` or doing millisecond arithmetic
  (which drifts across DST).
- **Free-tier 90-day cap** — `CHART_HISTORY_DAYS_FREE = 90`. Applied
  inside `allTimeLogs()`; the underlying `_allTimeLogs` stays uncapped
  so CSV export and `monthlySummary` still see lifetime history.

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
- **WeeklyDigest** — The transactional weekly email, **free for opted-in
  users**, computed entirely server-side in the `weekly-digest` Cloud
  Function. Distinct from `WeeklyReport`: the digest is short, email,
  rule-based; the report is long-form, in-app, AI-generated.
- **MonthlySummary** — `FitnessStore.monthlySummary()`. 30-day stats:
  weight delta, adherence %, avg calories, weight count, etc.
- **TodaySummary** — `{ totalCalories, totalProtein }` for the current
  local date. Read off `FitnessStore.todaySummary()`.

## Targets + derivations

- **TDEE** — `FitnessStore.tdee()`. Switches between **formula mode**
  (Mifflin-St Jeor with the user's profile) and **measured mode** (weight
  trend + calorie history once there's enough signal). Result includes
  `source: 'formula' | 'measured'` and `newDailyTarget`.
- **TargetCalories** — `FitnessStore.targetCalories()`. The user-facing
  daily kcal goal. Resolution order:
  1. Manual heuristic target from 2-question onboarding
     (`profile.manualCaloriesTarget`, weight × {11|14|17} by goal).
  2. `tdee.newDailyTarget` (Mifflin-St Jeor or measured).
  The Day-3 Refine Targets sheet stamps **`targetsRefinedAt`** on the
  profile, the permanent latch that hides the prompting card and lets
  step 2 take over.
- **ProteinTarget** — `FitnessStore.proteinTarget()`. Resolution order:
  manual onboarding override → `0.75g/lb × currentWeight`.
  `proteinMinTarget()` is the lower-bound 0.70g/lb floor.
- **Streak** — `FitnessStore.streak()`. Consecutive days with at least
  one log. Pro users get `STREAK_FREEZE_MAX_GAP_PRO = 7` consecutive
  missed days tolerated mid-streak; `streakFreezeUsed()` is true when
  the active streak only spans because a gap was forgiven.
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
- **Measurement** — `users/{uid}/measurements`. Optional waist / chest
  / bicep / hip per dated row. Latest two are exposed as
  `latestMeasurement` + `previousMeasurement` with a `measurementDeltas`
  derivation.
- **Water** — Stored in ml under `users/{uid}/dailyWater/{YYYY-MM-DD}`.
  Capped 0–20,000 ml at write time.
- **FastWindow** — Active fasting window, target 16h. Owned by
  `FastingStore`; profile carries `fastStartedAt`. `isFasting()` is
  computed from the start time being non-null.

## Stores (post-#3 split — see [ADR-0005](docs/adr/0005-store-facets-split.md))

- **FitnessStore** (`fitness-store.service.ts`) — The hub. Owns logs +
  presets caches and **all derivations** (TDEE, targets, streak, weekly,
  envelope, EMA, goal progress, today summary, monthly, budget-crossed).
  Coordinates the load lifecycle — its sign-in effect calls into the
  facet stores' `hydrate(...)` / `clear()`.
- **FastingStore** (`fasting-store.service.ts`) — Fasting start/end +
  `isFasting`. Reads profile through `LEDGER_PORT`; no internal state.
- **BodyMetricStore** (`body-metric-store.service.ts`) — Daily weights,
  daily water, measurements. `FitnessStore.goalProgress` still reads
  `dailyWeights()` from here.
- **WeeklyReportStore** (`weekly-report-store.service.ts`) — AI-report
  state + Gemini generation flow + 7-day staleness check. Registers
  lifecycle hooks with `FitnessStore._registerWeeklyReportHooks(...)` to
  avoid a circular dep.
- **MilestoneTracker** (`milestone-tracker.service.ts`) — First-meal
  analytics latch (`localStorage` key `macrolog.first-meal-tracked`) and
  `MilestoneContext` for the weekly-report prompt.

## External systems

- **Firestore** — User-owned collections under `users/{uid}/`:
  `dailyLogs` (the per-meal `DailyLog` rows), `dailyWeights` (flat
  `{YYYY-MM-DD: lb}` map, one doc per date), `dailyWater` (same shape,
  ml), `presets` (`MealPreset`), `reports` (`WeeklyReport` cache),
  `measurements`. Profile fields live directly on `users/{uid}`.
- **Gemini** — Two paths. **Client-key** path drives in-app chat /
  photo-macro analysis from the browser, protected by referrer + API
  restrictions on the GCP key (the key is in the bundle). **Server-key**
  path drives the `generateWeeklyReport` Cloud Function — runs under
  admin SDK with the entitlement check. See
  [ADR-0002](docs/adr/0002-firestore-no-backend-architecture.md).
- **Cloud Functions** — Key callables: `analyzePhoto` (photo macros),
  `generateWeeklyReport` (Pro-gated), `exportUserData` / `deleteAccount`
  (GDPR), `reserveConsultation` / `releaseConsultation`,
  `checkAccessStatus`. Schedules: `sendDailyReminders`,
  `sendDayThreeCoachPush`, `weekly-digest`, `weeklyFirestoreBackup`,
  `statusPulse`, `publishUserCount`. Triggers: `onDailyLogCreated`,
  `onSubscriptionWritten`, `sendWelcomeEmail`.

## UI surfaces (post-#4 rename — see [ADR-0006](docs/adr/0006-drop-v2-suffix-component-naming.md))

These are the top-level routes / tabs. Each has a component folder of
the same name under `src/app/components/`.

- **Today** — Tab. Current-day summary, log entry, refine-targets card,
  what's-new banner, install hint.
- **Body** — Tab. Weight + sparkline, goal progress, fasting ring,
  collapsible measurements.
- **Trends** — Tab. Weekly chart, EMA, weekly report (Pro).
- **History** — Route (`/history`). Grid of past days.
- **DayDetail** — Route (`/history/{YYYY-MM-DD}`). One-day deep-dive.
- **Settings** — `settings-sheet` component. Profile, data export,
  subscription, sign-out.
- **Ui*** prefix — In the `src/app/components/ui/` folder, class names
  like `UiCard`, `UiButton`, `UiFab`, `UiRing` mark **shared primitives**
  (design-system atoms). They are NOT feature surfaces.

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
- **Date type at the seam** — Firestore writes use `Timestamp`; the
  ledger port surface always exposes JS `Date`. UI / derivations never
  see `Timestamp`.
