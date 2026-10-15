import { describe, expect, it } from 'vitest';
import { calculateTdee, basalMifflinStJeor } from './tdee';
import { computeGoalProgress, dailyTargets, dailyTargetsOn } from './targets';
import { goalProgressAt } from './weight-trend';
import { computeWeeklyBudget } from './weekly-budget';
import { calendarDateKey, parseYmd } from './date';
import { hasFormulaInputs, onboardingSeed } from './onboarding-seed';
import { parseWeightToLb } from './body-weight-units';
import { parseMeasureToIn } from './body-measure-units';
import { isZone2 } from './cardio';
import { parseRecipeFromHtml } from './recipe-import';
import { PAL_CEILING, PAL_FLOOR_FREE_LIVING } from './activity-level';
import type { DaySummary } from './day-summary';
import type { DailyLog, Profile, ProfileFields } from './types';

/**
 * Regression tests for the 2026-10-15 audit of `packages/core`. One describe
 * per finding, numbered as in the audit, so a failure names the defect.
 */

const DAY0 = new Date(2026, 6, 1, 12);
const day = (i: number) => new Date(DAY0.getFullYear(), DAY0.getMonth(), DAY0.getDate() + i, 12);
const log = (i: number, calories: number, weight?: number): DailyLog =>
  weight == null ? { date: day(i), calories } : { date: day(i), calories, weight };

const PROFILE: ProfileFields = {
  heightIn: 70,
  age: 35,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1,
  goalDirection: 'lose',
} as ProfileFields;

describe('1 · a perfectly flat run cannot claim near-zero error', () => {
  it('identical daily weigh-ins do not produce a ±1 kcal interval', () => {
    const logs = Array.from({ length: 42 }, (_, i) => log(i, 2000, 180));
    const r = calculateTdee(logs, null, undefined, day(43));
    expect(r.source).toBe('measured');
    if (r.source !== 'measured') return;
    expect(r.trueTdee).toBe(2000);
    expect(r.ci95Tdee).toBeGreaterThanOrEqual(40);
  });

  it('a flat run does not swamp a real run of the same length', () => {
    // Run A: days 0-20, flat 180, 2000 kcal -> 2000. Run B: days 26-46, losing
    // 0.1 lb/day with ±0.5 lb noise at 2000 kcal -> ~2350.
    const a = Array.from({ length: 21 }, (_, i) => log(i, 2000, 180));
    const b = Array.from({ length: 21 }, (_, i) =>
      log(26 + i, 2000, 180 - 0.1 * i + (i % 2 === 0 ? 0.5 : -0.5)),
    );
    const r = calculateTdee([...a, ...b], null, undefined, day(48));
    expect(r.source).toBe('measured');
    // Pre-fix the flat run's weight was ~10^4 times the real run's and this
    // came out at exactly 2000.
    expect(r.trueTdee).toBeGreaterThan(2100);
  });
});

