import { describe, expect, it } from 'vitest';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor, calculateTdee } from './tdee';
import type { ActivityLevel, DailyLog, ProfileFields } from './types';

const baseProfile: ProfileFields = {
  heightIn: 70,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1.0,
};

function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return { calories, date: d, weight };
}

describe('calculateTdee', () => {
  it('returns the seed when there is no profile and no data', () => {
    const r = calculateTdee([], null);
    expect(r.source).toBe('seed');
    expect(r.newDailyTarget).toBe(1800);
  });

  it('uses Mifflin-St Jeor formula mode with a profile and <14 days', () => {
    const r = calculateTdee([log(0, 2000, 180)], baseProfile);
    expect(r.source).toBe('formula');
    // BMR = 10*81.65 + 6.25*177.8 - 5*30 + 5 = 1782; ×1.55 ≈ 2762
    expect(r.trueTdee).toBeGreaterThan(2600);
    expect(r.trueTdee).toBeLessThan(2900);
    // target = trueTdee - (1.0 * 3500/7=500)
    expect(r.newDailyTarget).toBe(r.trueTdee - 500);
  });

  it('clamps the daily target at the 1500 floor', () => {
    const tiny: ProfileFields = { ...baseProfile, heightIn: 48, age: 90, targetPaceLbsPerWeek: 2 };
    const r = calculateTdee([log(0, 1200, 100)], tiny);
    expect(r.newDailyTarget).toBeGreaterThanOrEqual(1500);
  });

  it('honors a configured calorieFloor above the 1500 default (formula mode)', () => {
    // Small person + aggressive pace would land the target below 1850.
    const tiny: ProfileFields = {
      ...baseProfile, heightIn: 60, age: 60, sex: 'female',
      activityLevel: 'sedentary', targetPaceLbsPerWeek: 2, calorieFloor: 1850,
    };
    const r = calculateTdee([log(0, 1400, 120)], tiny);
    expect(r.newDailyTarget).toBe(1850);
  });

  it('ignores an unset / non-positive calorieFloor (falls back to 1500)', () => {
    const tiny: ProfileFields = {
      ...baseProfile, heightIn: 48, age: 90, targetPaceLbsPerWeek: 2, calorieFloor: 0,
    };
    const r = calculateTdee([log(0, 1200, 100)], tiny);
    expect(r.newDailyTarget).toBeGreaterThanOrEqual(1500);
  });

  it('applies calorieFloor in measured mode', () => {
    // 16 days losing fast on low intake → raw target below the floor.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 16; i++) logs.push(log(16 - i, 1500, 150 - i * 0.3));
    const withFloor = calculateTdee(logs, { ...baseProfile, targetPaceLbsPerWeek: 2, calorieFloor: 1850 });
    const without = calculateTdee(logs, { ...baseProfile, targetPaceLbsPerWeek: 2 });
    expect(withFloor.source).toBe('measured');
    expect(withFloor.newDailyTarget).toBeGreaterThanOrEqual(1850);
    // The floor only ever raises (never lowers) the target vs the 1500 default.
    expect(withFloor.newDailyTarget).toBeGreaterThanOrEqual(without.newDailyTarget);
  });

  it('switches to measured mode with >=14 logged days and a weight trend', () => {
    // 20 days, intake ~2000, losing 0.1 lb/day (real deficit).
    const logs: DailyLog[] = [];
    for (let i = 19; i >= 0; i--) {
      logs.push(log(i, 2000, 185 - (19 - i) * 0.1));
    }
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    // TDEE ≈ intake + deficit(0.1 lb/day * 3500) = 2000 + 350 = ~2350
    expect(r.trueTdee).toBeGreaterThan(2250);
    expect(r.trueTdee).toBeLessThan(2450);
    expect(r.reliable).toBe(true);
  });

  it('excludes logged-but-zero-kcal (weigh-in-only) days from the intake average', () => {
    // 15 flat-weight days: 2 weigh-in-only (0 kcal) + 13 at 2000 kcal. If the
    // zeros were averaged in, intake would crater toward ~1733; excluded, the
    // measured TDEE stays near 2000 (flat weight ⇒ ~0 deficit).
    const logs: DailyLog[] = [];
    for (let i = 0; i < 15; i++) logs.push(log(15 - i, i < 2 ? 0 : 2000, 180));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    expect(r.trueTdee).toBeGreaterThan(1950);
  });

  it('falls back to seed when every intake day is zero', () => {
    const logs: DailyLog[] = [];
    for (let i = 0; i < 15; i++) logs.push(log(15 - i, 0, 180));
    expect(calculateTdee(logs, baseProfile).source).toBe('seed');
  });

  it('flags low completeness (and not reliable) for a gappy window', () => {
    // 14 weigh-ins every OTHER day → spans ~27 calendar days → ~50% complete.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 14; i++) logs.push(log(27 - i * 2, 2000, 185 - i * 0.1));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    expect(r.loggingCompletenessPct).toBeGreaterThanOrEqual(45);
    expect(r.loggingCompletenessPct).toBeLessThanOrEqual(55);
    expect(r.reliable).toBe(false);
  });
});

