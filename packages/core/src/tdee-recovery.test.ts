import { describe, expect, it } from 'vitest';
import { calculateTdee } from './tdee';
import type { DailyLog, ProfileFields } from './types';

/**
 * Ground-truth recovery tests for measured-mode TDEE.
 *
 * Every other TDEE suite in this repo asserts on relationships (this number
 * moved the right way, that one stayed inside a band). None of them build data
 * from a KNOWN expenditure and check the estimator gets it back, which is the
 * only test that can catch the failure this file was written for: on
 * 2026-08-20 a live account reported maintenance 2,509 when its own gap-free
 * history said 2,266, because a 9-day post-travel fragment — whose slope was
 * statistically indistinguishable from zero — was trusted over 42 days of
 * logging.
 *
 * The generator is the energy-balance identity run forwards:
 *
 *   w(d+1) = w(d) − (TDEE − intake(d)) / 3500 + noise
 *
 * so the estimator is being asked to invert exactly the physics the app claims
 * to model. Noise is a seeded LCG, not `Math.random`, so a failure here is
 * reproducible rather than a flake.
 */

const KCAL_PER_POUND = 3500;

const profile: ProfileFields = {
  heightIn: 68,
  age: 33,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1.0,
  calorieFloor: 1500,
} as ProfileFields;

/** Deterministic LCG in [-1, 1). */
function noiseGen(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1;
  };
}

interface Day {
  dayOffset: number;
  intake: number;
  weight?: number;
}

/**
 * Simulate `days` of true expenditure `tdee`, then emit only the days named by
 * `logged`. `waterAmplitude` is the ±lb of day-to-day water/glycogen swing —
 * 0.8 lb matches the residual SD measured on the live account.
 */
function simulate(opts: {
  tdee: number;
  days: number;
  intake: (d: number) => number;
  startWeight: number;
  waterAmplitude?: number;
  seed?: number;
  logged?: (d: number) => boolean;
  weighed?: (d: number) => boolean;
}): DailyLog[] {
  const { tdee, days, intake, startWeight } = opts;
  const amp = opts.waterAmplitude ?? 0.8;
  const rnd = noiseGen(opts.seed ?? 12345);
  const isLogged = opts.logged ?? (() => true);
  const isWeighed = opts.weighed ?? (() => true);

  const rows: Day[] = [];
  let trueWeight = startWeight;
  for (let d = 0; d < days; d++) {
    const cals = intake(d);
    // Physics first, on EVERY day — including unlogged ones. The scale does not
    // stop moving because the user stopped typing, and that asymmetry is the
    // bias this suite exists to pin.
    trueWeight -= (tdee - cals) / KCAL_PER_POUND;
    if (!isLogged(d)) continue;
    rows.push({
      dayOffset: d,
      intake: cals,
      weight: isWeighed(d) ? trueWeight + amp * rnd() : undefined,
    });
  }

  const base = new Date(2026, 0, 1);
  return rows.map((r) => {
    const date = new Date(base);
    date.setDate(date.getDate() + r.dayOffset);
    const log: DailyLog = { date, calories: r.intake } as DailyLog;
    if (r.weight != null) (log as { weight?: number }).weight = r.weight;
    return log;
  });
}

