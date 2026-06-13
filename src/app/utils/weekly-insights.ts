import type { DaySummary } from './day-summary';
import { parseYmd } from './date';

/**
 * Rule-based weekly insights — the free, zero-AI sibling of the weekly
 * report. Pure and dependency-free (ADR-0003 sibling, same as
 * `summarizeDay` / `parseMealDraft`): all thresholds, day selection, and
 * regression math live here and nowhere else, so the one interface is
 * the test surface.
 *
 * Input is `DaySummary[]` (via `summarizeDays`) so per-meal aggregation
 * stays in `day-summary.ts`; this module only reasons about whole days.
 */

/** One dated weigh-in for the slope fit. */
export interface WeightPoint {
  dateKey: string;
  weightLb: number;
}

/** A day judged against the calorie target. `delta` = consumed − target
 *  (negative = under target). */
export interface InsightDay {
  dateKey: string;
  calories: number;
  delta: number;
}

export interface WeeklyInsights {
  /** Days in the window with at least one calorie-carrying entry. */
  loggedDays: number;
  avgCalories: number;
  /** Average (target − consumed) across logged days. Positive = average
   *  deficit, negative = average surplus. */
  avgDeficit: number;
  /** Logged day closest to target. */
  bestDay: InsightDay;
  /** Logged day furthest from target. Equal to bestDay when only one
   *  day is logged. */
  worstDay: InsightDay;
  /** Least-squares weight slope in lb/week over the supplied points,
   *  or null when there aren't enough weigh-ins to fit a line
   *  (≥ MIN_SLOPE_POINTS points spanning ≥ MIN_SLOPE_SPAN_DAYS days). */
  weightSlopeLbPerWeek: number | null;
}

/** Minimum calorie-logged days before insights are worth showing —
 *  below this, "best day" is just an echo of one or two entries. */
export const MIN_INSIGHT_DAYS = 3;

const MIN_SLOPE_POINTS = 3;
const MIN_SLOPE_SPAN_DAYS = 5;

/**
 * Least-squares slope of weight over time, in lb/week. Null when the
 * points are too few or too clustered to mean anything (a 2-point
 * "slope" is just the difference of two noisy weigh-ins).
 */
export function weightSlopeLbPerWeek(points: readonly WeightPoint[]): number | null {
  if (points.length < MIN_SLOPE_POINTS) return null;
  // x in days since the first point; y in lb.
  const xs = points.map((p) => parseYmd(p.dateKey).getTime() / 86_400_000);
  const x0 = Math.min(...xs);
  const span = Math.max(...xs) - x0;
  if (span < MIN_SLOPE_SPAN_DAYS) return null;
  const ys = points.map((p) => p.weightLb);
  const n = points.length;
  const meanX = xs.reduce((s, x) => s + x, 0) / n;
  const meanY = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i] - meanX) * (ys[i] - meanY);
    den += (xs[i] - meanX) ** 2;
  }
  if (den === 0) return null;
  return (num / den) * 7;
}

/**
 * Judge a week of `DaySummary` rows against the calorie target.
 * Returns null when there's nothing trustworthy to say: no positive
 * target (profile incomplete) or fewer than {@link MIN_INSIGHT_DAYS}
 * calorie-logged days. Weight slope is computed independently of the
 * day gate — pass a longer window of weigh-ins (14–28 d) than the
 * 7-day summary window.
 */
export function computeWeeklyInsights(
  days: readonly DaySummary[],
  targetCalories: number,
  weightPoints: readonly WeightPoint[] = [],
): WeeklyInsights | null {
  if (targetCalories <= 0) return null;
  const logged = days.filter((d) => d.mealCount > 0 && d.totalCalories > 0);
  if (logged.length < MIN_INSIGHT_DAYS) return null;

  const judged: InsightDay[] = logged.map((d) => ({
    dateKey: d.dateKey,
    calories: d.totalCalories,
    delta: d.totalCalories - targetCalories,
  }));

  let best = judged[0];
  let worst = judged[0];
  for (const day of judged) {
    if (Math.abs(day.delta) < Math.abs(best.delta)) best = day;
    if (Math.abs(day.delta) > Math.abs(worst.delta)) worst = day;
  }

  const totalCalories = judged.reduce((s, d) => s + d.calories, 0);
  const avgCalories = Math.round(totalCalories / judged.length);

  return {
    loggedDays: judged.length,
    avgCalories,
    avgDeficit: targetCalories - avgCalories,
    bestDay: best,
    worstDay: worst,
    weightSlopeLbPerWeek: weightSlopeLbPerWeek(weightPoints),
  };
}
