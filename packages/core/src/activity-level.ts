import type { ActivityLevel } from './types';
import { ACTIVITY_MULTIPLIERS } from './tdee';
import { localDateKey } from './date';

/**
 * Activity-informed activity-level correction (docs/activity-informed-tdee-spec.md).
 *
 * Imported Health `activeKcal` CORRECTS the user's self-reported
 * `profile.activityLevel` bucket — it never enters `calculateTdee`'s
 * arithmetic. A trailing window of daily active energy is reduced to a mean,
 * turned into an *implied* Mifflin activity multiplier, snapped to one of the
 * five existing buckets, and SUGGESTED (the user always confirms).
 *
 * Deliberately NOT used in `measured` mode: energy balance already contains
 * every training calorie, so adding `activeKcal` there double-counts.
 */

/**
 * Thermic effect of food. Mifflin's activity multipliers scale a TDEE that
 * already includes ~10% TEF, so an activity-only ratio must be grossed up by
 * `/(1 − TEF_FRACTION)` before it is comparable to the bucket ladder. Omitting
 * this biases every user one bucket low (#22).
 */
export const TEF_FRACTION = 0.1;

/** Reduced form of a trailing activity window. */
export interface ActivityWindowStats {
  /** Arithmetic mean of the usable days' activeKcal (0 when none). */
  mean: number;
  /** Days in the window carrying activeKcal > 0. */
  usableDays: number;
}

/**
 * Reduce a window of daily activeKcal to a mean + usable-day count.
 *
 * A day counts iff `activeKcal > 0`: a stored `0` is ABSENCE (the OS reported
 * nothing), not a zero-burn day, so it is excluded from both the mean and the
 * count. Plain arithmetic mean, no trim.
 */
export function reduceActivityWindow(activeKcals: number[]): ActivityWindowStats {
  const usable = activeKcals.filter((k) => k > 0);
  if (usable.length === 0) return { mean: 0, usableDays: 0 };
  return {
    mean: usable.reduce((a, k) => a + k, 0) / usable.length,
    usableDays: usable.length,
  };
}

/**
 * The Mifflin activity multiplier implied by a mean daily active-energy burn
 * over an unadjusted (bare BMR) basal: `(1 + mean/basal) / (1 − TEF_FRACTION)`.
 * Returns 0 for a missing/non-positive basal (nothing to compare against).
 */
export function impliedMultiplier(mean: number, basalKcal: number): number {
  if (!(basalKcal > 0)) return 0;
  return (1 + mean / basalKcal) / (1 - TEF_FRACTION);
}

/** The five buckets, ascending — the ladder `snapMultiplier` walks. */
const ACTIVITY_LADDER: ActivityLevel[] = [
  'sedentary',
  'light',
  'moderate',
  'active',
  'very_active',
];

/**
 * Snap a continuous multiplier to the nearest of the five buckets. Values
 * outside the ladder clamp to its ends (never extrapolate), and an exact
 * midpoint tie resolves DOWNWARD so a coin-flip never inflates a target.
 */
export function snapMultiplier(m: number): ActivityLevel {
  // A dead-on midpoint (e.g. 1.2875) is a tie in decimal but NOT in binary
  // floating point — the two deltas differ in the 16th digit, which would
  // otherwise decide the bucket by rounding noise. Anything closer than this
  // counts as tied, and a tie keeps the lower bucket.
  const TIE_EPSILON = 1e-9;
  let best = ACTIVITY_LADDER[0];
  let bestDelta = Infinity;
  for (const level of ACTIVITY_LADDER) {
    const delta = Math.abs(m - ACTIVITY_MULTIPLIERS[level]);
    if (delta < bestDelta - TIE_EPSILON) {
      best = level;
      bestDelta = delta;
    }
  }
  return best;
}

/** Mean active-energy burn + bare basal → the activity bucket it implies. */
export function deriveActivityLevel(mean: number, basalKcal: number): ActivityLevel {
  return snapMultiplier(impliedMultiplier(mean, basalKcal));
}

/** Calendar length of the trailing window: `[today − 28, today − 1]` (#23). */
export const ACTIVITY_WINDOW_DAYS = 28;

/**
 * Usable days required before a window may correct the bucket. 21 of 28 is
 * four clean weeks minus one — enough that a window can't be blind to
 * weekends, which are where most people's activity actually lives.
 */
export const ACTIVITY_MIN_USABLE_DAYS = 21;

/**
 * The dateKey bounds of the trailing window, inclusive: `[today − 28,
 * today − 1]`. **Today is excluded unconditionally** — it is still accruing
 * (the watch syncs through the evening), so counting it would read as a low
 * day every morning (#23).
 */
