import { computeWeeklyInsights, weightSlopeLbPerWeek } from './weekly-insights';
import type { DaySummary } from './day-summary';

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
  const TARGET = 2000;

  it('returns null without a positive target or enough logged days', () => {
    const days = [day('2026-06-08', 1800), day('2026-06-09', 1900), day('2026-06-10', 2100)];
    expect(computeWeeklyInsights(days, 0)).toBeNull();
    expect(computeWeeklyInsights(days.slice(0, 2), TARGET)).toBeNull();
    expect(computeWeeklyInsights(days, TARGET)).not.toBeNull();
  });

  it('ignores empty and zero-calorie days (training markers) for the gate and averages', () => {
    const days = [
      day('2026-06-08', 1800),
      day('2026-06-09', 0, 1), // 0-cal exercise marker — not a logged food day
      day('2026-06-10', 2200),
      day('2026-06-11', 0, 0), // nothing logged
      day('2026-06-12', 2000),
    ];
    const r = computeWeeklyInsights(days, TARGET)!;
    expect(r.loggedDays).toBe(3);
    expect(r.avgCalories).toBe(2000); // (1800+2200+2000)/3
    expect(r.avgDeficit).toBe(0);
  });

  it('picks best (closest to target) and worst (furthest) days by |delta|', () => {
    const days = [
      day('2026-06-08', 1950), // -50  ← best
      day('2026-06-09', 2400), // +400 ← worst
      day('2026-06-10', 1800), // -200
    ];
    const r = computeWeeklyInsights(days, TARGET)!;
    expect(r.bestDay).toEqual({ dateKey: '2026-06-08', calories: 1950, delta: -50 });
    expect(r.worstDay).toEqual({ dateKey: '2026-06-09', calories: 2400, delta: 400 });
  });

  it('reports an average surplus as a negative avgDeficit', () => {
    const days = [day('2026-06-08', 2200), day('2026-06-09', 2300), day('2026-06-10', 2400)];
    const r = computeWeeklyInsights(days, TARGET)!;
    expect(r.avgDeficit).toBe(-300);
  });

  it('carries the weight slope from the supplied points', () => {
    const days = [day('2026-06-08', 1800), day('2026-06-09', 1900), day('2026-06-10', 2100)];
    const points = [
      { dateKey: '2026-06-01', weightLb: 180 },
      { dateKey: '2026-06-05', weightLb: 179 },
      { dateKey: '2026-06-08', weightLb: 178 },
    ];
    const r = computeWeeklyInsights(days, TARGET, points)!;
    expect(r.weightSlopeLbPerWeek).toBeCloseTo(-2, 0);
  });
});

describe('weightSlopeLbPerWeek', () => {
  it('fits a least-squares slope in lb/week', () => {
    // Exactly −1 lb over 7 days.
    const points = [
      { dateKey: '2026-06-01', weightLb: 180 },
      { dateKey: '2026-06-04', weightLb: 179.5 },
      { dateKey: '2026-06-08', weightLb: 179 },
    ];
    expect(weightSlopeLbPerWeek(points)).toBeCloseTo(-1, 1);
  });

  it('returns null for too few points or too short a span', () => {
    expect(weightSlopeLbPerWeek([])).toBeNull();
    expect(
      weightSlopeLbPerWeek([
        { dateKey: '2026-06-01', weightLb: 180 },
        { dateKey: '2026-06-08', weightLb: 179 },
      ]),
    ).toBeNull();
    expect(
      weightSlopeLbPerWeek([
        { dateKey: '2026-06-01', weightLb: 180 },
        { dateKey: '2026-06-02', weightLb: 179.8 },
        { dateKey: '2026-06-03', weightLb: 179.6 },
      ]),
    ).toBeNull(); // 3 points but only a 2-day span
  });

  it('is robust to noisy daily fluctuation around a real trend', () => {
    const points = [
      { dateKey: '2026-06-01', weightLb: 180.0 },
      { dateKey: '2026-06-02', weightLb: 181.2 }, // water-weight spike
      { dateKey: '2026-06-04', weightLb: 179.4 },
      { dateKey: '2026-06-06', weightLb: 179.8 },
      { dateKey: '2026-06-08', weightLb: 179.0 },
    ];
    const slope = weightSlopeLbPerWeek(points)!;
    expect(slope).toBeLessThan(0);
    expect(slope).toBeGreaterThan(-2.5);
  });
});
