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
// My Foods library helpers (ADR-0013). Types (CustomFood, FoodSource,
// ServingUnit) live in ./types; these are the pure scaling helpers.
export * from './custom-food';
// Nutrition Facts panel parser (ADR-0013 phase 3): OCR label text → editable
// grams-first draft. Native OCR is a per-frontend adapter; the parse is pure.
export * from './nutrition-label';
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
