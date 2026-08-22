import { calorieFloor } from './tdee';

/**
 * Validation for user-typed calorie and protein targets.
 *
 * Lives in core because two surfaces on mobile (the onboarding plan step and
 * the Settings editor) and any future web surface must agree exactly on what
 * a legal number is. A guard implemented twice is a guard that disagrees with
 * itself within a release.
 *
 * ## The floor is the profile's floor, NOT a separate input-only minimum
 *
 * The plan said "block below 1,200", and that would have been wrong. It is
 * `dailyTargets` that decides the final number, and it clamps with
 * `Math.max(calorieFloor(profile), …)` on every path — where `calorieFloor`
 * is the user's own floor if they set one, else 1,500. So accepting 1,300
 * would store 1,300, display 1,500, and hand the user exactly the silent
 * override this whole feature exists to remove.
 *
 * Refusing below the effective floor keeps one promise instead of breaking it
 * quietly: **the number you type is the number you get.** A user who wants to
 * go lower can lower their calorie floor first, which is a deliberate second
 * act on a field that already exists.
 */
export const TARGET_KCAL_CEILING = 6000;
export const TARGET_PROTEIN_MIN = 20;
export const TARGET_PROTEIN_MAX = 400;

/** How far under the measured estimate a target may sit before it is worth
 *  saying out loud. Advisory only — it never blocks a save. */
export const AGGRESSIVE_DEFICIT_PCT = 25;

export type TargetIssue =
  /** Below the profile's effective calorie floor. BLOCKING. */
  | { kind: 'belowFloor'; floor: number }
  /** Implausibly high. BLOCKING — a fat-fingered 20000 is not a goal. */
  | { kind: 'aboveCeiling'; ceiling: number }
  /** Not a positive number at all. BLOCKING. */
  | { kind: 'notANumber' }
  /** Legal, but a steep cut against the user's own measured maintenance.
   *  ADVISORY: `blocking` is false and the save proceeds. */
  | { kind: 'aggressive'; measured: number; pctUnder: number };

export interface TargetValidation {
  /** Whether the value may be saved. Advisory issues leave this true. */
  ok: boolean;
  /** The single most important thing to say, or null when there is nothing. */
  issue: TargetIssue | null;
}

const clean = (v: number | null | undefined): number | null =>
  v != null && Number.isFinite(v) && v > 0 ? Math.round(v) : null;

/**
 * @param measuredTdee the user's measured maintenance, when one exists and is
 *        reliable. Omitted or null simply skips the advisory check — a new
 *        account has nothing to compare against and must not be nagged.
 */
export function validateCalorieTarget(
  value: number | null | undefined,
  opts: { profile?: { calorieFloor?: number } | null; measuredTdee?: number | null } = {},
): TargetValidation {
  const n = clean(value);
  if (n == null) return { ok: false, issue: { kind: 'notANumber' } };

  const floor = calorieFloor(opts.profile);
  if (n < floor) return { ok: false, issue: { kind: 'belowFloor', floor } };
  if (n > TARGET_KCAL_CEILING) {
    return { ok: false, issue: { kind: 'aboveCeiling', ceiling: TARGET_KCAL_CEILING } };
  }

  const measured = clean(opts.measuredTdee);
  if (measured != null) {
    const pctUnder = Math.round(((measured - n) / measured) * 100);
    if (pctUnder >= AGGRESSIVE_DEFICIT_PCT) {
      return { ok: true, issue: { kind: 'aggressive', measured, pctUnder } };
    }
  }
  return { ok: true, issue: null };
}

export function validateProteinTarget(value: number | null | undefined): TargetValidation {
  const n = clean(value);
  if (n == null) return { ok: false, issue: { kind: 'notANumber' } };
  if (n < TARGET_PROTEIN_MIN) {
    return { ok: false, issue: { kind: 'belowFloor', floor: TARGET_PROTEIN_MIN } };
  }
  if (n > TARGET_PROTEIN_MAX) {
    return { ok: false, issue: { kind: 'aboveCeiling', ceiling: TARGET_PROTEIN_MAX } };
  }
  return { ok: true, issue: null };
}
