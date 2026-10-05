import { describe, expect, it } from 'vitest';
import type { DaySummary } from './day-summary';
import { ON_TARGET_BAND_KCAL, balanceVerdict, computeWeeklyInsights, targetStreak } from './weekly-insights';

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
    expect(r.avgUnderTarget).toBe(2000 - r.avgCalories);
  });

  // The owner's device, 2026-10-04: maintenance 2,017, target 1,850, intake
  // 1,849. The tile read "−1 Avg deficit". The deficit is ~168.
  it('measures the deficit against maintenance, not against the target', () => {
    const days = [day('2026-06-01', 1849), day('2026-06-02', 1849), day('2026-06-03', 1849)];
    const r = computeWeeklyInsights(days, 1850, [], 0, 2017)!;
    expect(r.avgUnderTarget).toBe(1);
    expect(r.avgUnderMaintenance).toBe(168);
    expect(balanceVerdict(r.avgUnderMaintenance!)).toEqual({ kind: 'under', kcal: 168 });
    expect(balanceVerdict(r.avgUnderTarget)).toEqual({ kind: 'on', kcal: 0 });
  });

  it('leaves the maintenance gap null without a measured maintenance', () => {
    const days = [day('2026-06-01', 2000), day('2026-06-02', 2000), day('2026-06-03', 2000)];
    expect(computeWeeklyInsights(days, 2000)!.avgUnderMaintenance).toBeNull();
    expect(computeWeeklyInsights(days, 2000, [], 0, null)!.avgUnderMaintenance).toBeNull();
    expect(computeWeeklyInsights(days, 2000, [], 0, Number.NaN)!.avgUnderMaintenance).toBeNull();
  });

  it('reports a surplus as over maintenance, never as a negative deficit', () => {
    const days = [day('2026-06-01', 2400), day('2026-06-02', 2400), day('2026-06-03', 2400)];
    const r = computeWeeklyInsights(days, 2000, [], 0, 2100)!;
    expect(r.avgUnderMaintenance).toBe(-300);
    expect(balanceVerdict(r.avgUnderMaintenance!)).toEqual({ kind: 'over', kcal: 300 });
  });
});

describe('balanceVerdict', () => {
  it('calls anything inside the band "on"', () => {
    expect(balanceVerdict(ON_TARGET_BAND_KCAL)).toEqual({ kind: 'on', kcal: 0 });
    expect(balanceVerdict(-ON_TARGET_BAND_KCAL)).toEqual({ kind: 'on', kcal: 0 });
    expect(balanceVerdict(ON_TARGET_BAND_KCAL + 1)).toEqual({ kind: 'under', kcal: 26 });
    expect(balanceVerdict(-40)).toEqual({ kind: 'over', kcal: 40 });
  });

  it('degrades a non-finite input to "on" rather than printing NaN', () => {
    expect(balanceVerdict(Number.NaN)).toEqual({ kind: 'on', kcal: 0 });
  });
});

describe('targetStreak', () => {
  it('counts logged days at or under target back from the newest', () => {
    const days = [day('2026-06-01', 2600), day('2026-06-02', 1900), day('2026-06-03', 2000 + ON_TARGET_BAND_KCAL), day('2026-06-04', 1700)];
    expect(targetStreak(days, 2000)).toBe(3);
  });

  it('an unlogged day ends the run — it is not counted either way', () => {
    const days = [day('2026-06-01', 1800), day('2026-06-02', 0, 0), day('2026-06-03', 1800)];
    expect(targetStreak(days, 2000)).toBe(1);
  });

  it('is zero after an over day, and without a target', () => {
    expect(targetStreak([day('2026-06-01', 1800), day('2026-06-02', 2400)], 2000)).toBe(0);
    expect(targetStreak([day('2026-06-01', 1800)], 0)).toBe(0);
  });
});
