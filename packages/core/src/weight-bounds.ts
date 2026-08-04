/**
 * Bodyweight sanity rules — the one place, shared by both frontends, that
 * answers "is this a plausible logged bodyweight". The Body-tab logger, the
 * workout-finish mirror, and the store backstop all agree because they call
 * here rather than re-deriving bounds inline.
 *
 * Why this exists: an 11 lb bodyweight entry was accepted, stored, and fed
 * into the measured-TDEE OLS regression, where a single absurd point skews
 * the slope badly. Numbers are validated at the input seam (reject /
 * confirm) AND clamped at the store seam (absolute floor/ceiling) so no
 * path — manual log, CSV import, session mirror — can persist a corrupt
 * weight.
 *
 * NOT the same as the calculator/onboarding INPUT range
 * (`CALC_WEIGHT_MIN_LB`/`CALC_WEIGHT_MAX_LB` in ./macro-heuristic, 60–700):
 * that bounds what a user may TYPE into the TDEE calculator; these bound
 * what may be LOGGED and stored as a daily weight.
 */

/** Soft range enforced at the UI: a hard reject outside these bounds. */
export const WEIGHT_MIN_LB = 50;
export const WEIGHT_MAX_LB = 500;

/** A day-over-day jump beyond this (lb) triggers a confirm prompt rather
 *  than a hard reject — real water/scale swings can reach a few pounds, but
 *  a 30 lb overnight change is almost always a typo. */
export const WEIGHT_DELTA_WARN_LB = 7;

/** Absolute backstop enforced at the store, wider than the UI range so a
 *  genuine edge-case weight near 50/500 still saves while obvious garbage
 *  (the 11 lb entry) is rejected on every write path. */
export const WEIGHT_ABS_MIN_LB = 30;
export const WEIGHT_ABS_MAX_LB = 700;

export type WeightCheck =
  | { ok: true }
  | { ok: false; reason: 'out-of-range' }
  | { ok: false; reason: 'large-delta'; deltaLb: number };

/**
 * Validate a weight entry against the soft UI bounds and (when a prior
 * weight is known) the day-over-day delta. `out-of-range` is a hard reject;
 * `large-delta` is meant to drive a confirm prompt, not a block.
 */
export function checkWeightEntry(weight: number, prev?: number | null): WeightCheck {
  if (!Number.isFinite(weight) || weight < WEIGHT_MIN_LB || weight > WEIGHT_MAX_LB) {
    return { ok: false, reason: 'out-of-range' };
  }
  if (prev != null && Math.abs(weight - prev) > WEIGHT_DELTA_WARN_LB) {
    return { ok: false, reason: 'large-delta', deltaLb: +Math.abs(weight - prev).toFixed(1) };
  }
  return { ok: true };
}

/** True when a weight is within the absolute sanity range the store will
 *  persist. Anything outside is rejected as corrupt regardless of path. */
export function isStorableWeight(weight: number): boolean {
  return Number.isFinite(weight) && weight >= WEIGHT_ABS_MIN_LB && weight <= WEIGHT_ABS_MAX_LB;
}

// ─── Weigh-in DATES ─────────────────────────────────────────────
// The value was bounded; the date never was. `dailyWeights/{dateKey}` accepted
// any key, so a mistyped or mis-imported year lands a weigh-in decades away
// from the rest of the series. That matters more than it looks: the measured
// TDEE window is bounded by ENTRY COUNT, not by calendar date, so an ancient
// row stays inside the window indefinitely — and in a least-squares fit the
// most distant x carries the most leverage over the slope. The window
// semantics are deliberately left alone (a known, separately-scoped issue);
// this stops the bad rows being created in the first place.

/** No weigh-in may predate this. Not a guess at when the user was born — a
 *  floor low enough to permit any real imported history while catching a
 *  mistyped year (0217, 1017, 2917). */
export const WEIGH_IN_MIN_DATE_KEY = '2000-01-01';

/** `YYYY-MM-DD`, the only shape `dailyWeights` doc ids take. Compared as
 *  strings on purpose: that ordering is identical to date ordering for this
 *  format, and it is the one comparison `firestore.rules` can also make. */
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True when a weigh-in date is storable: well-formed, not before
 * {@link WEIGH_IN_MIN_DATE_KEY}, and not in the future.
 *
 * Future dates are always wrong — you cannot have weighed yourself tomorrow —
 * and they are the more damaging half, because they extend the regression's x
 * range past today and drag the projected trend with them. `todayKey` is a
 * parameter so the caller supplies its own local date rather than this module
 * assuming a timezone.
 */
export function isStorableWeighInDate(dateKey: string, todayKey: string): boolean {
  if (!DATE_KEY_RE.test(dateKey)) return false;
  return dateKey >= WEIGH_IN_MIN_DATE_KEY && dateKey <= todayKey;
}
