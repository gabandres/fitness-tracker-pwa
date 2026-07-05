/**
 * @macrolog/core — the shared, framework-free brain consumed by both the
 * Angular PWA and the Expo app. Domain types + pure math only; NO Firestore
 * SDK, NO Angular, NO React. See docs/adr/0012.
 */
export * from './types';
export * from './unit-system';
export * from './macro-heuristic';
export * from './date';
export * from './day-summary';
export * from './tdee';
export * from './targets';
export * from './body-fat';
export * from './weight-projection';
export * from './weekly-insights';
export * from './weekly-budget';
export * from './streak';
export * from './meal-slots';
export * from './share-card';
export * from './tier-limits';
// Meal-photo scan types + macro helpers (ADR-0015). Pure; the CF + both apps
// share these. The scan itself (camera + Gemini) is a per-frontend/CF adapter.
export * from './photo-scan';
// Retention nudge planner (ADR-0015). Pure; the expo-notifications layer is a
// dumb adapter over what this returns.
export * from './reminder-plan';
// My Foods library helpers (ADR-0013). Types (CustomFood, FoodSource,
// ServingUnit) live in ./types; these are the pure scaling helpers.
export * from './custom-food';
// Nutrition Facts panel parser (ADR-0013 phase 3): OCR label text → editable
// grams-first draft. Native OCR is a per-frontend adapter; the parse is pure.
export * from './nutrition-label';
// Natural-language meal parser (ADR-0013 text modality): free-text utterance →
// macro-free {qty,unit,food}[] + a resolver that scales database servings. The
// voice/text input adapter is per-frontend; the decomposition + scaling is pure.
export * from './meal-utterance';
// Shared AI-coach system-instruction builder (ADR-0012/0013): both frontends
// assemble the identical grounded prompt, then POST it to consultationStream.
export * from './coach-prompt';
// Shared SSE frame parser (coach stream) — used by both frontends' readers.
export * from './sse';
// Shared Pro weekly-report prompt builder (both frontends → generateWeeklyReport).
export * from './weekly-report-prompt';
// NOTE: workout.ts types are intentionally NOT re-exported here — the PWA's
// utils shims do `export * from '@macrolog/core'` and already define their own
// WorkoutSet/LogStyle/etc. in models/workout.ts, so barrel-exporting these
// names would clash. The pure functions below need the types only in their
// signatures (structural typing covers call sites in both apps).
export * from './plate-math';
export * from './warmup';
export * from './workout-progression';
// Function-only export (the ./workout types stay un-barreled — see note above).
export { normalizeClusterGroups } from './cluster-groups';
// Shipped Train starter content (library + templates + es-PR maps + resolvers).
// Exported names are seed-specific (Seed*, EXERCISE_LIBRARY, seed*) — no clash
// with the intentionally-un-barreled ./workout types.
export * from './workout-seed';
// Shared CSV export serializer (both apps). buildCsv + ExportData are unique
// names; the ./workout types it consumes stay un-barreled (see note above).
export { buildCsv, type ExportData } from './csv-export';
// Switcher CSV import parser (MFP / Lose It! / Cronometer), pure + shared.
export * from './import-csv';
