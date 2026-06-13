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
    expect(r.pacePerRemainingDay).toBe(2050); // 8200 / 4
  });

  it('reports a negative pace once the week is overspent', () => {
    // Big Monday blows the budget; 6 days left must each borrow.
    const r = computeWeeklyBudget(week(20_000), 1, TARGET)!;
    expect(r.remaining).toBe(14_000 - 20_000);
    expect(r.pacePerRemainingDay).toBe(-1000); // -6000 / 6
  });

  it('has no pace on the last day of the week', () => {
    const r = computeWeeklyBudget(week(2000, 2000, 2000, 2000, 2000, 2000, 2000), 7, TARGET)!;
    expect(r.daysRemaining).toBe(0);
    expect(r.pacePerRemainingDay).toBeNull();
    expect(r.consumed).toBe(14_000);
    expect(r.remaining).toBe(0);
  });

  it('marks bars elapsed up to and including today, future days not', () => {
    const r = computeWeeklyBudget(week(1800, 1900, 2100), 3, TARGET)!;
    expect(r.bars).toHaveLength(7);
    expect(r.bars.map((b) => b.elapsed)).toEqual([true, true, true, false, false, false, false]);
    expect(r.bars[0]).toEqual({ dateKey: '2026-06-08', calories: 1800, elapsed: true });
    expect(r.bars[3].calories).toBe(0);
  });

  it('clamps daysElapsed into [1,7]', () => {
    expect(computeWeeklyBudget(week(2000), 0, TARGET)!.daysElapsed).toBe(1);
    expect(computeWeeklyBudget(week(2000), 99, TARGET)!.daysElapsed).toBe(7);
  });
});
