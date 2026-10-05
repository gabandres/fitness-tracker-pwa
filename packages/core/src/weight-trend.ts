/**
 * Trend weight — the smoothed number a scale reading is noise around.
 *
 * Pure and dependency-free (core date + day-boundary utils only), shared by
 * the Body tab's headline, its long-range chart, the "trend moved" receipt and
 * the trend milestone haptic, so all four agree about where the user is.
 *
 * ## Why a running filter and not the projection's fitted line
 *
 * `projectWeight` already returns `currentFittedLb`, and it is the right
 * number for the thing it is for: a straight line over 28 days, extended to a
 * goal date. It is the wrong number for a headline. A least-squares line moves
 * its END when a reading from three weeks ago is edited, it needs three points
 * across five days before it exists at all, and it has no history — there is
 * no "trend on Sep 3" to plot under a scrub cursor.
 *
 * A running filter has all three properties the headline needs: it exists
 * from the first weigh-in, it only ever looks backwards, and it produces one
 * value per weigh-in that a chart can draw. Since S20 it tracks the slope too
 * (`weightTrendStep` — the plain Hacker's Diet average lagged a steady loss by
 * ~9 weigh-ins and drew its line above every dot).
 *
 * ## The SAME filter Trends draws, not a second one
 *
 * `tdee-series.ts` already smooths weight for the Trends chart
 * (`weightTrendSeries`): one `weightTrendStep` per READING, and a day with no
 * reading holds the trend where it was. This module steps the same filter, so
 * Body's headline and the Trends trend line are one number. Two
 * "trend weights" that disagree by 0.3 lb across two tabs would teach the
 * user that neither means anything.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import type { DatedWeight } from './log-window';
import { LB_PER_KG } from './health-mapping';
import { WEIGHT_TREND_ALPHA, trendDayIndex, weightTrendStep, type WeightTrendState } from './tdee-series';
import type { UnitSystem } from './unit-system';

/** The Trends smoother's own factor (see the header). Re-exported under this
 *  module's name so a caller reading trend code finds it here. */
export const TREND_ALPHA = WEIGHT_TREND_ALPHA;

/** Every weigh-in, OLDEST first. The map is the `dailyWeights` shape; the
 *  date-key ordering is string ordering, same as the doc ids. */
export function sortedWeighIns(weights: Readonly<Record<string, number>>): DatedWeight[] {
  return Object.keys(weights ?? {})
    .filter((k) => typeof weights[k] === 'number' && Number.isFinite(weights[k]))
    .sort()
    .map((dateKey) => ({ dateKey, weightLb: weights[dateKey] }));
}

/**
 * The trend at every weigh-in, oldest first, as `{ dateKey, weightLb }` where
 * `weightLb` is the TREND on that day (not the reading).
 *
 * Input order does not matter — the points are sorted here, because a trend
 * fed out of order is a different number and nothing would say so.
 */
export function trendWeightSeries(points: readonly DatedWeight[], alpha: number = TREND_ALPHA): DatedWeight[] {
  const sorted = [...points]
    .filter((p) => Number.isFinite(p.weightLb))
    .sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
  const out: DatedWeight[] = [];
  let state: WeightTrendState | null = null;
  for (const p of sorted) {
    // The same filter `weightTrendSeries` steps (see `weightTrendStep`).
    state = weightTrendStep(state, trendDayIndex(p.dateKey), p.weightLb, alpha);
    out.push({ dateKey: p.dateKey, weightLb: state.level });
  }
  return out;
}

/** The trend at the latest weigh-in, or null with no weigh-ins at all. */
export function trendWeight(points: readonly DatedWeight[], alpha: number = TREND_ALPHA): number | null {
  const series = trendWeightSeries(points, alpha);
  return series.length ? series[series.length - 1].weightLb : null;
}

/**
 * What a weigh-in would do to the trend: the trend before it and after it.
 *
 * The "Trend −0.2" receipt after a save. Computed from the map the user is
 * looking at plus the one value being written, so the receipt is a statement
 * about THIS write — not about whatever else a listener happened to deliver in
 * the same frame. Writing a past day recomputes from that day forward, which
 * is exactly what correcting a typo three weeks back does to the line.
 */
export function trendShift(
  weights: Readonly<Record<string, number>>,
  dateKey: string,
  weightLb: number,
  alpha: number = TREND_ALPHA,
): { beforeLb: number | null; afterLb: number | null } {
  const beforeLb = trendWeight(sortedWeighIns(weights), alpha);
  const afterLb = trendWeight(sortedWeighIns({ ...weights, [dateKey]: weightLb }), alpha);
  return { beforeLb, afterLb };
}

// ─── Ranges (the long-range chart's chips) ──────────────────────

export type WeightRange = '1M' | '3M' | '6M' | '1Y' | 'All';

/** Calendar days per chip. Months are 30/91/182 so the range is the same
 *  length whatever month it starts in — a chart that is 28 days wide in
 *  February and 31 in March would make the same slope look different. */
