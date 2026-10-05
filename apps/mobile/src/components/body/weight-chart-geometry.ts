import { type DatedWeight, addDays, calendarDateKey, parseYmd } from '@macrolog/core';

/**
 * The Body weight chart's geometry — pure, so the one part of a chart a unit
 * test CAN see (RNTL runs no layout and no gesture) is pinned by one.
 *
 * X is TIME, not index. The old sparkline spaced readings evenly, so a week of
 * daily weigh-ins and a month with three looked the same width and a slope
 * across a gap was a lie. On a dated axis a gap is a gap.
 */

export interface ChartFrame {
  width: number;
  height: number;
  padL: number;
  padR: number;
  padT: number;
  padB: number;
}

export interface WeightChartGeometry {
  /** x of every reading, ascending, aligned with `points`. */
  xs: number[];
  /** y of every reading. */
  ys: number[];
  /** y of the trend at every reading — where the scrub dot sits. */
  trendYs: number[];
  /** SVG path for the trend line. */
  trendPath: string;
  /** SVG path for the dashed forecast, or ''. */
  forecastPath: string;
  /** y of the goal line, or null when there is no goal or it is far outside
   *  the readings (a goal 40 lb away would flatten the line to nothing). */
  goalY: number | null;
  /** The y domain actually drawn, in lb. */
  minLb: number;
  maxLb: number;
  /** The middle of that domain and where it sits — the mid gridline and its
   *  label (Body re-score: min and max alone left a 140 pt axis unreadable). */
  midLb: number;
  midY: number;
  /** The day at the horizontal middle of the plot, for the middle x label.
   *  null when the plot spans a single day (there is no middle to name). */
  midDateKey: string | null;
}

const DAY_MS = 86_400_000;

function dayIndex(key: string): number {
  return Math.round(parseYmd(key).getTime() / DAY_MS);
}

/**
 * Lay the series out in `frame`.
 *
 * @param forecastDays days of dashed projection past the last trend point
 *   along `slopeLbPerWeek` (0 for none) — the x domain stretches to hold it.
 * @param goalLb drawn only when within half a span of the readings, so a far
 *   goal never compresses the line it is meant to sit beside.
 */
export function weightChartGeometry(
  points: readonly DatedWeight[],
  trend: readonly DatedWeight[],
  frame: ChartFrame,
  opts: { goalLb?: number | null; slopeLbPerWeek?: number | null; forecastDays?: number } = {},
): WeightChartGeometry | null {
  if (points.length === 0 || frame.width <= 0) return null;
  const forecastDays = opts.slopeLbPerWeek != null ? (opts.forecastDays ?? 0) : 0;
  const lastTrend = trend[trend.length - 1];
  const forecast: DatedWeight[] =
    forecastDays > 0 && lastTrend
      ? [
          lastTrend,
          {
            dateKey: calendarDateKey(addDays(parseYmd(lastTrend.dateKey), forecastDays)),
            weightLb: lastTrend.weightLb + ((opts.slopeLbPerWeek as number) / 7) * forecastDays,
          },
        ]
      : [];

  const values = [...points.map((p) => p.weightLb), ...trend.map((p) => p.weightLb), ...forecast.map((p) => p.weightLb)];
  let minLb = Math.min(...values);
  let maxLb = Math.max(...values);
  const goal = opts.goalLb;
  if (goal != null && Number.isFinite(goal)) {
    const span = Math.max(1, maxLb - minLb);
    if (goal >= minLb - span / 2 && goal <= maxLb + span / 2) {
      minLb = Math.min(minLb, goal);
      maxLb = Math.max(maxLb, goal);
    }
  }
  // A floor on the span: three identical readings must draw a flat line in the
  // middle, not divide by zero, and a 0.2 lb wobble must not fill the height.
  if (maxLb - minLb < 2) {
    const mid = (maxLb + minLb) / 2;
    minLb = mid - 1;
    maxLb = mid + 1;
  }

  const first = dayIndex(points[0].dateKey);
  const lastKey = forecast.length ? forecast[forecast.length - 1].dateKey : points[points.length - 1].dateKey;
  const spanDays = Math.max(0, dayIndex(lastKey) - first);
  const plotW = frame.width - frame.padL - frame.padR;
  const plotH = frame.height - frame.padT - frame.padB;
  const xAt = (key: string): number =>
    spanDays === 0 ? frame.padL + plotW / 2 : frame.padL + ((dayIndex(key) - first) / spanDays) * plotW;
  const yAt = (lb: number): number => frame.padT + (1 - (lb - minLb) / (maxLb - minLb)) * plotH;

  const path = (pts: readonly DatedWeight[]): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(p.dateKey).toFixed(2)} ${yAt(p.weightLb).toFixed(2)}`).join(' ');

  const trendByKey = new Map(trend.map((p) => [p.dateKey, p.weightLb]));
  const midLb = (minLb + maxLb) / 2;
  return {
    xs: points.map((p) => xAt(p.dateKey)),
    ys: points.map((p) => yAt(p.weightLb)),
    trendYs: points.map((p) => yAt(trendByKey.get(p.dateKey) ?? p.weightLb)),
    trendPath: trend.length >= 2 ? path(trend) : '',
    forecastPath: forecast.length === 2 ? path(forecast) : '',
    goalY: goal != null && goal >= minLb && goal <= maxLb ? yAt(goal) : null,
    minLb,
    maxLb,
    midLb,
    midY: yAt(midLb),
    midDateKey: spanDays >= 2 ? calendarDateKey(addDays(parseYmd(points[0].dateKey), Math.round(spanDays / 2))) : null,
  };
}

/**
 * Every reading's dot as ONE path (Body re-score, Pf): two half-circle arcs
 * per point. "All" on a four-year daily weigher was ~1,400 `<Circle>`
 * elements, each its own native view on Fabric; one `<Path>` is one.
 *
 * `minGap` (pt, default 0 = every dot) skips a dot whose centre is closer than
 * that to the last one DRAWN (re-score 3, Pf): past a year of daily readings
 * neighbours overlap almost entirely, so the skipped ones were invisible and
 * the path was twice the string it needed to be. Measured from the last drawn
 * dot, not the last reading, so a run of near-identical days cannot chain
 * into a gap.
 */
export function dotsPath(xs: readonly number[], ys: readonly number[], r: number, minGap = 0): string {
  const parts: string[] = [];
  const d = (2 * r).toFixed(2);
  const rr = r.toFixed(2);
  let lastX = Number.NaN;
  let lastY = Number.NaN;
  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (minGap > 0 && Math.hypot(x - lastX, y - lastY) < minGap) continue;
    lastX = x;
    lastY = y;
    parts.push(`M ${(x - r).toFixed(2)} ${y.toFixed(2)} a ${rr} ${rr} 0 1 0 ${d} 0 a ${rr} ${rr} 0 1 0 -${d} 0`);
  }
  return parts.join(' ');
}

/** Nearest reading to `x`, by binary search over ascending `xs`. A worklet:
 *  the scrub calls it on the UI thread on every finger move. */
export function nearestIndex(xs: readonly number[], x: number): number {
  'worklet';
  const n = xs.length;
  if (n === 0) return -1;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] < x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}
