/**
 * @macrolog/core — the shared, framework-free brain consumed by both the
 * Angular PWA and the Expo app. Domain types + pure math only; NO Firestore
 * SDK, NO Angular, NO React. See docs/adr/0012.
 *
 * **The sections below mirror CONTEXT.md's headings**, so a reader who knows
 * the glossary can find the module and a reader who finds the module can look
 * up the term. They are the only structure this surface has: every line is
 * still `export *`, so ~430 symbols share one flat namespace and an import from
 * '@macrolog/core' autocompletes to all of them. Keep a new module under the
 * heading its concept lives under in CONTEXT.md, and add the term there if it
 * has none — a module whose name means nothing in the glossary is a module
 * nobody will find twice.
 */

// ─────────────────────────── Foundations ───────────────────────────
export * from './types';
export * from './unit-system';
export * from './date';
export * from './day-boundary';
// Which document could hold the MANUAL twin of a night an importer is filing.
// Foundation-level because it is a consequence of `day-boundary`, not of sleep:
// the manual writer buckets by the user's day and every importer buckets by the
// calendar wake day, so the two disagree in a window (issue #80).
export * from './sleep-night';
export * from './tier-limits';

// ──────────────────────────── Logging ────────────────────────────
// One row of intake (`DailyLog`) and the shapes around it: the per-day rollup,
// the write-time meal-slot default, the entry-form draft, presets, My Foods.
export * from './day-summary';
// Sleep against intake (ADR-0033) — the Trends card's whole arithmetic, and
// the gates that decide whether it is allowed to say anything. Nothing here is
// read by `dailyTargets`, `tdee` or `weekly-insights`, and
// `sleep-target-independence.test.ts` fails the build if that changes.
export * from './sleep-intake';
export * from './meal-slots';
export * from './meal-draft';
export * from './meal-preset';
// My Foods library helpers (ADR-0013). Types (CustomFood, FoodSource,
// ServingUnit) live in ./types; these are the pure scaling helpers.
export * from './custom-food';

// ──────────────────── Time windows over logs ────────────────────
// The windows every screen takes over logs and weights, named once. ADR-0004
// gave the Angular app typed windows; the Expo app was built afterwards and
// inherited none of it, so `400` was declared in three hooks and had already
// drifted into a bare literal in a fourth. Builders take `now` explicitly.
export * from './log-window';

// ────────────────────────── Aggregations ──────────────────────────
export * from './weekly-insights';
export * from './weekly-summary';
export * from './weekly-budget';
export * from './streak';
export * from './share-card';

// ─────────────────── Targets + derivations ───────────────────
// The TDEE → calorie-target → protein-target chain. `dailyTargets` in
// ./targets is the one entry point both frontends derive from; change the
// target math there, not per-frontend.
export * from './macro-heuristic';
export * from './tdee';
// Sanity bands for the four Mifflin-St Jeor profile inputs, named once so the
// two screens that collect them and the rules that validate them cannot drift.
export * from './profile-bounds';
// The FIRST calorie number a user ever sees. Mifflin-St Jeor when onboarding
// collected sex/height/age/activity, `computeKcal` when it could not — the
// heuristic alone was biased by sex by up to 27% (UX_AUDIT F1/F2).
export * from './onboarding-seed';
// Activity-informed activity-level correction (docs/activity-informed-tdee-spec.md).
// Imported Health activeKcal CORRECTS the self-reported activityLevel bucket
// via a suggestion the user confirms; it never enters calculateTdee's
// arithmetic (measured mode already contains every training calorie). Pure —
// the window read + decline memory are mobile-side adapters.
export * from './activity-level';
export * from './targets';
// Adaptive-TDEE recalibration digest (v1.1 retention loop). Read-only over
// calculateTdee/dailyTargets — turns the silent measured-mode adaptation into
// a surfaceable "your real burn shifted" digest. No production target-math
// change; the ack state is persisted per-device by each frontend.
export * from './tdee-recalibration';
// The Today "maintenance" line — intake read against measured burn rather than
// against the target. Presentation gate only; invents no math. Null unless the
// TDEE is genuinely measured, so a formula/seed guess never appears on Today
// dressed as an observation.
export * from './maintenance-view';
// What a chosen pace actually delivers once calorieFloor clamps the target.
// Same shape as maintenance-view: a reading over calculateTdee's own
// arithmetic, no target math changed. Exists because the pace control is a
// promise the app is free to break silently — 0.9 lb/wk against a floor 20
// kcal under maintenance really ships 0.04.
export * from './pace-reality';