export const WEIGHT_RANGE_DAYS: Readonly<Record<Exclude<WeightRange, 'All'>, number>> = {
  '1M': 30,
  '3M': 91,
  '6M': 182,
  '1Y': 365,
};

export const WEIGHT_RANGES: readonly WeightRange[] = ['1M', '3M', '6M', '1Y', 'All'];

/**
 * The points that fall inside a range ending on `todayKey`, oldest first.
 * `All` is every point. The window's first day is `todayKey − (days − 1)`, so
 * `1M` is today plus the 29 days before it — the same inclusive shape as
 * `trailingDateKeys`.
 */
export function pointsInRange(
  points: readonly DatedWeight[],
  range: WeightRange,
  todayKey: string,
): DatedWeight[] {
  const sorted = [...points].sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  if (range === 'All') return sorted;
  const from = calendarDateKey(addDays(parseYmd(todayKey), -(WEIGHT_RANGE_DAYS[range] - 1)));
  return sorted.filter((p) => p.dateKey >= from && p.dateKey <= todayKey);
}

// ─── Per-row facts ──────────────────────────────────────────────

/**
 * The weigh-in immediately BEFORE `dateKey`, or null when there is none.
 *
 * What the outlier check compares against (U7): a weigh-in is judged against
 * the reading that preceded it, not against today's — correcting a row from
 * three weeks ago against this morning's weight would flag every real change
 * in between as a typo.
 */
export function previousWeighIn(
  weights: Readonly<Record<string, number>>,
  dateKey: string,
): DatedWeight | null {
  let best: string | null = null;
  for (const k of Object.keys(weights ?? {})) {
    if (k < dateKey && (best == null || k > best)) best = k;
  }
  return best != null ? { dateKey: best, weightLb: weights[best] } : null;
}

/**
 * Change from the previous weigh-in for each row, NEWEST first — the history
 * list's "−0.4" column. The oldest row has no previous reading and gets null,
 * which renders as nothing rather than as a zero that claims no change.
 */
export function weighInDeltas(
  weights: Readonly<Record<string, number>>,
): { dateKey: string; weightLb: number; deltaLb: number | null }[] {
  const asc = sortedWeighIns(weights);
  const out = asc.map((p, i) => ({
    dateKey: p.dateKey,
    weightLb: p.weightLb,
    deltaLb: i === 0 ? null : p.weightLb - asc[i - 1].weightLb,
  }));
  return out.reverse();
}

/**
 * How many of the last `days` days carry a weigh-in — "12 of the last 14
 * days". Boundary-aware like every other window (ADR-0030), so it counts the
 * same days the chart and the intake cards do.
 *
 * Deliberately a COUNT, not a streak: a streak resets to zero on one missed
 * morning and punishes exactly the person a trend line was built to forgive.
 */
export function weighInConsistency(
  weights: Readonly<Record<string, number>>,
  days: number,
  now: Date,
  boundary: DayBoundary = MIDNIGHT,
): { logged: number; days: number } {
  const today = parseYmd(dayKeyAt(now, boundary));
  let logged = 0;
  for (let i = 0; i < days; i++) {
    if (typeof weights[calendarDateKey(addDays(today, -i))] === 'number') logged++;
  }
  return { logged, days };
}

// ─── Trend milestones ───────────────────────────────────────────

/** One milestone step, in POUNDS: 5 lb, or 2 kg for a metric user. A metric
 *  user celebrating at 2.27 kg would be celebrating a number they never see. */
export function trendStepLb(unitSystem: UnitSystem | undefined): number {
  return unitSystem === 'metric' ? 2 * LB_PER_KG : 5;
}

/**
 * Did this trend move cross a new milestone step away from `startLb`?
 *
 * Returns the step count reached (1 = the first 5 lb, 2 = 10 lb, …) when
 * `nextLb` sits in a further step than `prevLb` did, in the direction the user
 * is going; null otherwise. The celebration fires on CROSSING only, so a trend
 * that wobbles across a line and back does not fire twice for the same line —
 * once it has fired for step 2, only step 3 fires again.
 *
 * `direction` is the goal's: `lose` counts only downward steps, `gain` only
 * upward ones. Null (no goal set) counts both, by magnitude — five pounds is
 * five pounds whichever way the person meant to go.
 */
export function trendMilestoneCrossed(
  startLb: number,
  prevLb: number,
  nextLb: number,
  stepLb: number,
  direction: 'lose' | 'gain' | null = null,
): number | null {
  if (![startLb, prevLb, nextLb, stepLb].every(Number.isFinite) || stepLb <= 0) return null;
  const moved = (v: number): number => {
    const d = direction === 'lose' ? startLb - v : direction === 'gain' ? v - startLb : Math.abs(v - startLb);
    return Math.max(0, d);
  };
  // A hair of tolerance so 5.0000001 lb of float drift is not "not yet 5".
  const stepOf = (v: number): number => Math.floor(moved(v) / stepLb + 1e-9);
  const before = stepOf(prevLb);
  const after = stepOf(nextLb);
  return after > before && after >= 1 ? after : null;
}
