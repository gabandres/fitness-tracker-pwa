import type { DailyLog } from './types';
import { localDateKey } from './date';
import { aggregateByDay } from './tdee';
import { mergeDailyWeights } from './targets';

/**
 * TDEE diagnostics — a NON-production, read-only inspector for the measured-
 * mode TDEE computation. It exists to answer one question raised in the
 * 0.9-lb/wk audit: is a low `trueTdee` (e.g. 2163) genuinely a lower burn, or
 * is it water-retention on the most recent weigh-ins flattening the OLS slope
 * via endpoint leverage over the 28-log window?
 *
 * It reproduces the production measured-mode math (packages/core/src/tdee.ts)
 * exactly for the baseline case — a parity test pins that — then re-runs it
 * under three "what-if" variations so the numbers can be compared side by side:
 *   1. exclude the most recent N weigh-ins (isolates endpoint leverage),
 *   2. an energy-balance estimate that uses NET weight change instead of a
 *      fitted slope (endpoint-anchored, but not least-squares-leveraged),
 *   3. a longer window (e.g. 42 logged days) for the same OLS method.
 *
 * NOTHING here feeds the app's target. It never mutates state and is not wired
 * into calculateTdee. Switching the production method is a separate, deliberate
 * decision — this only surfaces evidence.
 */

const KCAL_PER_POUND = 3500;

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

/** Mean after removing the single lowest and highest value — byte-identical to
 *  the production `trimmedMean` in tdee.ts. */