// ──────────────────────────── Body ────────────────────────────
export * from './body-fat';
export * from './weight-projection';
// Bodyweight sanity rules (shared by both frontends — logger, workout-finish
// mirror, store backstop). Distinct from ./macro-heuristic's CALC_WEIGHT_*
// input range; see the header of ./weight-bounds.
export * from './set-load-bounds';
export * from './weight-bounds';
// Body weight in the unit the user reads and types, over a store that is always
// POUNDS. Display/input seam only — see the header for why the model never
// learns kilograms exist (UX_AUDIT F3).
export * from './body-weight-units';
// Per-field tape-measurement bands, in inches. One shared 0–200 range could
// not tell a 15in chest from a 15in neck; these can.
export * from './measurement-bounds';
// Health Sync Phase 1 — pure mapping layer (weight two-way). Types + lb↔kg +
// same-day dedup + conflict policy shared by the iOS/Android health adapters
// (apps/mobile/src/lib/health.ts). No native imports; the adapter + settings
// wiring are gated on the EAS dev build. See STATUS.md §2.
export * from './health-mapping';

// ──────────────────── Workout (Train tab) ────────────────────
// NOTE: workout.ts TYPES are intentionally NOT re-exported here — the PWA's
// utils shims do `export * from '@macrolog/core'` and already define their own
// WorkoutSet/LogStyle/etc. in models/workout.ts, so barrel-exporting these
// names would clash. The pure functions below need the types only in their
// signatures (structural typing covers call sites in both apps). That is why
// this section is the one place `export {}` outnumbers `export *`.
export * from './plate-math';
// Lifted load in the unit the user TRAINS in, over a pound store. Separate
// from body weight on purpose: the bar, the plates and the step are all
// different objects per unit, so plate math is solved in the display unit
// rather than solved in pounds and converted (UX_AUDIT F3).
export * from './load-units';
export * from './warmup';
export * from './workout-progression';
// Function-only export (the ./workout types stay un-barreled — see note above).
export { normalizeClusterGroups, setRowLabels } from './cluster-groups';
// Finish-boundary guard: fill a logged set's missing load from its siblings
// (both apps — ADR-0012). Function-only, so the ./workout types stay un-barreled.
export { fillMissingClusterLoads } from './workout';
// Set/exercise validation shared by both loggers — same function-only rule as
// above, so the ./workout types stay un-barreled.
export {
  RIR_MAX,
  RIR_MIN,
  clampRir,
  exerciseNameKey,
  findDuplicateExercise,
} from './workout';
// The in-progress session's edit rules as data: one pure reducer over a closed
// SessionAction union, replacing seven mobile hook callbacks whose differing
// write behaviour lived only in their doc comments. Function-only export, so
// the ./workout types stay un-barreled; both apps' structurally identical
// session shapes pass through it without a cast.
export {
  type SessionAction,
  applySessionAction,
  newCardioBlock,
  newCluster,
  newWorkoutSet,
} from './workout-session';
// Workout doc → domain read mappers (both adapters — arch review E).
// Function-only export; the ./workout types they return stay un-barreled and
// each frontend assigns the result to its own structurally-identical type.
export { toWorkoutExercise, toWorkoutTemplate, toWorkoutSession } from './workout-mappers';
// Shipped Train starter content (library + templates + es-PR maps + resolvers).
// Exported names are seed-specific (Seed*, EXERCISE_LIBRARY, seed*) — no clash
// with the intentionally-un-barreled ./workout types.
export * from './locales';
export * from './workout-seed';
// Session- and screen-level Train derivations (idle hero, sparkline series,
// summary counts, PR crossing). The layer above ./workout-progression; both
// Train tabs read these instead of hand-mirroring them, which is how the two
// apps came to disagree about the user's heaviest lift.
export * from './train-view';

