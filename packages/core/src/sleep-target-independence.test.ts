import { describe, expect, it } from 'vitest';
import { dailyTargets } from './targets';
import { computeWeeklyInsights } from './weekly-insights';
import { summarizeDays } from './day-summary';
import { sleepIntakeContrast, sleepWindow, type SleepEntry } from './sleep-intake';
import type { DailyLog, Profile } from './types';

/**
 * The seam between SLEEP and the TARGET, pinned before anything crosses it
 * (ADR-0033 decision 8, issue #81).
 *
 * ## Why this file exists before the bug does
 *
 * Modelled on `cardio-energy-independence.test.ts`, which pins the same kind of
 * seam for imported cardio energy, and on `tdee-wearable-independence.test.ts`
 * one level up. This one is written *in advance* because the plausible
 * optimisation is already obvious and already sounds like an improvement:
 * **we can see they slept badly, so soften the target.**
 *
 * Three reasons it is not an improvement.
 *
 * 1. **There is no evidence base for a sleep-conditioned calorie target.** The
 *    card ADR-0033 designs is explicitly a *description* of days that already
 *    happened, not a causal claim, and a target adjustment is a causal claim
 *    with money on it.
 * 2. **The estimator's whole value is that it fits intake against a weight
 *    trend without editorial.** Anything the app adds by hand is a thumb on a
 *    scale the user came here to read straight.
 * 3. **It would be invisible.** A correction applied to a number the user
 *    cannot audit is precisely the silent degradation ADR-0030 was written
 *    about — and it would move only on the days they slept badly, which is the
 *    hardest possible shape to notice.
 *
 * ## What is actually asserted
 *
 * With 120 days of a consistent logger, moving **every** night across 4 / 7 /
 * 10 hours must leave `dailyTargets` byte-identical — and `computeWeeklyInsights`
 * too, since that is the other derivation on this screen that could quietly
 * grow a sleep term. Then the last test shows what those are worth: the sleep
 * module itself is proven to *react* to the same input, so the two above cannot
 * be passing because the fixture does nothing.
 *
 * **This test is structural, and that is the point.** `dailyTargets` takes
 * logs, weights and a profile; there is no parameter for sleep, so today it
 * cannot see one. The day someone adds `sleepHours` to `DaySummary` or threads
 * a sleep map into the estimator, this file is what stops it — it fails at
 * compile time on the new signature, or at runtime on the moved number.
 */

const KEY = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Deterministic LCG + Box-Muller, as in the sibling tests: a bound measured
 *  against a different sample every run is not a bound. */
