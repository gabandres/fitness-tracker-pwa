import { type GoalDirection, computeKcal } from './macro-heuristic';
import { isPlausibleAge, isPlausibleHeightIn } from './profile-bounds';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor, calorieFloor, paceOffsetKcal } from './tdee';
import { type ActivityLevel, type CutPace, type Sex, clampCutPace } from './types';

/**
 * The first calorie number the app ever gives a user.
 *
 * ## Why this module exists (UX_AUDIT F1/F2)
 *
 * Onboarding used to seed the target with `computeKcal` alone — body weight ×
 * {11 lose | 14 maintain | 17 gain}. No sex, no height, no age, no activity
 * level. Measured against the app's *own* Mifflin-St Jeor path at the 1.375
 * "lightly active" bucket, using the CDC/NCHS measured NHANES mean heights:
 *
 *   | same weight, age, activity | real maintenance | old "maintain" | old "lose" → rate |
 *   |---|---|---|---|
 *   | Woman, 150 lb, 30 | 1,894 | 2,100 (+11%) | 1,650 → 0.49 lb/wk |
 *   | Man,   150 lb, 30 | 2,240 | 2,100 (−6%)  | 1,650 → 1.18 lb/wk |
 *   | Woman, 180 lb, 45 | 1,978 | 2,520 (+27%) | 1,980 → **−0.00 lb/wk** |
 *   | Man,   180 lb, 45 | 2,324 | 2,520 (+8%)  | 1,980 → 0.69 lb/wk |
 *
 * The bottom row is the whole argument: a 180 lb 45-year-old woman's "lose
 * fat" target sat 2 kcal/day ABOVE her estimated maintenance. She follows it
 * exactly and loses nothing, ever, while a man of the same weight and age
 * loses at 0.69 lb/wk. The error is sex-dependent because the two inputs
 * `computeKcal` cannot take — sex and height — are the two that differ.
 *
 * The app already contained the right formula and routed every new user around
 * it: sex/height/age/activity were collected only in Settings → Refine
 * targets, which a new user has no reason to open, and `toProfileFields`
 * returns null without all four, so the formula path stayed dead for them.
 *
 * ## What this does NOT claim
 *
 * Mifflin-St Jeor is itself an estimate (±10% is the usual band), so
 * `maintenance` is a reference point, not truth. It is *the app's own*
 * reference point, which is the point: before this, Ignia disagreed with
 * itself by up to 27%, in one direction, by sex.
 *
 * ## The heuristic is still here on purpose
 *
 * The body/activity steps are skippable — someone who will not state a sex
 * must still be able to finish onboarding — and `/calculator` plus the
 * `/macros/:goal/:weight` SEO pages take a weight and nothing else. Both fall
 * through to `computeKcal`, whose signature and behaviour are unchanged.
 */

/** Weekly deficit a "gain" seed is built on, in lb/wk — a lean bulk. */
export const GAIN_SURPLUS_LBS_PER_WEEK = 0.5;
/** Fallback weekly deficit for "lose" when nothing is stored. Matches the
 *  Refine-targets stepper's own `?? 1` default, so the two screens seed the
 *  same pace. */
export const DEFAULT_LOSE_PACE_LBS_PER_WEEK = 1.0;

/**
 * The pace to PERSIST for a goal direction, given whatever is already stored.
 *
 * Two rules, and the second one is the load-bearing surprise:
 *
 * 1. A stored pace wins for "lose". Onboarding has no pace control, so a redo
 *    must not silently overwrite the 0.7 lb/wk a user dialled in Refine.
 * 2. **"gain" persists a real surplus pace now.** It used to persist 0, because
 *    `CutPace` is unsigned and every consumer SUBTRACTED it — so storing 0.5
 *    for a bulker handed them maintenance *minus* 250 the day the estimator
 *    took over, and 0 (hold at maintenance) was the least-wrong thing the
 *    model could express. UX_AUDIT F7 fixed the model: `paceOffsetKcal` reads
 *    `goalDirection` and flips the sign, so the stored pace and the seed now
 *    agree and a bulker keeps their surplus when the estimator takes over.
 */