describe('2 · goal progress starts on the goal side the user is coming from', () => {
  const w = (...vals: number[]) =>
    Object.fromEntries(vals.map((v, i) => [calendarDateKey(day(i)), v]));

  it('bulked past a goal, then set a cut goal: 0%, not 100%', () => {
    const p = computeGoalProgress([], w(150, 170, 200), 180, 'lose');
    expect(p).not.toBeNull();
    expect(p!.startWeight).toBe(200);
    expect(p!.pct).toBe(0);
    expect(p!.remaining).toBe(20);
  });

  it('a cut that overshot its goal is still 100% with 0 to go', () => {
    const p = computeGoalProgress([], w(200, 190, 179), 180, 'lose');
    expect(p!.startWeight).toBe(200);
    expect(p!.pct).toBe(100);
    expect(p!.remaining).toBe(0);
  });

  it('a bulk that overshot its goal is still 100%', () => {
    const p = computeGoalProgress([], w(150, 170, 200), 180, 'gain');
    expect(p!.startWeight).toBe(150);
    expect(p!.pct).toBe(100);
  });

  it('starts from the high point since the last crossing, and the trend re-score agrees', () => {
    const p = computeGoalProgress([], w(150, 200, 190), 180, 'lose');
    expect(p!.startWeight).toBe(200);
    expect(p!.pct).toBe(50);
    const t = goalProgressAt(p!, 195);
    expect(t.pct).toBe(25);
    expect(t.remaining).toBe(15);
  });

  it('gain direction mirrors it: cut below a goal, then set a bulk goal', () => {
    const p = computeGoalProgress([], w(200, 170, 160), 180, 'gain');
    expect(p!.startWeight).toBe(160);
    expect(p!.pct).toBe(0);
    expect(p!.remaining).toBe(20);
  });

  it('a cut hovering a pound over its goal keeps its real start (review 2026-10-15)', () => {
    // Cutting at the LAST crossing reset the start to 181 here: 0%, "start 181".
    const p = computeGoalProgress([], w(200, 185, 179, 181), 180, 'lose');
    expect(p!.startWeight).toBe(200);
    expect(p!.pct).toBe(95);
    expect(p!.remaining).toBe(1);
  });

  it('bulked past, cut, then hovered: the start is still the bulk peak', () => {
    const p = computeGoalProgress([], w(150, 200, 179, 181), 180, 'lose');
    expect(p!.startWeight).toBe(200);
    expect(p!.pct).toBe(95);
  });

  it('a bulk hovering just under its goal keeps its real start', () => {
    const p = computeGoalProgress([], w(150, 170, 181, 179), 180, 'gain');
    expect(p!.startWeight).toBe(150);
    expect(p!.pct).toBe(97);
  });

  it('no direction keeps the old earliest-reading start', () => {
    const p = computeGoalProgress([], w(150, 170, 200), 180);
    expect(p!.startWeight).toBe(150);
  });
});

describe('3 · a two-weigh-in fallback slope does not become the target', () => {
  // 14 logged days at 2000 kcal; one weigh-in at each end, 200 -> 195. The
  // run fit refuses (fewer than 3 weigh-ins), so the whole-window fallback
  // used to run on two points: clamped to 2/7 lb/day = 3000 kcal "measured".
  const logs = Array.from({ length: 14 }, (_, i) =>
    log(i, 2000, i === 0 ? 200 : i === 13 ? 195 : undefined),
  );

  it('with no profile anchor it is not a measurement', () => {
    const r = calculateTdee(logs, null, undefined, day(15));
    expect(r.source).not.toBe('measured');
    expect(r.newDailyTarget).toBeLessThan(2500);
  });

  it('with a profile it is the formula anchor, not the two-point slope', () => {
    const logs28 = Array.from({ length: 28 }, (_, i) =>
      log(i, 2000, i === 0 ? 200 : i === 27 ? 195 : undefined),
    );
    const r = calculateTdee(logs28, PROFILE, undefined, day(29));
    const anchor = Math.round(basalMifflinStJeor(PROFILE, 195) * 1.55);
    expect(r.trueTdee).toBe(anchor);
  });

  it('a fallback with enough weigh-ins over a real span still measures', () => {
    // One logged day every 4 days: no run is contiguous, so the run fit
    // refuses and the window fallback runs — over 14 weigh-ins and 52 days.
    const sparse = Array.from({ length: 14 }, (_, i) => log(i * 4, 2000, 180 - i * 0.2));
    const r = calculateTdee(sparse, null, undefined, day(60));
    expect(r.source).toBe('measured');
  });
});

describe('4 · the ADR-0024 clamp holds where the multiplier is used', () => {
  const basal = basalMifflinStJeor(PROFILE, 180);
  const formula = (activityMultiplier: number) =>
    calculateTdee([log(0, 2000, 180)], { ...PROFILE, activityMultiplier }, undefined, day(1)).trueTdee;

  it('a stored multiplier below the floor is lifted to it', () => {
    expect(formula(1.2)).toBe(Math.round(basal * PAL_FLOOR_FREE_LIVING));
  });

  it('a stored multiplier above the ceiling is capped', () => {
    expect(formula(2.6)).toBe(Math.round(basal * PAL_CEILING));
  });

  it('in-band values pass through untouched', () => {
    expect(formula(1.62)).toBe(Math.round(basal * 1.62));
  });
});