function noise(seed: number): () => number {
  let s = seed;
  const next = (): number => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return () => {
    const u = Math.max(next(), 1e-9);
    const v = Math.max(next(), 1e-9);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

const PROFILE = {
  heightIn: 70,
  age: 34,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1,
  goalDirection: 'lose',
  calorieFloor: 1500,
} as unknown as Profile;

const DAY0 = new Date('2026-04-26T12:00:00');

/**
 * 120 days of a consistent logger, plus a sleep row for every one of them.
 *
 * `sleepHours` is the variable under test. It is written into `dailySleep`, the
 * collection the card reads, and into nothing else — because there IS nothing
 * else: sleep is absent from `DaySummary`, from `WeeklyInsights`, from the TDEE
 * estimator and from the widget snapshot, and this fixture would have nowhere
 * to put it even if it wanted to.
 */
function buildHistory(sleepHours: number, days = 120) {
  const g = noise(20260825);
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  const sleepByDay: Record<string, SleepEntry> = {};
  const dateKeys: string[] = [];
  let trueWeight = 200;
  for (let i = 0; i < days; i++) {
    const d = new Date(DAY0);
    d.setDate(d.getDate() + i);
    const calories = Math.round(2200 + g() * 180);
    trueWeight += (calories - 2600) / 3500;
    const weight = Math.round((trueWeight + g() * 1.2) * 10) / 10;
    logs.push({ date: d, calories, weight, protein: 150 });
    weights[KEY(d)] = weight;
    sleepByDay[KEY(d)] = { hours: sleepHours, source: 'import' };
    dateKeys.push(KEY(d));
  }
  return { logs, weights, sleepByDay, dateKeys };
}

describe('sleep cannot reach a target', () => {
  it('leaves the measured target byte-identical across 4, 7 and 10 hours a night', () => {
    const baseline = (() => {
      const h = buildHistory(7);
      return dailyTargets(PROFILE, h.logs, h.weights);
    })();

    // Guard the guard: if this were not measured mode the assertions below
    // would be about the formula path and would prove nothing.
    expect(baseline.tdee.source).toBe('measured');

    for (const hours of [4, 5.5, 7, 8.5, 10]) {
      const h = buildHistory(hours);
      const result = dailyTargets(PROFILE, h.logs, h.weights);

      expect(result.tdee.source).toBe('measured');
      expect(result.calorieTarget).toBe(baseline.calorieTarget);
      expect(result.proteinTarget).toBe(baseline.proteinTarget);
      expect(result.tdee.trueTdee).toBe(baseline.tdee.trueTdee);
      expect(result.tdee).toEqual(baseline.tdee);
    }
  });

  it('leaves the week’s insights byte-identical too', () => {
    // The other derivation on the Trends screen, and the other place a sleep
    // term could plausibly be smuggled in — "you slept badly, so your adherence
    // reads worse than it was".
    const insightsFor = (hours: number) => {
      const h = buildHistory(hours);
      const keys = h.dateKeys.slice(-7);
      const summaries = summarizeDays(keys, h.logs, h.weights);
      const targets = dailyTargets(PROFILE, h.logs, h.weights);
      return computeWeeklyInsights(summaries, targets.calorieTarget, [], targets.proteinTarget);
    };

    const baseline = insightsFor(7);
    for (const hours of [4, 10]) expect(insightsFor(hours)).toEqual(baseline);
  });

  it('keeps sleep out of the day rollup entirely', () => {
    // `DaySummary` is what every aggregation downstream reads. Sleep is not on
    // it, so an aggregation cannot pick it up by accident — it would have to be
    // added here first, deliberately, and that is the change this asserts
    // against.
    const h = buildHistory(4);
    const [summary] = summarizeDays(h.dateKeys.slice(-1), h.logs, h.weights);

    expect(Object.keys(summary!).sort()).toEqual([
      'dateKey',
      'exercised',
      'mealCount',
      'totalCalories',
      'totalCarbs',
      'totalFat',
      'totalProtein',
      'weightLb',
    ]);
  });
});

describe('the seam is worth something', () => {
  // Without this, the tests above would pass just as happily if the fixture's
  // sleep rows were never written at all — the opposite failure from the one
  // they exist to catch. The same variable that must NOT move a target is
  // shown moving the thing it is allowed to move.
  it('measurably moves the sleep card across the same range', () => {
    const four = buildHistory(4);
    const ten = buildHistory(10);

    expect(sleepWindow(four.sleepByDay, four.dateKeys.slice(-14)).meanHours).toBe(4);
    expect(sleepWindow(ten.sleepByDay, ten.dateKeys.slice(-14)).meanHours).toBe(10);
  });

  it('and moves the contrast when the nights actually differ', () => {
    // A history where short nights really do pair with bigger days — the card
    // says something, and the target still does not move.
    const h = buildHistory(7, 14);
    const keys = h.dateKeys;
    for (let i = 0; i < keys.length; i++) {
      h.sleepByDay[keys[i]!] = { hours: i < 7 ? 5.5 : 8, source: 'import' };
    }
    const days = summarizeDays(keys, h.logs, h.weights).map((d, i) => ({
      ...d,
      totalCalories: i < 7 ? 2500 : 2000,
    }));

    const contrast = sleepIntakeContrast(h.sleepByDay, days);

    expect(contrast).not.toBeNull();
    expect(contrast!.differenceKcal).toBe(500);
  });
});
