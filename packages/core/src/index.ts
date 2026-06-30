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
// NOTE: workout.ts types are intentionally NOT re-exported here — the PWA's
// utils shims do `export * from '@macrolog/core'` and already define their own
// WorkoutSet/LogStyle/etc. in models/workout.ts, so barrel-exporting these
// names would clash. The pure functions below need the types only in their
// signatures (structural typing covers call sites in both apps).
export * from './plate-math';
export * from './warmup';
export * from './workout-progression';
