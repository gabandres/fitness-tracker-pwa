// Moved to @macrolog/core (shared with the Expo app — see docs/adr/0012).
// This shim keeps existing `utils/weekly-insights` imports working. The
// weight-projection helpers (projectWeight / weightSlopeLbPerWeek /
// WeightPoint / WeightProjection) that were inlined here now live in their
// own @macrolog/core/weight-projection module; both are re-exported so
// callers keep importing from this one path.
export * from '@macrolog/core/weekly-insights';
export * from '@macrolog/core/weight-projection';