describe('basalMifflinStJeor', () => {
  // Worked by hand from the published Mifflin-St Jeor equation (male +5 /
  // female −161), NOT from the implementation: 180 lb = 81.64656 kg,
  // 70 in = 177.8 cm → 10(81.64656) + 6.25(177.8) − 5(30) + 5.
  it('matches the published male +5 constant', () => {
    expect(basalMifflinStJeor({ heightIn: 70, age: 30, sex: 'male' }, 180)).toBeCloseTo(1782.7156, 3);
  });

  it('matches the published female −161 constant', () => {
    expect(basalMifflinStJeor({ heightIn: 70, age: 30, sex: 'female' }, 180)).toBeCloseTo(1616.7156, 3);
  });

  it('is the bare BMR — it never applies an activity factor', () => {
    // The activity bucket is not even part of the input shape (Refine Targets
    // calls this before a bucket exists), so the five buckets can only differ
    // through ACTIVITY_MULTIPLIERS, never through the basal.
    const basal = basalMifflinStJeor({ heightIn: 70, age: 30, sex: 'male' }, 180);
    expect(basal).toBeLessThan(1800);
  });

  it('reconstructs formula-mode TDEE for every activity bucket', () => {
    const buckets: ActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];
    for (const activityLevel of buckets) {
      const profile: ProfileFields = { ...baseProfile, activityLevel, goalWeightLbs: 180 };
      const r = calculateTdee([log(0, 2000, 180)], profile);
      const basal = basalMifflinStJeor(profile, 180);
      expect(r.trueTdee).toBe(Math.round(basal * ACTIVITY_MULTIPLIERS[activityLevel]));
    }
  });

  it('exposes the five locked activity multipliers', () => {
    expect(ACTIVITY_MULTIPLIERS).toEqual({
      sedentary: 1.2,
      light: 1.375,
      moderate: 1.55,
      active: 1.725,
      very_active: 1.9,
    });
  });
});

describe('weight-trend outlier rejection', () => {
  /** 21 days of clean data: 2000 kcal/day, losing 0.2 lb/day from 185. */
  const clean = () =>
    Array.from({ length: 21 }, (_, i) => log(20 - i, 2000, 185 - 0.2 * (20 - (20 - i))));

  it('changes nothing when every weigh-in is plausible', () => {
    const r = calculateTdee(clean(), baseProfile);
    expect(r.source).toBe('measured');
    expect(r.outliersDropped).toBe(0);
    // intake 2000 + 0.2 lb/day * 3500 = 2700
    expect(r.trueTdee).toBeGreaterThan(2650);
    expect(r.trueTdee).toBeLessThan(2750);
  });

  it('ignores one wildly wrong weigh-in instead of rewriting the trend', () => {
    const withTypo = clean();
    // A mis-synced reading — the exact shape that took a real account's
    // maintenance from 2,741 to 1,619 kcal.
    withTypo[0] = log(20, 2000, 158);

    const dirty = calculateTdee(withTypo, baseProfile);
    const pristine = calculateTdee(clean(), baseProfile);

    expect(dirty.outliersDropped).toBe(1);
    // Within 50 kcal of the clean answer, versus ~1,100 kcal adrift before.
    expect(Math.abs(dirty.trueTdee - pristine.trueTdee)).toBeLessThan(50);
  });

  it('does not flip the sign of the deficit on a single bad entry', () => {
    const withTypo = clean();
    withTypo[0] = log(20, 2000, 158);
    const r = calculateTdee(withTypo, baseProfile);
    // Losing weight ⇒ maintenance above intake. The bug made this inequality
    // fail, which is what pinned the target to the 1500 floor.
    expect(r.trueTdee).toBeGreaterThan(2000);
  });

  it('keeps normal day-to-day fluctuation', () => {
    // ±1.5 lb of water swing is real data, not an outlier.
    const noisy = clean().map((l, i) =>
      l.weight != null ? { ...l, weight: l.weight + (i % 2 ? 1.5 : -1.5) } : l,
    );
    expect(calculateTdee(noisy, baseProfile).outliersDropped).toBe(0);
  });

  it('trusts the data when a third or more of it looks anomalous', () => {
    // A genuine whoosh: half the window steps down hard. If that many points
    // are "outliers", the trend is the anomaly — keep everything.
    const stepped = clean().map((l, i) =>
      l.weight != null && i > 10 ? { ...l, weight: l.weight - 8 } : l,
    );
    expect(calculateTdee(stepped, baseProfile).outliersDropped).toBe(0);
  });

  it('leaves short weigh-in histories alone', () => {
    // 14 logged days but only 4 weigh-ins — too few to estimate spread from.
    const sparse = Array.from({ length: 15 }, (_, i) =>
      i % 4 === 0 ? log(14 - i, 2000, 185 - i * 0.2) : log(14 - i, 2000),
    );
    expect(calculateTdee(sparse, baseProfile).outliersDropped).toBe(0);
  });
});

