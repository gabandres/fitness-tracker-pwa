import { describe, expect, it } from 'vitest';
import type { DailyLog } from './types';
import { measurementProgress } from './measurement-progress';
import { calculateTdee, MEASURED_MIN_DAYS, TREND_MIN_WEIGH_INS, type TdeeResult } from './tdee';
import { measuredTdeeFixture } from './tdee.test-utils';

const seed: TdeeResult = { source: 'seed', trueTdee: 2450, newDailyTarget: 1800, weightChangeTrend: 0 };
const formula: TdeeResult = { source: 'formula', trueTdee: 2300, newDailyTarget: 1800, weightChangeTrend: 0 };

/** One log per day for `days` consecutive days ending today; `meals` rows a day. */
function logs(days: number, meals = 1, weight?: (i: number) => number | undefined): DailyLog[] {
  const out: DailyLog[] = [];
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  for (let i = 0; i < days; i++) {
    for (let m = 0; m < meals; m++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      d.setHours(8 + m * 4);
      out.push({ id: `${i}-${m}`, date: d, calories: 600, protein: 30, weight: m === 0 ? weight?.(i) : undefined });
    }
  }
  return out;
}

describe('measurementProgress', () => {
  it('is null the moment measured mode is open — the footer belongs to maintenanceView then', () => {
    expect(measurementProgress(measuredTdeeFixture(), logs(30), {})).toBeNull();
  });

  it('counts distinct DAYS, not rows — three meals on one day is one day', () => {
    const p = measurementProgress(seed, logs(5, 3), {});
    expect(p).toMatchObject({ loggedDays: 5, neededDays: MEASURED_MIN_DAYS, daysToGo: 9 });
    expect(p!.fraction).toBeCloseTo(5 / 14);
  });

  it('reads zero honestly for an account with nothing logged', () => {
    expect(measurementProgress(seed, [], {})).toMatchObject({
      loggedDays: 0,
      daysToGo: MEASURED_MIN_DAYS,
      weighIns: 0,
      weighInsToGo: TREND_MIN_WEIGH_INS,
      fraction: 0,
    });
  });

  it('counts weigh-ins from BOTH sources and caps both counts at what the fit needs', () => {
    // 20 logged days, one weight on a log row and one in dailyWeights on a
    // different day: the fit's floor is met, the day count is pinned at 14.
    const rows = logs(20, 1, (i) => (i === 3 ? 180 : undefined));
    const key = rows[10].date.toISOString().slice(0, 10);
    const p = measurementProgress(formula, rows, { [key]: 179 });
    expect(p).toMatchObject({ loggedDays: 14, daysToGo: 0, weighIns: 2, weighInsToGo: 0, fraction: 1 });
  });

  it('names the weigh-ins as the missing half when the days are all there', () => {
    const p = measurementProgress(formula, logs(16), {});
    expect(p).toMatchObject({ loggedDays: 14, daysToGo: 0, weighIns: 0, weighInsToGo: 2 });
  });

  it('agrees with the estimator about WHEN measured mode opens', () => {
    // The whole point: the readout must hit 14/14 with two weigh-ins on the
    // same data that flips calculateTdee to measured, and not a day before.
    const weightAt = (i: number) => (i === 0 || i === 13 ? 180 - i * 0.05 : undefined);
    const thirteen = logs(13, 2, weightAt);
    const fourteen = logs(14, 2, weightAt);
    expect(calculateTdee(thirteen).source).not.toBe('measured');
    expect(measurementProgress(calculateTdee(thirteen), thirteen, {})).toMatchObject({ loggedDays: 13, daysToGo: 1 });
    const t14 = calculateTdee(fourteen);
    expect(t14.source).toBe('measured');
    expect(measurementProgress(t14, fourteen, {})).toBeNull();
  });
});