export function activityWindowRange(today: Date): { from: string; to: string } {
  const at = (daysAgo: number) => {
    const d = new Date(today);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - daysAgo);
    return localDateKey(d);
  };
  return { from: at(ACTIVITY_WINDOW_DAYS), to: at(1) };
}

/** What a trailing window is good for. Only `'sufficient'` drives UI today. */
export type ActivityWindowClass = 'none' | 'steps-only' | 'insufficient' | 'sufficient';

/**
 * Classify a trailing window. `'steps-only'` (a bare phone that logs steps but
 * no active energy) is recognised but NOT actionable: steps are display-only
 * and select no branch (#23 §6). Its copy is parked behind the Coverage fog.
 */
export function classifyActivityWindow(window: {
  activeKcals: number[];
  steps?: number[];
}): ActivityWindowClass {
  const { usableDays } = reduceActivityWindow(window.activeKcals);
  if (usableDays >= ACTIVITY_MIN_USABLE_DAYS) return 'sufficient';
  if (usableDays > 0) return 'insufficient';
  return (window.steps ?? []).some((s) => s > 0) ? 'steps-only' : 'none';
}

/**
 * Hysteresis. Bare snapping flips at a bucket midpoint (0.0875 away), so a
 * user parked near one would see the suggestion appear and vanish week to
 * week. Requiring a FULL bucket of separation (0.175) before re-suggesting
 * costs one week of sharpness and buys a card that doesn't flap.
 */
export const ACTIVITY_DEADBAND = 0.175;

export interface ActivitySuggestionInput {
  /** Trailing-window daily activeKcal, absences included as 0 (or omitted). */
  activeKcals: number[];
  /** Bare Mifflin BMR — `basalMifflinStJeor`, NOT a TDEE. */
  basalKcal: number;
  /** The stored `profile.activityLevel`, or null at seed (no bucket yet). */
  currentBucket: ActivityLevel | null;
  /** Device-local decline memory: the one bucket the user waved off. */
  declinedBucket?: ActivityLevel | null;
}

/**
 * The single entry point: does this window justify suggesting a different
 * activity bucket? Folds the gate, the deadband and the decline memory.
 *
 * `null` means "no suggestion — keep the self-reported bucket". A non-null
 * result is only ever a SUGGESTION: both surfaces make the user confirm.
 */
export function suggestActivityLevel({
  activeKcals,
  basalKcal,
  currentBucket,
  declinedBucket,
}: ActivitySuggestionInput): ActivityLevel | null {
  if (!(basalKcal > 0)) return null;

  const { mean, usableDays } = reduceActivityWindow(activeKcals);
  if (usableDays < ACTIVITY_MIN_USABLE_DAYS) return null;

  const implied = impliedMultiplier(mean, basalKcal);

  // At seed there is nothing to hold onto, so the deadband is skipped — this
  // is a pre-fill of an empty field, not a correction of a stated answer.
  if (currentBucket != null) {
    if (Math.abs(implied - ACTIVITY_MULTIPLIERS[currentBucket]) < ACTIVITY_DEADBAND) return null;
  }

  const derived = snapMultiplier(implied);
  if (derived === currentBucket) return null;
  if (derived === declinedBucket) return null;
  return derived;
}

/**
 * What (if anything) a surface should say about activity right now. Exactly
 * one outcome, so two surfaces can never disagree about whether the user is
 * being asked to connect, told to wait, or offered a correction.
 */
export type ActivityGuidance =
  | { kind: 'none' }
  | { kind: 'connect' }
  | { kind: 'progress'; usableDays: number; needed: number }
  | { kind: 'steps-only' }
  | { kind: 'suggestion'; bucket: ActivityLevel };

/**
 * Resolve the one thing worth saying. The ordering IS the policy:
 *
 * 1. Killed or no health store ⇒ silence. Asking someone to connect Health on
 *    a device that hasn't got it is nagging with no payoff.
 * 2. Not connected ⇒ ask once, where the ask makes sense (the activity
 *    picker, where the user is visibly guessing at the answer this replaces).
 * 3. A ready suggestion beats everything — it's the payoff.
 * 4. Window full but no suggestion (deadband / declined / already correct) ⇒
 *    silence, NOT "21 of 21": promising a card that won't come is worse than
 *    saying nothing.
 * 5. Some days ⇒ show the accrual, so a four-week wait isn't mistaken for
 *    nothing happening (which is how a connection gets revoked).
 * 6. Steps but no active energy ⇒ a SOURCE problem, not a waiting problem.
 *    "Keep going" is the wrong advice; the user has to point a watch/fitness
 *    app at the health store.
 */
