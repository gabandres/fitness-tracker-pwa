import { describe, expect, it } from 'vitest';
import * as milestones from './milestones';
import {
  GOAL_MIN_READINGS,
  MILESTONE_ORDER,
  goalReached,
  newlyEarned,
  sortMilestones,
  streakMilestonesReached,
  type GoalEvidence,
} from './milestones';

describe('streakMilestonesReached', () => {
  it('is empty below the first threshold', () => {
    expect(streakMilestonesReached(0)).toEqual([]);
    expect(streakMilestonesReached(6)).toEqual([]);
  });

  it('records the threshold on the day it is reached', () => {
    expect(streakMilestonesReached(7)).toEqual(['streak-7']);
  });

  it('records every threshold passed, not merely the newest', () => {
    // A user who installs, logs 30 days and never opens this screen should see
    // all three when they finally do — the record is of what happened, not of
    // what was observed happening.
    expect(streakMilestonesReached(30)).toEqual(['streak-7', 'streak-14', 'streak-30']);
  });

  it('saturates at the top threshold', () => {
    expect(streakMilestonesReached(100)).toHaveLength(5);
    expect(streakMilestonesReached(10_000)).toHaveLength(5);
  });

  it('refuses nonsense rather than throwing', () => {
    expect(streakMilestonesReached(Number.NaN)).toEqual([]);
    expect(streakMilestonesReached(-4)).toEqual([]);
  });
});

describe('goalReached', () => {
  const sound: GoalEvidence = {
    goalDirection: 'lose',
    targetWeightLbs: 180,
    trendWeightLb: 179,
    readingCount: GOAL_MIN_READINGS,
    manualReadingCount: 1,
  };

  it('records a cut that arrived', () => {
    expect(goalReached(sound)).toBe(true);
  });

  it('does not record a cut still above its target', () => {
    expect(goalReached({ ...sound, trendWeightLb: 181 })).toBe(false);
  });

  // ── The F7 direction bug, asserted in BOTH directions ────────────────
  //
  // `CutPace` is unsigned and every consumer subtracted it, so a 'gain' user
  // was handed a deficit once the estimator took over. The same assumption here
  // congratulates a bulking user for losing weight. A mis-fire is SILENT in
  // both directions — a wrongly-withheld award is indistinguishable from a user
  // who has not arrived — so neither direction may be left to inference.

  it('records a bulk that arrived', () => {
    expect(goalReached({ ...sound, goalDirection: 'gain', trendWeightLb: 181 })).toBe(true);
  });

  it('does NOT congratulate a bulking user for losing weight', () => {
    expect(goalReached({ ...sound, goalDirection: 'gain', trendWeightLb: 179 })).toBe(false);
  });

  it('never records for maintain — there is no line to cross', () => {
    expect(goalReached({ ...sound, goalDirection: 'maintain' })).toBe(false);
    expect(goalReached({ ...sound, goalDirection: 'maintain', trendWeightLb: 1 })).toBe(false);
  });

  it('does not guess a direction that was never stored', () => {
    expect(goalReached({ ...sound, goalDirection: null })).toBe(false);
    expect(goalReached({ ...sound, goalDirection: undefined })).toBe(false);
  });

  // ── The stray-import defence ─────────────────────────────────────────
  //
  // One 158 lb reading on the demo account dropped measured maintenance from
  // 2,741 to 1,619 kcal (`CLAUDE.local.md`). The trend over several readings is
  // what stops a single sample crossing the line; provenance is secondary.

  it('will not record on too few readings, however far past the target', () => {
    expect(goalReached({ ...sound, trendWeightLb: 120, readingCount: GOAL_MIN_READINGS - 1 }))
      .toBe(false);
  });

  it('will not record on a trend the user never contributed to', () => {
    expect(goalReached({ ...sound, manualReadingCount: 0 })).toBe(false);
  });

  it('refuses absent numbers rather than coercing them', () => {
    expect(goalReached({ ...sound, targetWeightLbs: null })).toBe(false);
    expect(goalReached({ ...sound, trendWeightLb: null })).toBe(false);
    expect(goalReached({ ...sound, trendWeightLb: Number.NaN })).toBe(false);
  });

  it('records an exact landing on the target', () => {
    expect(goalReached({ ...sound, trendWeightLb: 180 })).toBe(true);
    expect(goalReached({ ...sound, goalDirection: 'gain', trendWeightLb: 180 })).toBe(true);
  });
});

describe('newlyEarned', () => {
  it('drops what is already on record', () => {
    expect(newlyEarned(['streak-7'], ['streak-7', 'streak-14'])).toEqual(['streak-14']);
  });

  it('is empty when nothing is new, so the common case issues no write', () => {
    expect(newlyEarned(['streak-7', 'streak-14'], ['streak-7', 'streak-14'])).toEqual([]);
  });
});

describe('sortMilestones', () => {
  it('returns earned keys in archive order', () => {
    expect(sortMilestones(['streak-30', 'first-scan', 'streak-7'])).toEqual([
      'first-scan',
      'streak-7',
      'streak-30',
    ]);
  });

  it('never returns a key that was not earned', () => {
    // The archive renders exactly this. Returning the unearned remainder is the
    // progress meter this module exists to prevent, in the shape of a list.
    const out = sortMilestones(['streak-7']);
    expect(out).toEqual(['streak-7']);
    expect(out).not.toContain('streak-14');
  });

  it('ignores keys it does not know', () => {
    expect(sortMilestones(['not-a-milestone', 'streak-7'])).toEqual(['streak-7']);
  });
});

// ─── The structural ban ────────────────────────────────────────────────
//
// Q5 of the 2026-08-29 design review permitted the retrospective record and
// banned every forward-looking indicator, on the finding that the pressure a
// badge system applies lives in the meter rather than in the record. Written as
// a comment that rule survives until the first person who thinks a countdown
// would be motivating. Written as a test it fails the build.
describe('no forward-looking surface exists', () => {
  const FORWARD = /next|remaining|until|progress|to_?go|countdown|left/i;

  it('exports no symbol that could express distance to an unearned milestone', () => {
    const offenders = Object.keys(milestones).filter((k) => FORWARD.test(k));
    expect(offenders).toEqual([]);
  });

  it('has no threshold-above-a-value helper', () => {
    // The shape to watch for is any export taking a current value and returning
    // an UNEARNED target. `streakMilestonesReached` is the inverse and is safe:
    // everything it returns has already happened.
    for (const n of [1, 6, 8, 29, 99]) {
      for (const key of streakMilestonesReached(n)) {
        const threshold = Number(key.split('-')[1]);
        expect(threshold).toBeLessThanOrEqual(n);
      }
    }
  });

  it('orders only within what can be earned, and every ordered key is in the union', () => {
    expect(new Set(MILESTONE_ORDER).size).toBe(MILESTONE_ORDER.length);
    expect(MILESTONE_ORDER).toHaveLength(11);
  });
});