// ──────────────────── Cardio (ADR-0025) ────────────────────
// Same un-barreled rule as ./workout above, for the same reason: both
// frontends keep their own structurally-identical CardioBlock next to their
// Firestore code, so barrel-exporting the TYPES here would collide with the
// PWA's `export *` shims the moment the web grows a copy. The types are
// reachable at `@macrolog/core/cardio`; only values come through the barrel.
export {
  CARDIO_DISTANCE_MAX_M,
  CARDIO_DURATION_MAX_SEC,
  CARDIO_KCAL_MAX,
  CARDIO_MODALITIES,
  CARDIO_RATE_STYLE,
  HR_MAX,
  HR_MIN,
  RPE_MAX,
  RPE_MIN,
  clampCardioDurationSec,
  clampCardioKcal,
  clampDistanceM,
  clampHr,
  clampRpe,
  isLoggedCardioBlock,
  // The energy seam: a finished session's marker log is ZERO calories however
  // much the ring reported (ADR-0026 decision 5). Both write paths call this
  // rather than an inline literal, so the one place a cardio calorie could
  // cross into the estimator is named and tested.
  WORKOUT_MARKER_KCAL,
  workoutMarkerEntry,
} from './cardio';
// Health WORKOUTS — the event-stream sibling of ./health-mapping's daily
// scalars (ADR-0026). Modality + provider normalization, import filtering and
// the suggest-never-merge dedup. Function-only, so the ./cardio types stay
// un-barreled; `HealthWorkout` is at `@macrolog/core/health-workouts`.
export {
  OVERLAP_MERGE_THRESHOLD,
  humanizeActivityType,
  importableWorkouts,
  looksLikeSameEffort,
  mergeImportedBlocks,
  normalizeProvider,
  overlapRatio,
  blockSpan,
  toCardioBlockFromHealth,
  toCardioModality,
  workoutDurationSec,
} from './health-workouts';
// Oura Cloud API — the SECOND cardio import transport (issue #72, ADR-0026
// Amendment 2). Parse-only: it turns Oura's wire shape into the same
// `HealthWorkout` the health-store path produces, so there is one mapper and
// two readers. The fetch itself is server-side (the refresh token is denied to
// clients); this half is pure so it can be tested without the one ring.
// Function-only, matching ./health-workouts — `OuraWorkout` is at
// `@macrolog/core/oura-workouts`.
export { parseOuraWorkouts, toHealthWorkout, ouraDateParam } from './oura-workouts';
// Cardio derivations — weekly roll-up, per-block summary cells, distance/pace
// formatting. A SIBLING of ./train-view and never an edit to it: the strength
// derivations walk session.exercises and must keep walking only that.
export * from './cardio-view';

// ──────────────────── Food-resolution pipeline ────────────────────
// Barcode / label / text / photo → an editable macro draft → a CustomFood.
// Every arm is pure; the fetch, the camera and the OCR are per-frontend
// adapters. See ADR-0013.
//
// Is a food's nutrition data believable? Atwater reconciliation + range sanity,
// plus the source-trust buckets both the ranking and the UI badge read. Pure —
// the Cloud Functions filter with it and the clients label with it.
// MIRRORED, not imported, by functions/src/food-plausibility.ts; the two are
// held identical by functions/test/food-plausibility-parity.spec.ts.
export * from './food-plausibility';
// Food-search wire module (searchFoods / getFoodDetail): shared types +
// normalize + serving-sort + a transport-injected client. Both frontends'
// callable adapters plug in via makeFoodSearch. Wire-compatible with
// functions/src/food-search.ts (separate project).
export * from './food-search';
// Open Food Facts product resolution (ADR-0013 barcode path): OFF payload →
// single-basis ResolvedProduct + the barcode-keyed save context. Pure; each
// frontend keeps its own fetch and scanner adapter. Distinct from the cached
// server search path in functions/src/food-search.ts — see the file header.
export * from './off-product';
// Nutrition Facts panel parser (ADR-0013 phase 3): OCR label text → editable
// grams-first draft. Native OCR is a per-frontend adapter; the parse is pure.
export * from './nutrition-label';
// Recipe-URL import (v1.1): schema.org/Recipe JSON-LD → editable per-serving
// draft. Pure extract + normalize; the HTML fetch is a per-frontend adapter
// (mobile direct fetch, web CF proxy — no CORS in RN).
export * from './recipe-import';
// Natural-language meal parser (ADR-0013 text modality): free-text utterance →
// macro-free {qty,unit,food}[] + a resolver that scales database servings. The
// voice/text input adapter is per-frontend; the decomposition + scaling is pure.
export * from './meal-utterance';
export * from './speech-locale';
// Meal-photo scan types + macro helpers (ADR-0015). Pure; the CF + both apps
// share these. The scan itself (camera + Gemini) is a per-frontend/CF adapter.
// Deliberately de-emphasized against the pipeline above — meal-photo guessing
// has a ~26–36% error floor.
export * from './photo-scan';