export function activityGuidance(input: {
  /** Kill-switch AND any surface-level gate (e.g. measured mode). */
  enabled: boolean;
  /** The OS actually has a health store (HealthKit / Health Connect). */
  healthAvailable: boolean;
  connected: boolean;
  activeKcals: number[];
  steps?: number[];
  /** Whatever `suggestActivityLevel` returned for this surface. */
  suggestion: ActivityLevel | null;
}): ActivityGuidance {
  if (!input.enabled || !input.healthAvailable) return { kind: 'none' };
  if (!input.connected) return { kind: 'connect' };
  if (input.suggestion) return { kind: 'suggestion', bucket: input.suggestion };

  const windowClass = classifyActivityWindow(input);
  if (windowClass === 'sufficient') return { kind: 'none' };
  if (windowClass === 'insufficient') {
    return {
      kind: 'progress',
      usableDays: reduceActivityWindow(input.activeKcals).usableDays,
      needed: ACTIVITY_MIN_USABLE_DAYS,
    };
  }
  if (windowClass === 'steps-only') return { kind: 'steps-only' };
  return { kind: 'none' };
}

/**
 * The lowest physical activity level a free-living adult is credited with.
 *
 * **1.40, from the FAO/WHO/UNU 2001 expert consultation on human energy
 * requirements**, which classifies free-living adults as *sedentary or light
 * activity lifestyle* PAL **1.40–1.69**, *active or moderately active*
 * 1.70–1.99, and *vigorous* 2.00–2.40. 1.40 is the bottom of the lowest band —
 * not an average, not a fit, and not a number chosen because of how it comes
 * out on anyone's account.
 *
 * ## What it is doing here: this IS the NEAT correction
 *
 * {@link impliedMultiplier} builds a multiplier out of basal energy plus the
 * device's `activeKcal`. A wrist wearable measures *detected* movement, so
 * that total is missing most non-exercise activity thermogenesis — posture,
 * fidgeting, standing, housework, the incidental cost of being awake. NEAT is
 * not a rounding error: it varies by up to ~2,000 kcal/day between people and
 * runs to several hundred kcal/day even for seated office work.
 *
 * The consequence is measurable rather than theoretical. On the owner's
 * account, 2026-08-19, from 28 of 28 usable days: mean `activeKcal` 246/day
 * over a bare Mifflin basal of 1,632 implies **1.279** — *below the FAO
 * minimum for a free-living adult*, for someone walking 5,213 steps a day and
 * lifting three times a week. A number that cannot be true of a person who is
 * not bedbound is evidence about the instrument, not about the person.
 *
 * Flooring at 1.40 is therefore additive in effect — it supplies exactly the
 * unrecorded NEAT needed to reach the lowest physiologically defensible
 * answer — while being published rather than invented. Above the floor the
 * device's own signal is used unmodified, so a genuinely more active user is
 * still measured rather than assumed.
 *
 * Measured against that account's 97-day gap-free energy balance of 2,385:
 *
 *   raw implied 1.279          -> 2,087   −12.5%
 *   snapped to the ladder 1.2  -> 1,958   −17.9%   (what the card would suggest)
 *   stored bucket 1.55         -> 2,530    +6.1%   (what it has today)
 *   floored at 1.40            -> 2,285    −4.2%   <- inside the ±5% target
 *
 * The ceiling stays at the ladder's own top rather than FAO's 2.40. Raising it
 * would change the answer for very active users on no evidence gathered here,
 * and that is a separate decision.
 */
export const PAL_FLOOR_FREE_LIVING = 1.4;
export const PAL_CEILING = 1.9;

/**
 * A **continuous** activity multiplier from measured active energy — the
 * replacement for snapping to {@link ACTIVITY_LADDER}.
 *
 * The ladder's rungs are 0.175 apart, which is ±285 kcal/day on a 1,632 kcal
 * basal — larger than the error it is being used to correct — and it cannot
 * represent a value like 1.279 at all. {@link snapMultiplier} survives for
 * *naming* a level in copy; it must not be used for arithmetic.
 *
 * Returns `null` when there is nothing to compute from, so a caller can fall
 * back to the self-reported bucket rather than silently adopting a floor.
 */
export function activityMultiplier(mean: number, basalKcal: number): number | null {
  if (!(basalKcal > 0) || !(mean > 0)) return null;
  const raw = impliedMultiplier(mean, basalKcal);
  if (!Number.isFinite(raw)) return null;
  return Math.min(PAL_CEILING, Math.max(PAL_FLOOR_FREE_LIVING, raw));
}
