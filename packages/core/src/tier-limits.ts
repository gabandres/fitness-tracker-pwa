/**
 * Free-tier limits — the one module that states what "free" means, shared by
 * BOTH apps (Angular PWA + Expo). Every threshold the product promises lives
 * here; nothing else may re-declare these numbers (the 90-day history cap once
 * existed twice under two names and drifted). The gate check itself is each
 * app's isPro/isPaid entitlement — this module only owns the numbers.
 */

/** Max saved meal presets for non-paid users. Pro is unlimited. */
export const PRESET_LIMIT_FREE = 10;

/** Free-tier visible chart/history window in days. Pro sees all-time.
 *  Applied to the trend charts and the History grid alike. */
export const CHART_HISTORY_DAYS_FREE = 90;

/** Max custom workout templates for non-paid users. Pro is unlimited. */
export const CUSTOM_TEMPLATE_LIMIT_FREE = 3;

/** Free-tier visible exercise-history window. Pro sees all-time. */
export const WORKOUT_HISTORY_DAYS_FREE = 30;

/** Consecutive missed days a Pro "streak freeze" forgives mid-streak. Free
 *  users break on any miss (gap 0). */
export const STREAK_FREEZE_MAX_GAP_PRO = 7;

/** Lifetime free AI meal-photo scans before the Pro paywall (ADR-0015). Not a
 *  daily allowance — a one-time taste so the loop lands, then Pro unlocks
 *  unlimited scans (bounded per-day server-side only as an abuse ceiling).
 *  Manual/text/barcode logging stays free forever, so free users are never
 *  locked out of the core tracker. */
export const PHOTO_SCANS_FREE_LIFETIME = 5;