describe('5 · the weekly per-day figure respects the calorie floor', () => {
  const summary = (dateKey: string, totalCalories: number): DaySummary =>
    ({ dateKey, totalCalories, mealCount: totalCalories > 0 ? 1 : 0 }) as unknown as DaySummary;
  const week = (cals: number[]) => cals.map((c, i) => summary(calendarDateKey(day(i)), c));

  it('flags and clamps a per-day figure below the floor', () => {
    // Target 2000 → 14,000/week. 3 days at 3,500 → 3,500 left over 4 days = 875.
    const b = computeWeeklyBudget(week([3500, 3500, 3500, 0, 0, 0, 0]), 4, 2000, 1500)!;
    expect(b.perDayInclToday).toBe(875);
    expect(b.perDayBelowFloor).toBe(true);
    expect(b.perDaySuggested).toBe(1500);
  });

  it('is not flagged above the floor, or when the week is already over', () => {
    const ok = computeWeeklyBudget(week([2000, 2000, 0, 0, 0, 0, 0]), 3, 2000, 1500)!;
    expect(ok.perDayBelowFloor).toBe(false);
    expect(ok.perDaySuggested).toBe(ok.perDayInclToday);
    const over = computeWeeklyBudget(week([9000, 9000, 0, 0, 0, 0, 0]), 3, 2000, 1500)!;
    expect(over.perDayInclToday).toBeLessThan(0);
    expect(over.perDayBelowFloor).toBe(false);
  });

  it('without a floor nothing is flagged (old callers unchanged)', () => {
    const b = computeWeeklyBudget(week([3500, 3500, 3500, 0, 0, 0, 0]), 4, 2000)!;
    expect(b.perDayBelowFloor).toBe(false);
    expect(b.perDaySuggested).toBe(875);
  });
});

describe('6 · parseYmd rejects impossible dates', () => {
  it('returns an Invalid Date for a day that does not exist', () => {
    expect(Number.isNaN(parseYmd('2026-02-30').getTime())).toBe(true);
    expect(Number.isNaN(parseYmd('2026-13-01').getTime())).toBe(true);
    expect(Number.isNaN(parseYmd('2026-04-31').getTime())).toBe(true);
  });

  it('still parses real dates, leap days and month keys', () => {
    expect(calendarDateKey(parseYmd('2024-02-29'))).toBe('2024-02-29');
    expect(calendarDateKey(parseYmd('2026-12-31'))).toBe('2026-12-31');
    expect(calendarDateKey(parseYmd('2026-02'))).toBe('2026-02-01');
  });

  it('an impossible dailyWeights key is ignored by the estimator, not rolled into March', () => {
    const logs = [log(0, 2000, 180)];
    const r = calculateTdee(logs, PROFILE, undefined, day(1), { '2026-02-30': 250 } as Record<string, number>);
    expect(Number.isFinite(r.trueTdee)).toBe(true);
  });
});

describe('7 · a missing or prototype-key activity level is not NaN', () => {
  it('formula mode without an activity level degrades to a finite result', () => {
    const p = { ...PROFILE, activityLevel: undefined } as unknown as ProfileFields;
    const r = calculateTdee([log(0, 2000, 180)], p, undefined, day(1));
    expect(Number.isFinite(r.trueTdee)).toBe(true);
    expect(Number.isFinite(r.newDailyTarget)).toBe(true);
  });

  it("'toString' is not an activity level", () => {
    const p = { ...PROFILE, activityLevel: 'toString' } as unknown as ProfileFields;
    const r = calculateTdee([log(0, 2000, 180)], p, undefined, day(1));
    expect(Number.isFinite(r.trueTdee)).toBe(true);
    expect(
      hasFormulaInputs({ sex: 'male', heightIn: 70, age: 35, activityLevel: 'toString' as never }),
    ).toBe(false);
    const seed = onboardingSeed({
      weightLbs: 180,
      goal: 'lose',
      sex: 'male',
      heightIn: 70,
      age: 35,
      activityLevel: 'constructor' as never,
    } as never);
    expect(Number.isFinite(seed.kcal)).toBe(true);
    expect(seed.basis).toBe('heuristic');
  });
});

