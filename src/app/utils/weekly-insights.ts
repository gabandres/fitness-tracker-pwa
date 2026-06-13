import type { DaySummary } from './day-summary';
import { addDays, localDateKey, parseYmd } from './date';

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
/** Don't promise a goal date further out than this — a 0.05 lb/wk drift
 *  toward a far goal yields a "see you in 8 years" date that reads as a
 *  bug, not a projection. Beyond it, `goalDateKey` is null. */
const MAX_PROJECTION_DAYS = 365;

/**
 * Least-squares fit of weight (lb) over time (days). Returns the slope
 * in lb/day, the fitted weight at the latest point, and that point's
 * date key — or null when the points are too few or too clustered to
 * mean anything (a 2-point "slope" is just the difference of two noisy
 * weigh-ins). Shared by {@link weightSlopeLbPerWeek} and
 * {@link projectWeight} so the gate lives in one place.
 */
function fitWeight(
  points: readonly WeightPoint[],
): { slopePerDay: number; currentFittedLb: number; lastDateKey: string } | null {
  if (points.length < MIN_SLOPE_POINTS) return null;
  // x in days (epoch/86.4e6); y in lb.
  const xs = points.map((p) => parseYmd(p.dateKey).getTime() / 86_400_000);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  if (maxX - minX < MIN_SLOPE_SPAN_DAYS) return null;
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
  const slopePerDay = num / den;
  const intercept = meanY - slopePerDay * meanX;
  return {
    slopePerDay,
    currentFittedLb: intercept + slopePerDay * maxX,
    lastDateKey: points[xs.indexOf(maxX)].dateKey,
  };
}

/**
 * Least-squares slope of weight over time, in lb/week. Null when the
 * points are too few or too clustered to mean anything (a 2-point
 * "slope" is just the difference of two noisy weigh-ins).
 */
export function weightSlopeLbPerWeek(points: readonly WeightPoint[]): number | null {
  const fit = fitWeight(points);
  return fit ? fit.slopePerDay * 7 : null;
}

export interface WeightProjection {
  /** lb/week, signed (negative = losing). */
  slopeLbPerWeek: number;
  /** Regression-fitted weight at the latest weigh-in — the smoothed
   *  "where you are now" the projection extends from. */
  currentFittedLb: number;
  /** Date key of the latest weigh-in (the projection's origin). */
  lastDateKey: string;
  /** Local date key when weight crosses the goal at this pace, or null:
   *  no goal supplied, the trend diverges from the goal, the goal is
   *  already met, or the crossing is beyond {@link MAX_PROJECTION_DAYS}. */
  goalDateKey: string | null;
}

/**
 * Linear-fit weight projection. Returns the trend slope, the fitted
 * current weight, and — when a goal is supplied and the trend actually
 * moves toward it — the date the goal is reached. Null when there
 * aren't enough weigh-ins to fit a line (same gate as the slope).
 *
 * Direction falls out of the sign arithmetic: losing toward a lower
 * goal gives a positive day-delta; gaining while the goal is below
 * gives a negative delta → no date.
 */
export function projectWeight(
  points: readonly WeightPoint[],
  goalWeightLb?: number | null,
): WeightProjection | null {
  const fit = fitWeight(points);
  if (!fit) return null;

  let goalDateKey: string | null = null;
  if (goalWeightLb != null && fit.slopePerDay !== 0) {
    const deltaDays = (goalWeightLb - fit.currentFittedLb) / fit.slopePerDay;
    if (deltaDays > 0 && deltaDays <= MAX_PROJECTION_DAYS) {
      goalDateKey = localDateKey(addDays(parseYmd(fit.lastDateKey), Math.round(deltaDays)));
    }
  }

  return {
    slopeLbPerWeek: fit.slopePerDay * 7,
    currentFittedLb: fit.currentFittedLb,
    lastDateKey: fit.lastDateKey,
    goalDateKey,
  };
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
