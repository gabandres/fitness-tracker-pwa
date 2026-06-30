/**
 * Linear-fit weight projection. Pure and dependency-free (shares the core
 * date utils only). Ported from the Angular PWA's weekly-insights so the
 * Expo app and the PWA project goal dates from the same regression.
 */
import { addDays, localDateKey, parseYmd } from './date';

export interface WeightPoint {
  dateKey: string;
  weightLb: number;
}

const MIN_SLOPE_POINTS = 3;
const MIN_SLOPE_SPAN_DAYS = 5;
/** Don't promise a goal date further out than this — a 0.05 lb/wk drift
 *  toward a far goal yields a "see you in 8 years" date that reads as a
 *  bug, not a projection. Beyond it, `goalDateKey` is null. */
const MAX_PROJECTION_DAYS = 365;

/**
 * Least-squares fit of weight (lb) over time (days). Returns the slope in
 * lb/day, the fitted weight at the latest point, and that point's date key
 * — or null when the points are too few or too clustered to mean anything
 * (a 2-point "slope" is just the difference of two noisy weigh-ins).
 */
function fitWeight(
  points: readonly WeightPoint[],
): { slopePerDay: number; currentFittedLb: number; lastDateKey: string } | null {
  if (points.length < MIN_SLOPE_POINTS) return null;
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
 * points are too few or too clustered to mean anything.
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
 * Linear-fit weight projection. Returns the trend slope, the fitted current
 * weight, and — when a goal is supplied and the trend actually moves toward
 * it — the date the goal is reached. Null when there aren't enough weigh-ins
 * to fit a line (same gate as the slope).
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
