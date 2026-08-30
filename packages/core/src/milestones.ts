// Milestones — the retrospective record (#108/#109/#110).
// Pure, framework-free, no I/O — the day-summary convention (ADR-0003).

/**
 * ## Why this is called "milestones" and not "achievements"
 *
 * `UX_AUDIT.md` §S12 lists **shame-based gamification** — streak-break
 * punishment, red/green progress — under things this product explicitly does
 * not do, and names four load-bearing positioning words, one of which is *log*:
 * "editorial, adult, **not gamified**". `README.md` sells the app as "not
 * another gamified shame-tracker". ADR-0032 shipped fasting with "no goal, no
 * protocol, no streak" as a deliberate difference from Fastic's Flames and
 * Frosties.
 *
 * That decision was narrowed on 2026-08-29 rather than reversed, and the
 * narrowing is the whole design of this module: **a record of what already
 * happened is permitted; a mechanism that applies forward pressure is not.**
 *
 * ## The line, stated once
 *
 * The pressure in a badge system lives in the FORWARD-LOOKING meter, not in the
 * backward-looking record. Ignia already shows a live streak on Today and on
 * ShareCard, so recording that someone once reached 30 days adds no pressure the
 * running counter does not already create. "Four days to your next badge"
 * manufactures a new one.
 *
 * **So this module cannot express that, structurally.** There is no function
 * here that takes a current value and returns an unearned target, no ordering
 * that implies a ladder to climb, and no export whose name contains `next`,
 * `remaining`, `until`, `progress` or `toGo`. `milestones.test.ts` asserts that
 * over the export surface, so a later "helpful" addition fails the suite rather
 * than passing review. Add a countdown here and the build breaks; that is
 * deliberate, and it is the enforcement `UX_AUDIT.md` asked for in prose and
 * never got.
 *
 * A milestone is also **write-once and never recomputed on read**. `earnedAt` is
 * a fact about a moment. If the streak later breaks the record stands, because a
 * badge that can be taken away is exactly the streak-break punishment the
 * positioning rejects.
 */

/** Every milestone this app can record. Closed union — the archive renders it. */
export type MilestoneKey =
  | 'streak-7'
  | 'streak-14'
  | 'streak-30'
  | 'streak-60'
  | 'streak-100'
  | 'first-scan'
  | 'first-workout'
  | 'first-fast'
  | 'first-weigh-in'
  | 'meals-100'
  | 'goal-reached';

/**
 * Consecutive-day thresholds, ascending.
 *
 * Ascending order is for *reading* the earned set back in the order it was
 * earned. It is deliberately NOT exposed alongside any "current streak" value —
 * pairing the two is how a ladder gets rendered.
 */
export const STREAK_MILESTONES = [7, 14, 30, 60, 100] as const;

/** Meals logged before `meals-100` is recorded. */
export const MEALS_MILESTONE = 100;

/**
 * Minimum weigh-ins behind the trend before `goal-reached` may be recorded.
 *
 * This, not provenance, is the primary defence against a fabricated award. A
 * single stray import has already been observed to move this project's numbers
 * hard — one 158 lb reading on the demo account dropped measured maintenance
 * from 2,741 to 1,619 kcal and clamped the target to the floor
 * (`CLAUDE.local.md`). A trend over five readings does not cross a goal line on
 * one bad sample; a latest-reading check does.
 */
export const GOAL_MIN_READINGS = 5;

/**
 * The archive's display order: streaks ascending, then the firsts in the order
 * a real account tends to hit them, then the goal.
 *
 * Only EARNED entries are ever rendered from this (#110 decision). Rendering the
 * unearned remainder is the progress meter this module exists to prevent, in the
 * shape of a list.
 */
export const MILESTONE_ORDER: readonly MilestoneKey[] = [
  'first-weigh-in',
  'first-scan',
  'first-workout',
  'first-fast',
  'streak-7',
  'streak-14',
  'meals-100',
  'streak-30',
  'streak-60',
  'streak-100',
  'goal-reached',
];

/** Streak thresholds this streak length has passed. Never what is coming. */
export function streakMilestonesReached(streak: number): MilestoneKey[] {
  if (!Number.isFinite(streak) || streak <= 0) return [];
  return STREAK_MILESTONES.filter((n) => streak >= n).map((n) => `streak-${n}` as MilestoneKey);
}

/** What `goalReached` needs to answer honestly. Every field may be absent. */
export interface GoalEvidence {
  /** `'maintain'` can never award — there is no line to cross. */
  goalDirection?: 'lose' | 'gain' | 'maintain' | null;
  targetWeightLbs?: number | null;
  /**
   * The least-squares TREND weight, in pounds — never a single reading. The
   * caller already computes this for the Body hero.
   */
  trendWeightLb?: number | null;
  /** How many weigh-ins the trend was fitted over. */
  readingCount?: number | null;
  /**
   * How many of those the user entered by hand. Secondary to the trend, but a
   * record built entirely from passive imports is a record of the phone's
   * behaviour rather than the person's.
   */
  manualReadingCount?: number | null;
}

/**
 * Has the user reached the goal weight they set for themselves?
 *
 * ## Why this is the ONLY body milestone
 *
 * The other two candidates were dropped on 2026-08-29. "First 5 lb" is a
 * *magnitude* award — the eating-disorder-adjacent half, and the one a stray
 * import can fabricate. "Four weeks on target" is adherence pressure wearing a
 * badge. Goal-reached is neither: the number is one the user chose, so recording
 * that they arrived at it is descriptive rather than prescriptive.
 *
 * ## The direction is read, never assumed
 *
 * `CutPace` is unsigned and every consumer subtracted it, so a "gain" user was
 * handed a deficit once the estimator took over (UX_AUDIT F7). A milestone built
 * on the same assumption congratulates a bulking user for losing weight. Both
 * directions are asserted in the tests, because a mis-fire here is silent in
 * BOTH — a wrongly-withheld award looks identical to a user who has not arrived.
 */
export function goalReached(ev: GoalEvidence): boolean {
  const { goalDirection, targetWeightLbs, trendWeightLb } = ev;

  // Maintain has no line to cross, and an absent direction is not a licence to
  // guess one from the numbers.
  if (goalDirection !== 'lose' && goalDirection !== 'gain') return false;
  if (typeof targetWeightLbs !== 'number' || !Number.isFinite(targetWeightLbs)) return false;
  if (typeof trendWeightLb !== 'number' || !Number.isFinite(trendWeightLb)) return false;

  const readings = ev.readingCount ?? 0;
  if (readings < GOAL_MIN_READINGS) return false;

  const manual = ev.manualReadingCount ?? 0;
  if (manual < 1) return false;

  return goalDirection === 'lose'
    ? trendWeightLb <= targetWeightLbs
    : trendWeightLb >= targetWeightLbs;
}

/**
 * The candidates not already on record.
 *
 * Call sites write with the milestone key as the DOCUMENT ID, so a duplicate
 * attempt is an idempotent overwrite rather than a second badge; this exists so
 * the common case issues no write at all, and so the celebration fires once.
 */
export function newlyEarned(
  earned: Iterable<MilestoneKey | string>,
  candidates: readonly MilestoneKey[],
): MilestoneKey[] {
  const have = new Set<string>(earned);
  return candidates.filter((k) => !have.has(k));
}

/** Earned keys in archive order. Unearned keys are never returned. */
export function sortMilestones(earned: Iterable<MilestoneKey | string>): MilestoneKey[] {
  const have = new Set<string>(earned);
  return MILESTONE_ORDER.filter((k) => have.has(k));
}