/**
 * A break in weighing is a boundary, not data.
 *
 * Every scenario below holds the ground truth identical — the person burns
 * 2,500, eats 2,500 — so any deviation from 2,500 is error the break
 * introduced. Numbers in the comments are measured, before and after, on this
 * function. Research: docs/research/tdee-logging-gaps.md §1a/§1b.
 */
describe('weight-trend gap segmentation', () => {
  /** 14 clean days, a two-week break, then 14 days back at a new weight. */
  const acrossBreak = (before: number, after: (dayIndex: number) => number) => {
    const logs: DailyLog[] = [];
    for (let i = 41; i >= 28; i--) logs.push(log(i, 2500, before));
    for (let i = 13; i >= 0; i--) logs.push(log(i, 2500, after(13 - i)));
    return logs;
  };

  it('reads the weight you came back at, instead of discarding every reading of it', () => {
    // The step case. Fitted across the break, the new plateau looks like 7 bad
    // readings and maintenance came out at 2,038 — a 462 kcal error built by
    // throwing away every observation of a real 4 lb change.
    const r = calculateTdee(acrossBreak(180, () => 184), baseProfile);
    // `measuredTdee`, not `trueTdee`. This scenario is about the SEGMENTATION
    // math, and that is what `measuredTdee` reports — the undamped
    // `avgDailyIntake + deficit`. Since 2026-08-19 `trueTdee` additionally
    // carries confidence damping, and a break necessarily costs completeness:
    // 28 logged days across a 42-day span is 67%, just under RELIABLE_MIN_PCT,
    // so ~4% of the estimate is pulled to the formula anchor. Asserting the
    // exact 2,500 here would be asserting that damping does not exist.
    expect(r.measuredTdee).toBe(2500);
    expect(r.trueTdee).toBeCloseTo(2500, -2); // damping moves it ~12 kcal
    expect(r.outliersDropped).toBe(0);
  });

  it('does not read travel water leaving as fat loss', () => {
    // The rebound case, and the reason segmenting alone is not enough:
    // whole-window 2,392 · segmented without a settle window 3,469 · with it,
    // 2,500. The +969 version is the dangerous one — it raises the target.
    const r = calculateTdee(
      acrossBreak(180, (d) => (d < 7 ? 184 - d * 0.5 : 180.5)),
      baseProfile,
    );
    // See the step case above for why this pins `measuredTdee`.
    expect(r.measuredTdee).toBe(2500);
    expect(r.trueTdee).toBeCloseTo(2500, -2);
  });

  it('ignores a break shorter than a week', () => {
    // A long weekend is a skipped morning, not a changed regime. Six days off
    // must leave the fit exactly as it was.
    const logs: DailyLog[] = [];
    for (let i = 20; i >= 0; i--) if (i > 13 || i < 8) logs.push(log(i, 2000, 185 - 0.2 * (20 - i)));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    // Still the whole-window slope: 0.2 lb/day ⇒ 2000 + 700.
    expect(r.trueTdee).toBeGreaterThan(2650);
    expect(r.trueTdee).toBeLessThan(2750);
  });

  it('keeps the old fit until enough weigh-ins survive the settle window', () => {
    // Three weigh-ins since coming back is a line through water. Falling back
    // to the whole window is biased; returning null would be worse — that
    // sends calculateTdee to the hardcoded 2,450 seed, replacing this user's
    // own data with nobody's.
    const logs: DailyLog[] = [];
    for (let i = 41; i >= 28; i--) logs.push(log(i, 2500, 180));
    for (let i = 2; i >= 0; i--) logs.push(log(i, 2500, 184));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    expect(r.trueTdee).toBeGreaterThan(2000);
  });

  it('changes nothing for someone who never stopped weighing', () => {
    // The guard against over-reach: no break, no segmentation, byte-identical
    // to the behaviour every existing user has today.
    const daily = Array.from({ length: 21 }, (_, i) => log(20 - i, 2000, 185 - 0.2 * i));
    const r = calculateTdee(daily, baseProfile);
    expect(r.outliersDropped).toBe(0);
    expect(r.trueTdee).toBeGreaterThan(2650);
    expect(r.trueTdee).toBeLessThan(2750);
  });
});

