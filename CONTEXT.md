# Ignia — Domain Glossary

This file is the canonical name list for the Ignia PWA. One concept,
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
  `toWeeklyReport` / `toDomainProfile`(+`Patch`). Both frontends' adapters map
  here (web `FirestoreLedgerCore` + `profile-mapper.ts`; mobile `lib/ledger.ts`),
  keeping their own `onSnapshot`/`getDocs` I/O and the `Timestamp` import. The
  three **workout** mappers (Exercise / WorkoutTemplate / WorkoutSession) stay
  per-frontend — their domain types are intentionally un-barreled and the web
  applies `normalizeClusterGroups` where mobile does not.
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
  hydration) and `logsForLastDaysState(n)` (computed-safe). The canonical
  "last N calendar days" query. Always prefer this over slicing `_logs`
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
- **Water** — Stored in ml under `users/{uid}/dailyWater/{YYYY-MM-DD}`.
  Capped 0–20,000 ml at write time.
- **FastWindow** — Active fasting window, target 16h. Owned by
  `FastingStore`; profile carries `fastStartedAt`. `isFasting()` is
  computed from the start time being non-null.

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
- **SetKind** — `warmup | activation | working | mini | drop`. A set's
  optional `group` clusters it (C1/C2); no group → plain straight set.
  Warmups/drops are excluded from PR + progression math.
- **Progression / PRs** — Pure module `utils/workout-progression.ts`
  (per [ADR-0003](docs/adr/0003-day-summary-as-pure-module.md)):
  `suggestProgression` (deterministic double-progression — hit
  `targetReps` for `holdSessions` → `+incrementLb`), `computeExercisePRs`
  + `estimateOneRepMax` (Epley). No AI in v1.
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
  `LEDGER_PORT.profile` and consumed by every store/component. All date
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
- **FirestoreLedgerCore** — `ledger/infrastructure/firestore-ledger.core.ts`.
  Framework-free Firestore I/O core behind `FirebaseService` (issue #6
  phase 3): `new`-able without Angular DI, imports only
  `firebase/firestore`. Owns EVERY collection verb — profile-doc
  primitives, dailyLogs, dailyWeights, dailyWater, presets, reports,
  measurements, and the three workout collections (query shapes,
  Timestamp ↔ Date workout mappers, oldest-first reversal,
  `deleteField` semantics, `mergeExercises` batch chunking,
  `pruneUndefined`). Emulator-tested with prod rules via
  `npm run test:ledger` (`firestore-ledger-core.emulator.test.ts`).
  `FirebaseService` keeps the profile signal, optimistic updates, auth
  wiring, and the callable-backed GDPR verbs — add new persistence
  verbs to the core, not the service.

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
- **WorkoutStore** (`workout-store.service.ts`) — Exercise catalog,
  workout templates, recent sessions, the single active session. CRUD +
  `cloneStarterTemplate`; `hydrate(...)`/`clear()` driven by
  `FitnessStore._load()`. No cross-store writes (finish is on the hub).
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
  `checkAccessStatus`. Schedules: `sendDailyReminders`,
  `sendDayThreeCoachPush`, `weekly-digest`, `weeklyFirestoreBackup`,
  `statusPulse`, `publishUserCount`. Triggers: `onDailyLogCreated`,
  `onSubscriptionWritten`, `sendWelcomeEmail`.
- **CallerAccess** (`functions/src/caller-access.ts`) — the Cloud
  Functions caller-resolution module: auth check, per-uid rate limit,
  and tier resolution in one `resolveCaller(request, rateLimit?)` call.
  `CallerTier` = `admin | comped | paid | free`; `comped` folds together
  the `config/accessList` friends list AND a future referral
  `compedUntil` — both grant the same unlimited tier everywhere (see
  [ADR-0008](docs/adr/0008-cf-caller-access-daily-quota.md)). Admin
  email list lives here (sync with `subscription.service.ts`).
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
  goal progress, fasting ring, collapsible measurements (now also home to
  the **Body-fat estimate**), and a collapsed-by-default Progress Photos
  card last.
- **Trends** — Tab. Three surfaces: the 7-day chart, the **Weekly panel**
  (insights ⇄ budget toggle), and the **Coach panel** (free Ask + Pro
  WeeklyReport). Down from the former six stacked cards.
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

## Platforms (post-#12 — see [ADR-0012](docs/adr/0012-expo-native-app-shared-core.md))

Two frontends over one Firebase backend. Both are Firestore-direct clients
under the same security rules (ADR-0002 unchanged).

- **PWA** / **web app** — The Angular app at the repo root. The canonical
  web product, SEO surfaces, and Stripe checkout. Untouched by the native
  effort.
- **Mobile app** / **Expo app** — The React Native (Expo) app under
  `apps/mobile/`. Native iOS UI for **native feel** (the sole reason it
  exists, ADR-0012). Ships only the logged-in *product* surfaces, never
  the marketing/SEO ones.
- **Shared core** — `packages/core/`: the framework-free brain (pure
  `utils`, `models`, domain types, the Firestore ledger core) imported by
  *both* frontends. New product logic lands here first. "The math" lives
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
- **Date type at the seam** — Firestore writes use `Timestamp`; the
  ledger port surface always exposes JS `Date`. UI / derivations never
  see `Timestamp`. This holds for **every** dated field, **including
  profile fields** — the port returns [`Profile`](#profile) (Date),
  never the stored `UserProfileDoc` (Timestamp). The Firestore adapter's
  `toDomainProfile` / `toProfileDoc` mapper is the only place the
  conversion happens; a `Timestamp` import anywhere outside the adapter
  (or a `.toDate()` / `.toMillis()` call on a profile field in app code)
  is a bug against this convention.
