import { describe, it, expect } from 'vitest';
import { computeWeeklyBudget } from './weekly-budget';
import type { DaySummary } from './day-summary';

function day(dateKey: string, totalCalories: number): DaySummary {
  return {
    dateKey,
    totalCalories,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    mealCount: totalCalories > 0 ? 1 : 0,
    exercised: false,
    weightLb: null,
  };
}

/** Mon→Sun keys for an arbitrary ISO week. */
const WEEK = [
  '2026-06-08', // Mon
  '2026-06-09',
  '2026-06-10',
  '2026-06-11',
  '2026-06-12',
  '2026-06-13',
  '2026-06-14', // Sun
];

function week(...cals: number[]): DaySummary[] {
  return WEEK.map((k, i) => day(k, cals[i] ?? 0));
}

describe('computeWeeklyBudget', () => {
  const TARGET = 2000;

  it('returns null without a positive target', () => {
    expect(computeWeeklyBudget(week(2000, 2000, 2000), 3, 0)).toBeNull();
  });

  it('returns null when the week is not exactly 7 days', () => {
    expect(computeWeeklyBudget(week(2000).slice(0, 6), 3, TARGET)).toBeNull();
  });

  it('sums only the elapsed days and leaves the rest for the bank', () => {
    // Wed (day 3): Mon 1800 + Tue 1900 + Wed 2100 = 5800 consumed.
    const r = computeWeeklyBudget(week(1800, 1900, 2100, 9999, 9999), 3, TARGET)!;
    expect(r.weeklyBudget).toBe(14_000);
    expect(r.consumed).toBe(5800);
    expect(r.remaining).toBe(8200);
    expect(r.daysElapsed).toBe(3);
    expect(r.daysRemaining).toBe(4);
    // Wednesday is still open, and its intake is already in `consumed` — so
    // it is in the divisor too: 8200 over Wed..Sun, not over Thu..Sun.
    expect(r.daysLeftInclToday).toBe(5);
    expect(r.perDayInclToday).toBe(1640); // 8200 / 5
  });

  it('reports a negative pace once the week is overspent', () => {
    // Big Monday blows the budget; 6 days left must each borrow.
    const r = computeWeeklyBudget(week(20_000), 1, TARGET)!;
    expect(r.remaining).toBe(14_000 - 20_000);
    expect(r.perDayInclToday).toBe(-857); // -6000 / 7 (Monday is open too)
  });

  it('on the last day of the week, the per-day figure is what is left today', () => {
    const r = computeWeeklyBudget(week(2000, 2000, 2000, 2000, 2000, 2000, 1500), 7, TARGET)!;
    expect(r.daysRemaining).toBe(0);
    expect(r.daysLeftInclToday).toBe(1);
    expect(r.perDayInclToday).toBe(500);
    expect(r.consumed).toBe(13_500);
    expect(r.remaining).toBe(500);
  });

  // The inflated-room bug: skipping Monday used to bank 2,000 kcal.
  it('counts a past unlogged day at the target, not as zero eaten', () => {
    // Wed (day 3): Mon unlogged, Tue 1900, Wed 600 so far.
    const r = computeWeeklyBudget(week(0, 1900, 600), 3, TARGET)!;
    expect(r.unloggedDays).toBe(1);
    expect(r.consumed).toBe(2500); // what was LOGGED — the "used" line
    expect(r.remaining).toBe(14_000 - 2500 - 2000);
    expect(r.perDayInclToday).toBe(Math.round(9500 / 5));
    expect(r.bars.map((b) => b.assumed)).toEqual([true, false, false, false, false, false, false]);
  });

  it('never treats today as unlogged, however empty', () => {
    const r = computeWeeklyBudget(week(2000, 2000, 0), 3, TARGET)!;
    expect(r.unloggedDays).toBe(0);
    expect(r.bars[2].assumed).toBe(false);
    expect(r.remaining).toBe(10_000);
    expect(r.perDayInclToday).toBe(2000);
  });

  it('marks bars elapsed up to and including today, future days not', () => {
    const r = computeWeeklyBudget(week(1800, 1900, 2100), 3, TARGET)!;
    expect(r.bars).toHaveLength(7);
    expect(r.bars.map((b) => b.elapsed)).toEqual([true, true, true, false, false, false, false]);
    expect(r.bars[0]).toEqual({ dateKey: '2026-06-08', calories: 1800, elapsed: true, assumed: false });
    expect(r.bars[3].calories).toBe(0);
  });

  it('clamps daysElapsed into [1,7]', () => {
    expect(computeWeeklyBudget(week(2000), 0, TARGET)!.daysElapsed).toBe(1);
    expect(computeWeeklyBudget(week(2000), 99, TARGET)!.daysElapsed).toBe(7);
  });
});
