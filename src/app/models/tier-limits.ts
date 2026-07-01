// Free-tier limits moved to @macrolog/core (shared with the Expo app — see
// docs/adr/0012). This shim keeps existing `models/tier-limits` imports working.
export {
  PRESET_LIMIT_FREE,
  CHART_HISTORY_DAYS_FREE,
  CUSTOM_TEMPLATE_LIMIT_FREE,
  WORKOUT_HISTORY_DAYS_FREE,
  STREAK_FREEZE_MAX_GAP_PRO,
} from '@macrolog/core';
