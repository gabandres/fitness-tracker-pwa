/**
 * Free-tier limits — the one module that states what "free" means.
 *
 * Every threshold the product promises on the pricing page lives here;
 * nothing else may re-declare these numbers (the 90-day history cap
 * once existed twice under two names and could drift silently). The
 * gate check itself stays `SubscriptionService.isPaid()` — this module
 * only owns the numbers.
 *
 * Server-side twins: the photo/consultation daily caps live in
 * `functions/src/daily-quota.ts` (no shared package between the two
 * projects, so that duplication is deliberate).
 */

/** Max saved meal presets for non-paid users. Pro is unlimited. */
export const PRESET_LIMIT_FREE = 10;

/** Free-tier visible chart/history window in days. Pro sees all-time.
    Applied to the trend charts and the History grid alike. */
export const CHART_HISTORY_DAYS_FREE = 90;

/** Max custom workout templates for non-paid users. Pro is unlimited. */
export const CUSTOM_TEMPLATE_LIMIT_FREE = 3;

/** Free-tier visible exercise-history window. Pro sees all-time. */
export const WORKOUT_HISTORY_DAYS_FREE = 30;
