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
