import { describe, expect, it } from 'vitest';
import type { DailyLog } from './types';
import { ema, weeklySummary, weeklyEnvelope } from './weekly-summary';

/** N days of logs ending today (local noon), oldest-first. */
function makeLogs(
  entries: { weight?: number; calories: number; protein?: number }[],
): DailyLog[] {
  const start = entries.length - 1;
  return entries.map((e, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (start - i));
    d.setHours(12, 0, 0, 0);
    return { weight: e.weight, calories: e.calories, protein: e.protein, date: d };
  });
}

describe('ema', () => {
  it('returns empty / single-value inputs unchanged', () => {
    expect(ema([])).toEqual([]);
    expect(ema([185])).toEqual([185]);
  });

  it('smooths a declining series within its extremes and trending down', () => {
    const smoothed = ema([185, 184, 183, 182, 181, 180, 179], 7);
    expect(smoothed).toHaveLength(7);
    expect(smoothed[0]).toBe(185);
    for (const v of smoothed) {
      expect(v).toBeGreaterThanOrEqual(179);
      expect(v).toBeLessThanOrEqual(185);
    }
    for (let i = 1; i < smoothed.length; i++) {
      expect(smoothed[i]).toBeLessThan(smoothed[i - 1]);
    }
  });

  it('dampens a spike', () => {
    const raw = [180, 180, 185, 180, 180];
    const smoothed = ema(raw, 3);
    expect(Math.max(...smoothed) - Math.min(...smoothed)).toBeLessThan(
      Math.max(...raw) - Math.min(...raw),
    );
  });
});

describe('weeklySummary', () => {
  it('returns null for empty logs', () => {
    expect(weeklySummary([], 2000)).toBeNull();
  });

  it('computes averages over the last 7 days', () => {
    const r = weeklySummary(
      makeLogs([
        { weight: 180, calories: 1900, protein: 150 },
        { weight: 179.5, calories: 1950, protein: 160 },
        { weight: 179, calories: 2000, protein: 140 },
        { weight: 179.2, calories: 1850, protein: 155 },
        { weight: 178.8, calories: 2100, protein: 145 },
        { weight: 178.5, calories: 1900, protein: 150 },
        { weight: 178, calories: 1800, protein: 160 },
      ]),
      1900,
    )!;
    expect(r.days).toBe(7);
    expect(r.avgWeight).toBeGreaterThan(178);
    expect(r.avgWeight).toBeLessThan(180);
    expect(r.weightDelta).toBeLessThan(0); // 178 - 180
    expect(r.avgProtein).not.toBeNull();
    expect(r.adherencePct).toBeGreaterThanOrEqual(0);
    expect(r.adherencePct).toBeLessThanOrEqual(100);
  });

  it('reports null protein when no day carries protein', () => {
    const r = weeklySummary(makeLogs([{ weight: 180, calories: 2000 }, { weight: 179, calories: 1900 }]), 2000)!;
    expect(r.avgProtein).toBeNull();
  });

  it('slices to the last 7 days when more are supplied', () => {
    const r = weeklySummary(
      makeLogs(Array.from({ length: 14 }, (_, i) => ({ weight: 185 - i * 0.2, calories: 1900 }))),
      1900,
    )!;
    expect(r.days).toBe(7);
    expect(r.avgWeight).toBeLessThanOrEqual(183);
  });
});

describe('weeklyEnvelope', () => {
  const NOW = new Date(2026, 6, 5, 12, 0, 0); // fixed for determinism

  it('returns null with no logs or a non-positive target', () => {
    expect(weeklyEnvelope([], 2000, NOW)).toBeNull();
    expect(weeklyEnvelope(makeLogs([{ calories: 500 }]), 0, NOW)).toBeNull();
  });

  it('accumulates the rolling-week surplus vs the daily target', () => {
    // 3 days this week, 2200 kcal each, target 2000 → surplus +600.
    const logs: DailyLog[] = [0, 1, 2].map((back) => {
      const d = new Date(NOW);
      d.setDate(d.getDate() - back);
      return { calories: 2200, date: d };
    });
    const env = weeklyEnvelope(logs, 2000, NOW)!;
    expect(env.weeklyBudget).toBe(14000);
    expect(env.consumed).toBe(6600);
    expect(env.surplus).toBe(600);
    expect(env.daysLogged).toBe(3);
    expect(env.daysRemaining).toBe(4);
  });

  it('excludes entries older than the 7-day window', () => {
    const old = new Date(NOW);
    old.setDate(old.getDate() - 10);
    const env = weeklyEnvelope([{ calories: 5000, date: old }], 2000, NOW);
    expect(env).toBeNull();
  });
});