describe('8 · weight and tape inputs accept plain decimals only', () => {
  it.each(['0x50', '1e3', '0b101', 'Infinity', '1,2,3', '--5', '+5'])('rejects %s', (s) => {
    expect(parseWeightToLb(s, 'us')).toBeNull();
    expect(parseMeasureToIn(s, 'us')).toBeNull();
  });

  it('accepts ordinary numbers, with a comma or a point', () => {
    expect(parseWeightToLb('180', 'us')).toBe(180);
    expect(parseWeightToLb(' 70,5 ', 'us')).toBe(70.5);
    expect(parseWeightToLb('180.4', 'us')).toBe(180.4);
    expect(parseWeightToLb('.5', 'us')).toBe(0.5);
    expect(parseMeasureToIn('84,5', 'us')).toBe(84.5);
  });
});

describe('9 · a past day replays the target as of that day', () => {
  const profile = {
    heightIn: 70,
    age: 35,
    sex: 'male',
    activityLevel: 'moderate',
    targetPaceLbsPerWeek: 0,
    goalDirection: 'maintain',
  } as Profile;
  // 40 days at 2000 kcal and flat weight, then 40 at 3000 and flat weight.
  const logs = Array.from({ length: 80 }, (_, i) => log(i, i < 40 ? 2000 : 3000, 180));
  const weights: Record<string, number> = {};
  const now = day(80);

  it('equals the chain run on that day, not today', () => {
    const key = calendarDateKey(day(39));
    const past = dailyTargetsOn(profile, logs, weights, key, now);
    const replay = dailyTargets(profile, logs.slice(0, 40), weights, day(40));
    const today = dailyTargets(profile, logs, weights, now);
    expect(past.calorieTarget).toBe(replay.calorieTarget);
    expect(past.calorieTarget).not.toBe(today.calorieTarget);
  });

  it("today's key is exactly today's chain", () => {
    const key = calendarDateKey(now);
    expect(dailyTargetsOn(profile, logs, weights, key, now)).toEqual(dailyTargets(profile, logs, weights, now));
  });
});

describe('10 · Zone 2 is recognised in Spanish and Portuguese', () => {
  it.each(['Zona 2', 'zona2 caminata', 'Caminhada zona 2', 'Zone 2', 'Z2 walk', 'zone2'])('%s', (label) => {
    expect(isZone2({ label })).toBe(true);
  });
  it.each(['Zona 20', 'zone 25', 'Horizonal 2', 'Tempo'])('not %s', (label) => {
    expect(isZone2({ label })).toBe(false);
  });
});

describe('11 · recipe numbers with a thousands comma', () => {
  const recipe = (calories: string) =>
    parseRecipeFromHtml(
      `<script type="application/ld+json">${JSON.stringify({
        '@type': 'Recipe',
        name: 'X',
        nutrition: { calories, proteinContent: '12,5 g' },
      })}</script>`,
    )!;

  it('"1,250 kcal" is 1250, not 1', () => {
    expect(recipe('1,250 kcal').perServing!.calories).toBe(1250);
  });

  it('a decimal comma still reads as a decimal', () => {
    expect(recipe('12,5 kcal').perServing!.calories).toBe(13);
    expect(recipe('1,250 kcal').perServing!.protein).toBe(13);
  });

  it('a comma thousands with a point decimal', () => {
    expect(recipe('1,250.5 kcal').perServing!.calories).toBe(1251);
  });
});