/**
 * One logged meal must not move maintenance by 1,700 kcal.
 *
 * Reproduced from a real account on 2026-08-14. The user stopped weighing
 * 07-11 → 08-04, so `lastTrendSegment` cut there and the settle window left a
 * run starting 08-11. With THREE points that run was below
 * `MIN_SEGMENT_POINTS` and the whole 25-point window carried the fit:
 * −0.0044 lb/day, maintenance 1,889.
 *
 * Logging that day's food made it a logged day, which pulled its weigh-in into
 * the window, the run hit exactly four points, and the fit switched to a line
 * through four CONSECUTIVE DAILY readings — a three-day span, dominated by one
 * 1.4 lb overnight drop. Result: −0.50 lb/day, an implied deficit of 1,750
 * kcal/day, maintenance 3,596 and a recommended target of 3,146 against a
 * calorie floor of 1,850.
 *
 * The defect is the discontinuity, not the number: the answer depended on which
 * side of a point-count threshold the data landed, and the two sides disagreed
 * by more than the quantity being estimated. Counting points cannot see it —
 * four daily weigh-ins clear the count and still span three days.
 */
describe('a short post-break segment cannot flip maintenance (2026-08-14)', () => {
  const WEIGHTS: Record<string, number> = {
    '2026-06-26': 161, '2026-06-27': 160, '2026-06-28': 160, '2026-06-29': 159.4,
    '2026-06-30': 161, '2026-07-01': 160.2, '2026-07-02': 159.6, '2026-07-03': 159.2,
    '2026-07-04': 160, '2026-07-05': 159.6, '2026-07-06': 158.8, '2026-07-07': 158.2,
    '2026-07-08': 158.18, '2026-07-09': 158.6, '2026-07-10': 159, '2026-07-11': 159.4,
    // the break: no weigh-ins 07-12 → 08-03
    '2026-08-04': 161.2, '2026-08-05': 160.2, '2026-08-06': 160.4, '2026-08-07': 159.6,
    '2026-08-09': 159.6, '2026-08-10': 160.2, '2026-08-11': 159.6, '2026-08-12': 158.2,
    '2026-08-13': 158, '2026-08-14': 158,
  };
  const day = (k: string, calories: number): DailyLog => ({
    date: new Date(`${k}T12:00:00`),
    calories,
    weight: WEIGHTS[k],
  });
  const upTo13 = Object.keys(WEIGHTS).filter((k) => k < '2026-08-14').map((k) => day(k, 1880));
  const withToday = [...upTo13, day('2026-08-14', 1445)];
  const profile = { calorieFloor: 1850, targetPaceLbsPerWeek: 1 } as never;

  it('does not move maintenance by more than 250 kcal for one more logged day', () => {
    const before = calculateTdee(upTo13, profile);
    const after = calculateTdee(withToday, profile);
    expect(before.source).toBe('measured');
    expect(after.source).toBe('measured');
    // Was 1,889 → 3,596 before the span rule.
    expect(Math.abs(after.trueTdee - before.trueTdee)).toBeLessThan(250);
  });

  it('never infers a deficit a human cannot run', () => {
    for (const logs of [upTo13, withToday]) {
      const r = calculateTdee(logs, profile);
      // trueTdee = avgIntake + deficit; avg intake here is ~1,880.
      expect(r.trueTdee).toBeLessThan(1880 + 1000 + 1);
    }
  });

  it('keeps the recommended target off an impossible number', () => {
    const r = calculateTdee(withToday, profile);
    expect(r.newDailyTarget).toBeLessThan(2600); // was 3,146
    expect(r.newDailyTarget).toBeGreaterThanOrEqual(1850); // the floor still binds
  });
});
