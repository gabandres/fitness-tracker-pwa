import { describe, expect, it } from 'vitest';
import type { DaySummary } from './day-summary';
import { computeWeeklyInsights } from './weekly-insights';

function day(dateKey: string, totalCalories: number, mealCount = 1): DaySummary {
  return {
    dateKey,
    totalCalories,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    mealCount,
    exercised: false,
    weightLb: null,
  };
}

describe('computeWeeklyInsights', () => {
  it('returns null without a positive target', () => {
    expect(computeWeeklyInsights([day('2026-06-01', 2000)], 0)).toBeNull();
  });

  it('returns null below the logged-day gate', () => {
    expect(computeWeeklyInsights([day('2026-06-01', 2000), day('2026-06-02', 1900)], 2000)).toBeNull();
  });

  it('skips days with no calorie-carrying entries', () => {
    const days = [day('2026-06-01', 2000), day('2026-06-02', 0, 0), day('2026-06-03', 1800), day('2026-06-04', 2200)];
    const r = computeWeeklyInsights(days, 2000)!;
    expect(r.loggedDays).toBe(3);
  });

  it('finds the best (closest) and worst (furthest) day vs target', () => {
    const days = [day('2026-06-01', 2050), day('2026-06-02', 1500), day('2026-06-03', 2000)];
    const r = computeWeeklyInsights(days, 2000)!;
    expect(r.bestDay.dateKey).toBe('2026-06-03'); // exactly on target
    expect(r.worstDay.dateKey).toBe('2026-06-02'); // 500 under
    expect(r.avgCalories).toBe(Math.round((2050 + 1500 + 2000) / 3));
    expect(r.avgDeficit).toBe(2000 - r.avgCalories);
  });
});
