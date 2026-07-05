import { describe, expect, it } from 'vitest';
import { calculateTdee } from './tdee';
import { tdeeDiagnostics, computeWindowTdee } from './tdee-diagnostics';
import { aggregateByDay } from './tdee';
import { mergeDailyWeights } from './targets';
import type { DailyLog } from './types';

/** A log `daysAgo` days back at noon (mirrors tdee.test.ts). */
function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return { calories, date: d, weight };
}

/** Build N consecutive daily logs, newest = today, with a linear weight trend. */
function series(n: number, intake: number, startWeight: number, lbPerDay: number): DailyLog[] {
  const logs: DailyLog[] = [];
  for (let i = 0; i < n; i++) {
    const daysAgo = n - 1 - i;               // oldest first
    const weight = startWeight + lbPerDay * i;
    logs.push(log(daysAgo, intake, weight));
  }
  return logs;
}

describe('tdeeDiagnostics', () => {
  it('baseline exactly reproduces production measured-mode trueTdee', () => {
    // 28 days, 2000 kcal, losing 0.1 lb/day.
    const logs = series(28, 2000, 190, -0.1);
    const prod = calculateTdee(logs, null);
    const diag = tdeeDiagnostics(logs, {});
    expect(prod.source).toBe('measured');
    // Parity pin: the audit's whole credibility rests on the baseline matching
    // the number the app actually shows.
    expect(diag.baseline.trueTdee).toBe(prod.trueTdee);
    expect(diag.baseline.avgDailyIntake).toBe(2000);
    expect(diag.baseline.slopeLbsPerDay).toBeCloseTo(-0.1, 5);
  });

  it('merges the separately-stored dailyWeights map like production does', () => {
    // Intake logs carry no weight; weights live in the dailyWeights map.
    const logs: DailyLog[] = [];
    const weights: Record<string, number> = {};
    for (let i = 0; i < 28; i++) {
      const daysAgo = 27 - i;
      const l = log(daysAgo, 2100);
      logs.push(l);
      const key = l.date.toISOString().slice(0, 10);
      weights[key] = 200 - i * 0.05;
    }
    const diag = tdeeDiagnostics(logs, weights);
    expect(diag.baseline.weighInsUsed.length).toBe(28);
    expect(diag.baseline.slopeLbsPerDay).toBeCloseTo(-0.05, 4);
  });

  it('exclude-recent-3 drops exactly the last three weigh-ins', () => {
    const logs = series(28, 2000, 190, -0.1);
    const diag = tdeeDiagnostics(logs, {});
    expect(diag.excludeRecent3.excludedRecentWeighIns).toBe(3);
    expect(diag.excludeRecent3.weighInsExcluded.length).toBe(3);
    expect(diag.excludeRecent3.weighInsUsed.length).toBe(25);
    // On a perfectly linear series, dropping 3 endpoints barely moves the slope.
    expect(diag.excludeRecent3.trueTdee).toBeCloseTo(diag.baseline.trueTdee, -1);
  });

  it('water-retention on the last 3 weigh-ins suppresses OLS trueTdee via endpoint leverage', () => {
    // A clean 0.1 lb/day loss for 25 days, then the last 3 days spike up 2 lb
    // each (glycogen/sodium water). Intake is unchanged, so a "true" estimate
    // should be ~stable — but OLS gives the inflated tail high leverage.
    const clean = series(28, 2000, 190, -0.1);
    const watered = clean.map((l, i) => (i >= 25 ? { ...l, weight: l.weight! + 2 + (i - 25) } : l));

    const diag = tdeeDiagnostics(watered, {});
    // The tail flattens/reverses the slope → measured burn reads LOW.
    // Dropping the watered tail recovers a materially higher trueTdee.
    expect(diag.excludeRecent3.trueTdee).toBeGreaterThan(diag.baseline.trueTdee + 100);
  });

  it('energy-balance uses net change, not the fitted slope', () => {
    const logs = series(28, 2000, 190, -0.1);
    const diag = tdeeDiagnostics(logs, {});
    expect(diag.energyBalance.method).toBe('energy-balance');
    expect(diag.energyBalance.netWeightChangeLb).toBeCloseTo(-2.7, 1); // 27 days * -0.1
    expect(diag.energyBalance.slopeLbsPerDay).toBeNull();
    // On a linear series, OLS slope and net-change/span coincide.
    expect(diag.energyBalance.trueTdee).toBeCloseTo(diag.baseline.trueTdee, -1);
  });

  it('42-window pulls in more days than the 28-window when available', () => {
    const logs = series(50, 2000, 200, -0.08);
    const diag = tdeeDiagnostics(logs, {});
    expect(diag.baseline.loggedDaysInWindow).toBe(28);
    expect(diag.window42.loggedDaysInWindow).toBe(42);
  });

  it('flags insufficient weigh-ins instead of throwing', () => {
    // 28 intake days but only one weigh-in → cannot fit a trend.
    const logs = series(28, 2000, 0, 0).map((l, i) => (i === 0 ? { ...l, weight: 180 } : { ...l, weight: undefined }));
    const daily = aggregateByDay(mergeDailyWeights(logs, {}));
    const r = computeWindowTdee(daily, { windowDays: 28, method: 'ols' });
    expect(r.insufficientWeighIns).toBe(true);
    expect(r.trueTdee).toBe(r.avgDailyIntake);
  });
});
