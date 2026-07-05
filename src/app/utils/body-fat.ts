// Moved to @macrolog/core (shared with the Expo app — see docs/adr/0012).
// This shim keeps existing `utils/body-fat` imports working. `Sex` now lives
// in @macrolog/core/types; re-exported here for surface parity.
export * from '@macrolog/core/body-fat';
export type { Sex } from '@macrolog/core/types';