// ────────────────────── Firestore codecs ──────────────────────
// Shared Firestore write-path pruner (both frontends' ledger adapters).
// Date-guard is built in; each edge injects its Timestamp predicate.
export * from './prune-undefined';
// Shared Firestore READ-path mappers (doc → domain), the read-path twin of
// prune-undefined. Structural Timestamp → Date (no firebase import); both
// frontends' adapters map here. Workout mappers are in ./workout-mappers above.
export * from './firestore-mappers';
// Shared Firestore WRITE-path serializers (domain → doc), the twin of the
// mappers above. Also pure, but a write must PRODUCE SDK values, so each edge
// injects Timestamp/deleteField through a DocCodec. Adapters keep their I/O.
export * from './firestore-writers';
// Readers for the four per-day scalar collections (weights, water, sleep,
// activity). The shaped collections go through firestore-mappers above; these
// four are one number per day and used to be re-read inline at every call
// site, legacy `ml` branch and all.
export * from './daily-scalars';

// ─────────────────────────── AI surfaces ───────────────────────────
// Shared AI-coach system-instruction builder (ADR-0012/0013): both frontends
// assemble the identical grounded prompt, then POST it to consultationStream.
export * from './coach-prompt';
// Shared SSE frame parser (coach stream) — used by both frontends' readers.
export * from './sse';
// Shared Pro weekly-report prompt builder (both frontends → generateWeeklyReport).
export * from './weekly-report-prompt';

// ───────────────── Platform surfaces (outside the app) ─────────────────
// Retention nudge planner (ADR-0015). Pure; the expo-notifications layer is a
// dumb adapter over what this returns.
export * from './reminder-plan';
// Home-screen widget snapshot contract (apps/mobile/WIDGET.md). A widget
// can't hold our onSnapshot listeners, so the app writes a blob to shared
// storage and the widget renders it: build (app side) + parse/view (widget
// side) both live here. Android calls these directly; the iOS SwiftUI timeline
// mirrors them in Swift against these tests. Storage + reload are adapters.
export * from './widget-snapshot';
// Quick-add: logging a preset from outside the app — widget button, Quick
// Settings tile, iOS App Intent (ADR-0020). Slot resolution, the row that gets
// written, the offline queue and the pre-minted ledger id. Pure; the storage
// and the platform trigger are adapters.
export * from './quick-add';
// Product analytics: the closed event catalogue, the per-user-per-day doc id
// and the pure buffering/clamping both frontends flush through. No transport
// here — each app writes it with its own SDK, like every other document.
export * from './usage-events';

// ────────────────────── Import / export ──────────────────────
// Shared CSV export serializer (both apps). buildCsv + ExportData are unique
// names; the ./workout types it consumes stay un-barreled (see note above).
export { buildCsv, type ExportData } from './csv-export';
// Switcher CSV import parser (MFP / Lose It! / Cronometer), pure + shared.
export * from './import-csv';

// On-device USDA food search: the ranking `searchFoods` runs server-side, run
// instead inside the app against the compact index built by
// `scripts/build-food-index.mjs`. Exported NARROWLY on purpose — the module's
// `words`/`stem`/`normalizeQuery` helpers are tokenizer internals with names
// far too generic for a shared barrel, and tests import them from the module
// directly. Ranking parity with `functions/src/usda-db.ts` is pinned by
// `__fixtures__/usda-search-golden.json`; see `usda-search.ts`.
export {
  FOOD_INDEX_FORMAT_VERSION,
  loadFoodIndex,
  searchFoodIndex,
  findFoodById,
  buildFoodDetail,
  type CompactFoodIndex,
  type CompactFoodRow,
  type IndexedFood,
} from './usda-search';

// Oura daily summaries (ADR-0026, `daily` scope) -> the sleep/steps/activeKcal
// rows the Health importer already writes.
export {
  parseOuraDaily,
  sleepSecondsToHours,
  type OuraDailyParse,
  type OuraDailyRow,
} from './oura-daily';

// Oura scope comparison (ADR-0026). The required set lives here and is
// hand-mirrored by `SCOPE` in functions/src/oura-link.ts; both sides assert the
// literal so a scope added to one cannot silently skip the other.
export {
  OURA_REQUIRED_SCOPES,
  missingOuraScopes,
  needsOuraScopeUpgrade,
  parseOuraScopes,
} from './oura-scopes';

// Chain-restaurant routing (ADR-0027). Only the chain NAMES ship to the client;
// the corpus itself stays on the server. `restaurant-chains.ts` explains why.
export {
  RESTAURANT_CHAINS,
  RESTAURANT_SNAPSHOT_YEAR,
  matchRestaurantChain,
  queryNamesRestaurantChain,
} from './restaurant-chains';

// Validation for user-typed calorie/protein targets (targetMode). Shared so
// the onboarding plan step and the Settings editor cannot disagree about what
// a legal number is.
export * from './target-input';
