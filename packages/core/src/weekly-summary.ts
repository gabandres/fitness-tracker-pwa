import type { DailyLog } from './types';
import { aggregateByDay } from './tdee';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { trailingDateKeys } from './log-window';

/**
 * Rolling weekly derivations — averages/adherence (`weeklySummary`), the
 * calorie envelope (`weeklyEnvelope`), and EMA weight smoothing (`ema`). Pure
 * and dependency-free, shared by both frontends (ADR-0012) so the Trends
 * surfaces read identical numbers. Ported out of the Angular
 * `TdeeCalculatorService` — the math is not Angular-specific and belongs in
 * the shared brain (see `@macrolog/core/tdee` for the TDEE core it sits
 * beside).
 */

export interface WeeklySummary {
  days: number;
  avgWeight: number;
  avgCalories: number;
  avgProtein: number | null;
  weightDelta: number;
  adherencePct: number;
}

export interface WeeklyEnvelope {
  weeklyBudget: number;        // dailyTarget * 7
  consumed: number;            // total cals consumed this rolling week
  surplus: number;             // + = over budget, - = under budget
  daysLogged: number;
  daysRemaining: number;
  adjustedDailyTarget: number; // what to aim for each remaining day
  dailyTarget: number;         // the original daily target for comparison
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/**
 * Exponential Moving Average for weight-trend smoothing. Smoothing factor
 * α = 2/(N+1) where N = span (default 7). Returns an array the same length
 * as the input with the EMA at each point.
 */
export function ema(values: number[], span = 7): number[] {
  if (values.length === 0) return [];
  const alpha = 2 / (span + 1);
  const result: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(alpha * values[i] + (1 - alpha) * result[i - 1]);
  }
  return result;
}

/**
 * Weekly summary: averages and totals over the last 7 *days* of logged data
 * (not the last 7 entries). Aggregates first so three meals on a single day
 * count as one day, one calorie total, one protein total.
 */
export function weeklySummary(
  logs: DailyLog[],
  targetCalories: number,
  boundary: DayBoundary = MIDNIGHT,
): WeeklySummary | null {
  if (logs.length === 0) return null;
  const daily = aggregateByDay(logs, boundary);
  const last7 = daily.slice(-7);
  if (last7.length === 0) return null;

  const weights = last7.map((d) => d.weight).filter((w): w is number => w != null);
  const cals = last7.map((d) => d.calories);
  const proteins = last7.filter((d) => d.protein != null).map((d) => d.protein!);

  const avgWeight = weights.length > 0 ? round(average(weights), 1) : 0;
  const avgCalories = Math.round(average(cals));
  const avgProtein = proteins.length > 0 ? Math.round(average(proteins)) : null;
  const weightDelta = weights.length >= 2
    ? round(weights[weights.length - 1] - weights[0], 1)
    : 0;
  // Adherence: % of days within ±100 kcal of target.
  const adherentDays = cals.filter((c) => Math.abs(c - targetCalories) <= 100).length;
  const adherencePct = Math.round((adherentDays / last7.length) * 100);

  return { days: last7.length, avgWeight, avgCalories, avgProtein, weightDelta, adherencePct };
}

/**
 * Weekly Calorie Envelope: rolling 7-day budget showing how much
 * surplus/deficit has accumulated and how much daily adjustment is needed
 * over the remaining days to stay on track. `now` is injectable for
 * deterministic tests (defaults to the current time).
 */
export function weeklyEnvelope(
  logs: DailyLog[],
  dailyTarget: number,
  now: Date = new Date(),
  boundary: DayBoundary = MIDNIGHT,
): WeeklyEnvelope | null {
  if (logs.length === 0 || dailyTarget <= 0) return null;

  // The last 7 of the user's days, including the one in progress — a set of
  // day KEYS, never millisecond arithmetic (ADR-0004: it drifts across DST).
  const week = new Set(trailingDateKeys(7, now, boundary));
  const thisWeekLogs = logs.filter((l) => week.has(dayKeyAt(l.date, boundary)));
  if (thisWeekLogs.length === 0) return null;

  // Aggregate FIRST. `daysLogged` used to be `thisWeekLogs.length`, i.e. the
  // ROW count — three meals a day for three days read as nine days elapsed,
  // the surplus was judged against nine days of target, and `daysRemaining`
  // pinned to 1. That is the rows-vs-days confusion ADR-0004 exists to name.
  const daily = aggregateByDay(thisWeekLogs, boundary);

  const weeklyBudget = dailyTarget * 7;
  const consumed = daily.reduce((s, l) => s + l.calories, 0);
  const daysElapsed = daily.length;
  const surplus = consumed - (dailyTarget * daysElapsed);
  const daysRemaining = Math.max(1, 7 - daysElapsed);
  const budgetRemaining = weeklyBudget - consumed;
  const adjustedDailyTarget = Math.max(
    1200, // hard floor — never suggest less than 1200 for remaining days
    Math.round(budgetRemaining / daysRemaining),
  );

  return {
    weeklyBudget,
    consumed,
    surplus: Math.round(surplus),
    daysLogged: daysElapsed,
    daysRemaining,
    adjustedDailyTarget,
    dailyTarget,
  };
}