describe('measured TDEE recovers known expenditure', () => {
  it('clean contiguous logger, steady deficit', () => {
    const logs = simulate({ tdee: 2600, days: 56, intake: () => 2000, startWeight: 190 });
    const r = calculateTdee(logs, profile);
    expect(r.source).toBe('measured');
    expect(r.trueTdee).toBeGreaterThan(2450);
    expect(r.trueTdee).toBeLessThan(2750);
  });

  it('maintenance — flat weight, no phantom deficit', () => {
    const logs = simulate({ tdee: 2400, days: 56, intake: () => 2400, startWeight: 175 });
    const r = calculateTdee(logs, profile);
    expect(r.trueTdee).toBeGreaterThan(2250);
    expect(r.trueTdee).toBeLessThan(2550);
  });

  it('weight gain — surplus is recovered with the right sign', () => {
    const logs = simulate({ tdee: 2300, days: 56, intake: () => 2800, startWeight: 160 });
    const r = calculateTdee(logs, profile);
    expect(r.trueTdee).toBeGreaterThan(2150);
    expect(r.trueTdee).toBeLessThan(2450);
    expect(r.weightSlopeLbsPerDay!).toBeGreaterThan(0);
  });

  /**
   * THE REGRESSION. A 21-day unlogged travel block splits the window, and the
   * post-travel run is short. The old code kept only that fragment and threw
   * away the 42 days before it.
   */
  it('travel gap: does not let the short post-gap run set maintenance', () => {
    const TRUE = 2500;
    const logs = simulate({
      tdee: TRUE,
      days: 63,
      startWeight: 172,
      // Eats at maintenance-plus while travelling, and does not log it.
      intake: (d) => (d >= 42 && d < 56 ? 3000 : 2050),
      logged: (d) => !(d >= 42 && d < 56),
    });
    const r = calculateTdee(logs, profile);
    expect(r.source).toBe('measured');
    // The post-gap run is 7 days — under MIN_RUN_SPAN_DAYS, so it is dropped
    // rather than pooled, and maintenance comes from the long clean run alone.
    // That IS the fix: the old code did the exact opposite, keeping only the
    // fragment. `runsUsed: 1` here means "the fragment was excluded", not "the
    // gap was ignored".
    expect(r.runsUsed).toBe(1);
    expect(r.trueTdee).toBeGreaterThan(TRUE - 300);
    expect(r.trueTdee).toBeLessThan(TRUE + 300);
  });

  it('travel gap with a long post-gap run: both runs are pooled', () => {
    const TRUE = 2500;
    // 21 logged + 14-day unlogged travel block + 21 logged = exactly 42 logged
    // days, so both runs survive the window trim and both clear the span gate.
    const logs = simulate({
      tdee: TRUE,
      days: 56,
      startWeight: 176,
      intake: (d) => (d >= 21 && d < 35 ? 3000 : 2050),
      logged: (d) => !(d >= 21 && d < 35),
    });
    const r = calculateTdee(logs, profile);
    expect(r.runsUsed).toBe(2);
    expect(r.trueTdee).toBeGreaterThan(TRUE - 300);
    expect(r.trueTdee).toBeLessThan(TRUE + 300);
  });

  /**
   * The exact shape that produced 2,509: a long clean history, then a break,
   * then a handful of noisy days. The short run must not dominate.
   */
  it('short noisy run after a break cannot outvote the long history', () => {
    const TRUE = 2450;
    const clean = simulate({ tdee: TRUE, days: 40, intake: () => 2000, startWeight: 180 });
    // Nine days, heavy water noise, no real trend.
    const noisy = simulate({
      tdee: TRUE,
      days: 9,
      intake: () => 2000,
      startWeight: 174,
      waterAmplitude: 2.5,
      seed: 99,
    }).map((l) => {
      const d = new Date(l.date);
      d.setDate(d.getDate() + 55);
      return { ...l, date: d };
    });
    const r = calculateTdee([...clean, ...noisy], profile);
    expect(r.trueTdee).toBeGreaterThan(TRUE - 350);
    expect(r.trueTdee).toBeLessThan(TRUE + 350);
  });

  it('reports an interval, and it widens when the data is noisier', () => {
    const tight = calculateTdee(
      simulate({ tdee: 2500, days: 56, intake: () => 2000, startWeight: 185, waterAmplitude: 0.3 }),
      profile,
    );
    const loose = calculateTdee(
      simulate({ tdee: 2500, days: 56, intake: () => 2000, startWeight: 185, waterAmplitude: 3.0 }),
      profile,
    );
    expect(tight.ci95Tdee).toBeGreaterThan(0);
    expect(loose.ci95Tdee!).toBeGreaterThan(tight.ci95Tdee!);
  });

  it('scattered single missed days stay ONE run — they are noise, not a break', () => {
    const logs = simulate({
      tdee: 2500,
      days: 56,
      intake: () => 2000,
      startWeight: 185,
      logged: (d) => d % 7 !== 3,
    });
    const r = calculateTdee(logs, profile);
    expect(r.runsUsed).toBe(1);
    expect(r.trueTdee).toBeGreaterThan(2250);
    expect(r.trueTdee).toBeLessThan(2750);
  });

  it('a single implausible weigh-in does not move maintenance far', () => {
    const clean = simulate({ tdee: 2500, days: 56, intake: () => 2000, startWeight: 185 });
    const spiked = clean.map((l, i) =>
      i === 40 && l.weight != null ? { ...l, weight: l.weight + 12 } : l,
    );
    const a = calculateTdee(clean, profile);
    const b = calculateTdee(spiked, profile);
    expect(Math.abs(a.trueTdee - b.trueTdee)).toBeLessThan(250);
  });
});
