import { describe, expect, it } from 'vitest';
import { dailyTargets } from './targets';
import { calculateTdee } from './tdee';
import { TDEE_SERIES_MAX_DAYS, TDEE_SERIES_PRO_MAX_DAYS, tdeeSeries, weightTrendSeries } from './tdee-series';
import { MIDNIGHT } from './day-boundary';
import type { DateKey } from './date';
import type { DailyLog, Profile } from './types';

const NOW = new Date(2026, 9, 4, 15, 30); // Sat 2026-10-04, mid-afternoon

const PROFILE = {
  heightIn: 70,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1,
  profileCompleted: true,
} as unknown as Profile;

function at(daysAgo: number, hour = 12): Date {
  const d = new Date(NOW);
  d.setHours(hour, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function key(daysAgo: number): string {
  const d = at(daysAgo);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** `n` consecutive logged days ending today, burning `tdee` and eating
 *  `intake`, so the weight falls at (tdee − intake) / 3500 lb a day. */
function history(n: number, intake = 2000, tdee = 2500, startLb = 200) {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  for (let i = n - 1; i >= 0; i--) {
    const day = n - 1 - i;
    logs.push({ date: at(i), calories: intake });
    weights[key(i)] = +(startLb - (day * (tdee - intake)) / 3500).toFixed(2);
  }
  return { logs, weights };
}

describe('tdeeSeries', () => {
  it('ends on exactly the number the hero shows', () => {
    const { logs, weights } = history(60);
    // A partial today, so the in-progress rule is exercised on both sides.
    logs.push({ date: at(0, 9), calories: 450 });
    const series = tdeeSeries(PROFILE, logs, weights, { days: 30, now: NOW });
    const hero = dailyTargets(PROFILE, logs, weights, NOW).tdee;
    const last = series[series.length - 1];
    expect(last.dateKey).toBe(key(0));
    expect(last.source).toBe(hero.source);
    expect(last.kcal).toBe(hero.trueTdee);
  });

  it('replays each earlier day as the estimator saw it that night', () => {
    const { logs, weights } = history(60);
    const series = tdeeSeries(PROFILE, logs, weights, { days: 10, now: NOW });
    expect(series).toHaveLength(10);
    // Five days ago: only rows up to that day, judged at its next midnight.
    const fiveAgo = series[series.length - 6];
    expect(fiveAgo.dateKey).toBe(key(5));
    const cutoff = new Date(at(5));
    cutoff.setHours(24, 0, 0, 0);
    const merged = logs
      .filter((l) => l.date < cutoff)
      .map((l) => ({ ...l, weight: weights[key(Math.round((NOW.getTime() - l.date.getTime()) / 86_400_000))] }));
    const expected = calculateTdee(merged, PROFILE as never, MIDNIGHT, cutoff);
    expect(fiveAgo.kcal).toBe(expected.trueTdee);
  });

  it('flags formula days and never draws the seed', () => {
    // 20 logged days: the first 13 are formula, from day 14 it is measured.
    const { logs, weights } = history(20);
    const series = tdeeSeries(PROFILE, logs, weights, { days: 30, now: NOW });
    const sources = series.map((p) => p.source);
    expect(sources.slice(0, 10).every((s) => s === 'formula')).toBe(true);
    expect(sources[sources.length - 1]).toBe('measured');

    // No profile and too few days: seed — and a seed point carries no value.
    const seed = tdeeSeries(null, logs.slice(-5), weights, { days: 5, now: NOW });
    expect(seed.every((p) => p.source === 'seed' && p.kcal === null)).toBe(true);
  });

  it('a measured point is the estimator result, unchanged (ADR-0024)', () => {
    // A device multiplier on the profile may only reach the formula anchor —
    // a fully confident measured point must not move with it.
    const { logs, weights } = history(60);
    const a = tdeeSeries(PROFILE, logs, weights, { days: 1, now: NOW })[0];
    const withDevice = { ...PROFILE, activityMultiplier: 1.9 } as Profile;
    const b = tdeeSeries(withDevice, logs, weights, { days: 1, now: NOW })[0];
    expect(a.source).toBe('measured');
    expect(b.kcal).toBe(a.kcal);
  });

  it('carries the interval and the holding state off measured results', () => {
    const { logs, weights } = history(60);
    const last = tdeeSeries(PROFILE, logs, weights, { days: 1, now: NOW })[0];
    const hero = calculateTdee(
      logs.map((l) => ({ ...l, weight: weights[key(Math.round((NOW.getTime() - l.date.getTime()) / 86_400_000))] })),
      PROFILE as never,
      MIDNIGHT,
      NOW,
    );
    if (hero.source !== 'measured') throw new Error('fixture should be measured');
    expect(last.ci95).toBe(hero.ci95Tdee ?? null);
    expect(last.holding).toBe(hero.estimateState === 'holding');
  });

  it('is capped at the free chart history', () => {
    const { logs, weights } = history(20);
    expect(tdeeSeries(PROFILE, logs, weights, { days: 400, now: NOW })).toHaveLength(TDEE_SERIES_MAX_DAYS);
    expect(TDEE_SERIES_MAX_DAYS).toBe(90);
    expect(tdeeSeries(PROFILE, logs, weights, { days: 0, now: NOW })).toHaveLength(1);
  });

  it('reaches a year behind the Pro cap, and no further', () => {
    const { logs, weights } = history(20);
    const s = tdeeSeries(PROFILE, logs, weights, { days: 400, now: NOW, maxDays: TDEE_SERIES_PRO_MAX_DAYS });
    expect(s).toHaveLength(365);
    expect(s[s.length - 1].dateKey).toBe(key(0));
    expect(tdeeSeries(PROFILE, logs, weights, { days: 400, now: NOW, maxDays: 9999 })).toHaveLength(365);
  });

  it('chunks (endOffset) concatenate to exactly the one-call series', () => {
    const { logs, weights } = history(60);
    logs.push({ date: at(0, 9), calories: 450 });
    const whole = tdeeSeries(PROFILE, logs, weights, { days: 40, now: NOW });
    const newest = tdeeSeries(PROFILE, logs, weights, { days: 15, now: NOW });
    const older = tdeeSeries(PROFILE, logs, weights, { days: 25, now: NOW, endOffset: 15 });
    expect([...older, ...newest]).toEqual(whole);
    expect(older[older.length - 1].dateKey).toBe(key(15));
  });

  describe('windowRows — the rows the hero saw that day', () => {
    it('is the plain replay while every row fits the window', () => {
      const { logs, weights } = history(60);
      const plain = tdeeSeries(PROFILE, logs, weights, { days: 30, now: NOW });
      const windowed = tdeeSeries(PROFILE, logs, weights, { days: 30, now: NOW, windowRows: 400 });
      expect(windowed).toEqual(plain);
    });

    it('ends on the hero computed from the newest rows only', () => {
      // Three rows a day for 120 days = 360 rows; a 100-row window is ~33 days.
      const logs: DailyLog[] = [];
      const weights: Record<string, number> = {};
      for (let i = 119; i >= 0; i--) {
        for (const h of [8, 12, 19]) logs.push({ date: at(i, h), calories: 700 });
        weights[key(i)] = +(200 - ((119 - i) * 400) / 3500).toFixed(2);
      }
      const s = tdeeSeries(PROFILE, logs, weights, { days: 60, now: NOW, windowRows: 100 });
      const hero = dailyTargets(PROFILE, logs.slice(-100), weights, NOW).tdee;
      expect(s[s.length - 1].kcal).toBe(hero.trueTdee);
      // 50 days ago, the hero had the 100 rows ending that night — not every
      // row since the account began.
      const p = s[s.length - 51];
      const cutoff = new Date(at(50));
      cutoff.setHours(24, 0, 0, 0);
      const seen = logs.filter((l) => l.date < cutoff).slice(-100);
      const merged = seen.map((l) => ({ ...l, weight: weights[key(Math.round((NOW.getTime() - l.date.getTime()) / 86_400_000))] }));
      expect(p.kcal).toBe(calculateTdee(merged, PROFILE as never, MIDNIGHT, cutoff).trueTdee);
    });
  });
});

describe('weightTrendSeries', () => {
  const keys = ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04'] as DateKey[];

  it('keeps gaps as gaps and starts the trend at the first reading', () => {
    const s = weightTrendSeries({ '2026-10-02': 180, '2026-10-04': 182 }, keys);
    expect(s.map((p) => p.scale)).toEqual([null, 180, null, 182]);
    expect(s[0].trend).toBeNull();
    expect(s[1].trend).toBe(180);
    // The reading after a two-day gap counts for 1 − 0.9² = 0.19 of the
    // difference (it carries two days of news).
    expect(s[3].trend).toBeCloseTo(180.38, 6);
  });

  it('draws straight between two weigh-ins instead of a staircase', () => {
    const s = weightTrendSeries({ '2026-10-02': 180, '2026-10-04': 182 }, keys);
    // Halfway in time between the two levels the filter reached.
    expect(s[2].trend).toBeCloseTo((180 + (s[3].trend as number)) / 2, 9);
  });

  it('holds the level after the newest reading', () => {
    const s = weightTrendSeries({ '2026-10-01': 180, '2026-10-02': 181 }, keys);
    expect(s[3].trend).toBe(s[1].trend);
    expect(s[2].trend).toBe(s[1].trend);
  });

  it('is warmed on readings before the window, so it agrees with the full-history trend', () => {
    const weights = { '2026-09-01': 190, '2026-09-10': 186, '2026-09-20': 183, '2026-10-02': 180 };
    const windowed = weightTrendSeries(weights, keys);
    const full = weightTrendSeries(weights, ['2026-09-01', '2026-09-10', '2026-09-20', '2026-10-02'] as DateKey[]);
    expect(windowed[1].trend).toBeCloseTo(full[3].trend as number, 9);
    // Before the first in-window reading, the line comes in from the last
    // pre-window level rather than starting cold.
    expect(windowed[0].trend).not.toBeNull();
    expect(windowed[0].trend as number).toBeGreaterThan(windowed[1].trend as number);
  });

  it('ignores non-positive or non-finite readings', () => {
    const s = weightTrendSeries({ '2026-10-01': 0, '2026-10-02': Number.NaN }, keys);
    expect(s.every((p) => p.scale === null && p.trend === null)).toBe(true);
  });
});