export function onboardingPace(goal: GoalDirection, storedPace?: number | null): CutPace {
  if (goal === 'maintain') return 0;
  const fallback = goal === 'gain' ? GAIN_SURPLUS_LBS_PER_WEEK : DEFAULT_LOSE_PACE_LBS_PER_WEEK;
  return storedPace != null && storedPace > 0 ? clampCutPace(storedPace) : fallback;
}

export interface OnboardingSeedInput {
  weightLbs: number;
  goal: GoalDirection;
  /** The four Mifflin-St Jeor inputs. Any missing or out-of-band value drops
   *  the whole set — a partial profile is not writable either (firestore.rules
   *  validates them as a group), so there is no half-way state to represent. */
  sex?: Sex | null;
  heightIn?: number | null;
  age?: number | null;
  activityLevel?: ActivityLevel | null;
  /** The pace the deficit is built from. Only read on the formula basis and
   *  only for "lose"; see {@link onboardingPace}. */
  paceLbsPerWeek?: number | null;
  /** The user's personal floor, if they have one. Defaults to 1,500. */
  calorieFloor?: number | null;
}

export interface OnboardingSeed {
  /** The number to show and to persist as `manualCaloriesTarget`. */
  kcal: number;
  /** `'formula'` when Mifflin-St Jeor ran, `'heuristic'` when it could not.
   *  The screen says which — a number the user is asked to trust should say
   *  what it was built from. */
  basis: 'formula' | 'heuristic';
  /** Estimated maintenance, or null on the heuristic basis (weight × constant
   *  produces a target directly and implies no maintenance figure). */
  maintenance: number | null;
  /** True when {@link calorieFloor} lifted the target — the requested pace is
   *  not what the user will actually get. */
  floorBinding: boolean;
}

/** True when every Mifflin-St Jeor input is present and in band. */
export function hasFormulaInputs(
  i: Pick<OnboardingSeedInput, 'sex' | 'heightIn' | 'age' | 'activityLevel'>,
): boolean {
  return (
    (i.sex === 'male' || i.sex === 'female') &&
    isPlausibleHeightIn(i.heightIn) &&
    isPlausibleAge(i.age) &&
    i.activityLevel != null &&
    i.activityLevel in ACTIVITY_MULTIPLIERS
  );
}

/**
 * Seed calorie target for the onboarding plan step.
 *
 * Rounds to the nearest 10 the way `computeKcal` does — the plan step shows
 * one big number and a 2,347 reads as a measurement rather than the estimate
 * it is — then applies the calorie floor, exactly once, last. `calculateTdee`
 * floors the same way, so the two agree.
 */
export function onboardingSeed(input: OnboardingSeedInput): OnboardingSeed {
  const { weightLbs, goal } = input;
  const floor = calorieFloor({ calorieFloor: input.calorieFloor ?? undefined });

  if (!Number.isFinite(weightLbs) || weightLbs <= 0 || !hasFormulaInputs(input)) {
    const kcal = computeKcal(weightLbs, goal);
    return {
      kcal: Math.max(floor, kcal),
      basis: 'heuristic',
      maintenance: null,
      floorBinding: kcal < floor,
    };
  }

  const maintenance = Math.round(
    basalMifflinStJeor(
      { heightIn: input.heightIn as number, age: input.age as number, sex: input.sex as Sex },
      weightLbs,
    ) * ACTIVITY_MULTIPLIERS[input.activityLevel as ActivityLevel],
  );

  // One expression for all three directions now that the pace carries a sign:
  // `paceOffsetKcal` is positive for a deficit and negative for a surplus, and
  // it is the SAME function `calculateTdee` uses — so the number shown on the
  // plan step and the number the estimator produces weeks later agree.
  const pace = onboardingPace(goal, input.paceLbsPerWeek);
  const raw = Math.round((maintenance - paceOffsetKcal(pace, goal)) / 10) * 10;

  return {
    kcal: Math.max(floor, raw),
    basis: 'formula',
    maintenance,
    floorBinding: raw < floor,
  };
}
