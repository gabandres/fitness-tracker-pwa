// Moved to @macrolog/core (shared with the Expo app — see docs/adr/0012).
// This shim keeps existing `utils/meal-draft` imports working. The
// commit-to-DailyLog coercion (RawMealInput → LogEntry) now lives in core so
// both frontends build the same entry through one seam.
export * from '@macrolog/core/meal-draft';