function trimmedMean(arr: number[]): number {
  if (arr.length < 3) return average(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return average(sorted.slice(1, sorted.length - 1));
}

/** OLS slope through {x,y} points — byte-identical to production. */
function regressionSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const { x, y } of points) {
    sumX += x; sumY += y; sumXX += x * x; sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

export interface WeighIn {
  date: string;   // localDateKey
  weight: number;
}

export type TdeeMethod = 'ols' | 'energy-balance';

export interface WindowTdee {
  method: TdeeMethod;
  /** Nominal window size (logged days) requested. */
  windowDays: number;
  /** How many of the most-recent weigh-ins were dropped before fitting. */
  excludedRecentWeighIns: number;
  /** Logged (aggregated) days actually in the window. */
  loggedDaysInWindow: number;
  /** Calendar date range of the window (first → last logged day). */
  dateRange: { start: string; end: string } | null;
  /** Weigh-ins actually used to estimate the trend (after exclusion). */
  weighInsUsed: WeighIn[];
  /** Weigh-ins that were excluded (the dropped recent tail), for visibility. */
  weighInsExcluded: WeighIn[];
  avgDailyIntake: number;
  /** OLS slope in lb/day (ols method only). */
  slopeLbsPerDay: number | null;
  /** Net weight change lb across the used weigh-ins (energy-balance only). */
  netWeightChangeLb: number | null;
  /** Days over which the net change is amortized (energy-balance only). */
  netChangeSpanDays: number | null;
  /** The daily deficit the body ran, kcal (+ = burning above intake). */
  dailyDeficitAchieved: number;
  trueTdee: number;
  /** True when there weren't enough weigh-ins (<2) to fit a trend. */
  insufficientWeighIns: boolean;
}

export interface WindowOptions {
  windowDays: number;
  method?: TdeeMethod;              // default 'ols'
  excludeRecentWeighIns?: number;   // default 0
}

/**
 * Compute the measured-mode `trueTdee` for one window under one method.
 * `daily` MUST already be aggregated-by-day and weight-merged, ascending.
 */
export function computeWindowTdee(daily: DailyLog[], opts: WindowOptions): WindowTdee {
  const method: TdeeMethod = opts.method ?? 'ols';
  const excludeRecentWeighIns = Math.max(0, opts.excludeRecentWeighIns ?? 0);
  const window = daily.slice(-opts.windowDays);

  const dateRange = window.length
    ? { start: localDateKey(window[0].date), end: localDateKey(window[window.length - 1].date) }
    : null;

  const intakeCals = window.map((l) => l.calories).filter((c) => c > 0);
  const avgDailyIntake = Math.round(trimmedMean(intakeCals));

  const allWeighed = window.filter(
    (l): l is DailyLog & { weight: number } => l.weight != null,
  );
  const cut = excludeRecentWeighIns > 0 ? excludeRecentWeighIns : 0;
  const usedWeighed = cut > 0 ? allWeighed.slice(0, allWeighed.length - cut) : allWeighed;
  const excludedWeighed = cut > 0 ? allWeighed.slice(allWeighed.length - cut) : [];

  const toWeighIn = (l: DailyLog & { weight: number }): WeighIn => ({
    date: localDateKey(l.date),
    weight: l.weight,
  });

  const base: WindowTdee = {
    method,
    windowDays: opts.windowDays,
    excludedRecentWeighIns: cut,
    loggedDaysInWindow: window.length,
    dateRange,
    weighInsUsed: usedWeighed.map(toWeighIn),
    weighInsExcluded: excludedWeighed.map(toWeighIn),
    avgDailyIntake,
    slopeLbsPerDay: null,
    netWeightChangeLb: null,
    netChangeSpanDays: null,
    dailyDeficitAchieved: 0,
    trueTdee: avgDailyIntake,
    insufficientWeighIns: usedWeighed.length < 2,
  };

  if (usedWeighed.length < 2) return base;

  const t0 = usedWeighed[0].date.getTime();
  const dayOffset = (l: DailyLog) => (l.date.getTime() - t0) / 86_400_000;

  if (method === 'ols') {
    const slope = regressionSlope(usedWeighed.map((l) => ({ x: dayOffset(l), y: l.weight })));
    if (slope == null) return base;
    const dailyDeficitAchieved = -slope * KCAL_PER_POUND;
    return {
      ...base,
      slopeLbsPerDay: slope,
      dailyDeficitAchieved: Math.round(dailyDeficitAchieved),
      trueTdee: Math.round(avgDailyIntake + dailyDeficitAchieved),
    };
  }

  // energy-balance: net change across the endpoints, amortized over the span.
  const first = usedWeighed[0];
  const last = usedWeighed[usedWeighed.length - 1];
  const netWeightChangeLb = last.weight - first.weight;
  const spanDays = Math.max(1, dayOffset(last)); // days between first & last weigh-in
  const dailyDeficitAchieved = -(netWeightChangeLb * KCAL_PER_POUND) / spanDays;
  return {
    ...base,
    netWeightChangeLb: Math.round(netWeightChangeLb * 100) / 100,
    netChangeSpanDays: Math.round(spanDays * 100) / 100,
    dailyDeficitAchieved: Math.round(dailyDeficitAchieved),
    trueTdee: Math.round(avgDailyIntake + dailyDeficitAchieved),
  };
}

export interface TdeeDiagnosticReport {
  /** Production baseline: 28-log window, OLS, no exclusions. Matches the
   *  app's measured-mode trueTdee exactly. */
  baseline: WindowTdee;
  /** Same window/method, but the most recent 3 weigh-ins dropped. */
  excludeRecent3: WindowTdee;
  /** Same 28-log window, energy-balance (net change) instead of OLS. */
  energyBalance: WindowTdee;
  /** 42-log window, OLS — does a longer window reduce water sensitivity? */
  window42: WindowTdee;
}

/**
 * Run the full audit comparison against a user's logs + separately-stored
 * daily weights. Pure: no I/O, no state. `logs` are raw DailyLogs (may be
 * multiple per day); weights are the `dailyWeights` map (dateKey → lb).
 */
export function tdeeDiagnostics(
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
  productionWindowDays = 28,
): TdeeDiagnosticReport {
  const daily = aggregateByDay(mergeDailyWeights(logs ?? [], dailyWeights ?? {}));
  return {
    baseline: computeWindowTdee(daily, { windowDays: productionWindowDays, method: 'ols' }),
    excludeRecent3: computeWindowTdee(daily, {
      windowDays: productionWindowDays, method: 'ols', excludeRecentWeighIns: 3,
    }),
    energyBalance: computeWindowTdee(daily, { windowDays: productionWindowDays, method: 'energy-balance' }),
    window42: computeWindowTdee(daily, { windowDays: 42, method: 'ols' }),
  };
}
