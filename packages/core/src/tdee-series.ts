import { addDays, calendarDateKey, parseYmd, type DateKey } from './date';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { mergeDailyWeights, toProfileFields } from './targets';
import { aggregateByDay, calculateTdee, type TdeeResult } from './tdee';
import { CHART_HISTORY_DAYS_FREE } from './tier-limits';
import type { DailyLog, Profile } from './types';

/**
 * The maintenance estimate's HISTORY — what `calculateTdee` would have said at
 * the end of each of the last N days — for the Trends expenditure line.
 *
 * ## No new estimator, on purpose
 *
 * Every point is a replay of `calculateTdee` over the rows that existed by the
 * end of that day: same windowing, same outlier guard, same confidence ramp,
 * same widening. That is what makes the line trustworthy as a picture of the
 * hero number rather than a second opinion about it. A smoothed or re-fitted
 * series would draw a curve the app never actually showed the user, and the
 * first question anyone asks of an expenditure chart is "is this what it told
 * me on Tuesday?". The answer here is yes by construction.
 *
 * The LAST point is computed from exactly the inputs `dailyTargets` hands
 * `calculateTdee` — every row, the same profile fields, `MIDNIGHT`, the same
 * `now` — so it IS the hero figure. `tdee-series.test.ts` pins that equality;
 * a chart whose right edge disagrees with the big number above it is a bug a
 * user sees in a second.
 *
 * ## Measured versus formula versus seed (ADR-0024)
 *
 * Each point carries the `source` of the result it came from, and the chart
 * draws them differently. Three rules:
 *
 *   - `seed` points carry `kcal: null`. The 2,450 stand-in is built from
 *     nobody's data and `SeedTdee`'s own comment says never to present it as
 *     the user's number — a line through it would do exactly that.
 *   - `formula` points carry a value but are flagged, so the chart can draw
 *     them as a dashed prior rather than as a measurement.
 *   - `measured` points are `trueTdee`, unchanged. This series adds nothing to
 *     it: in particular the device's activity multiplier reaches a measured
 *     point ONLY through the formula anchor `calculateTdee` already blends in
 *     below full confidence, never as an additive term. ADR-0024 decision 4 is
 *     upheld because nothing here touches the arithmetic it governs.
 *
 * ## Bounded by the free cap
 *
 * At most {@link CHART_HISTORY_DAYS_FREE} (90) points — the one number that
 * says how much chart history "free" means. Each replay is the bounded run
 * fits inside `calculateTdee` (n ≤ 84 weigh-ins), which is cheap once and not
 * cheap ninety times: tens of milliseconds on a desktop, more on a phone. A
 * caller should compute only the range on screen and do it off the first
 * paint (Trends does it after interactions), not in a render-path memo.
 */

/** Longest history this series will replay. */
export const TDEE_SERIES_MAX_DAYS = CHART_HISTORY_DAYS_FREE;

export interface TdeeSeriesPoint {
  dateKey: DateKey;
  /** `trueTdee` as of the end of this day, or null on a seed day. */
  kcal: number | null;
  source: TdeeResult['source'];
  /** Half-width of the 95% interval, when the measured run produced one. */
  ci95: number | null;
  /** The estimate's interval was too wide to present as news that day. */
  holding: boolean;
}

export interface TdeeSeriesOptions {
  /** Days to replay, newest last. Clamped to [1, {@link TDEE_SERIES_MAX_DAYS}]. */
  days: number;
  /** The clock. The last point uses it verbatim; earlier points end at their
   *  own next midnight, so each of those days counts as finished. */
  now: Date;
}

/**
 * Replay the maintenance estimate across the last `days` calendar days.
 *
 * Takes the same three inputs as `dailyTargets` — the raw `Profile`, the logs
 * and the daily-weights map — and applies the same preparation (weights
 * merged at `MIDNIGHT`, `toProfileFields`), so the two cannot drift. Pure: no
 * clock read, no I/O.
 */
export function tdeeSeries(
  profile: Profile | null,
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
  opts: TdeeSeriesOptions,
): TdeeSeriesPoint[] {
  const days = Math.max(1, Math.min(TDEE_SERIES_MAX_DAYS, Math.trunc(opts.days) || 1));
  const boundary: DayBoundary = MIDNIGHT;
  const merged = mergeDailyWeights(logs ?? [], dailyWeights ?? {}, boundary);
  // `dailyTargets` zeroes the pace for legacy `travelMode` accounts. Pace never
  // moves `trueTdee`, but mirroring the call keeps "same inputs" literally true.
  const fields = toProfileFields(profile);
  const adjusted = fields?.travelMode ? { ...fields, targetPaceLbsPerWeek: 0 } : fields;

  // Bucket once, then grow a prefix as the replay walks forward in time.
  // `calculateTdee` buckets its input again, and bucketing is idempotent — a
  // day row re-buckets to itself — so handing it day rows is the same answer
  // without re-bucketing 400 meal rows ninety times. The bucketing was never
  // the expensive part, though: measured 2026-10-04 on Node, 90 replays over
  // 400 rows of deliberately NOISY weigh-ins take ~80–100 ms, nearly all of it
  // the run fits (noise widens the interval, which sends every replay through
  // the 63- and 84-day widening attempts). Hence the caller defers it.
  const keyed = aggregateByDay(merged, boundary).map((log) => ({ log, key: dayKeyAt(log.date, boundary) }));

  const todayKey = dayKeyAt(opts.now, boundary);
  const anchor = parseYmd(todayKey);
  const out: TdeeSeriesPoint[] = [];
  let end = 0;
  for (let i = days - 1; i >= 0; i--) {
    const isToday = i === 0;
    const key = calendarDateKey(addDays(anchor, -i));
    let result: TdeeResult;
    if (isToday) {
      // EXACTLY the hero's call: every row (a future-dated row included —
      // `calculateTdee` keeps its weigh-in and zeroes its intake), real `now`.
      result = calculateTdee(merged, adjusted, boundary, opts.now);
    } else {
      while (end < keyed.length && keyed[end].key <= key) end++;
      const prefix = keyed.slice(0, end).map((k) => k.log);
      // The next midnight: this day is over, so its intake counts in full.
      result = calculateTdee(prefix, adjusted, boundary, addDays(parseYmd(key), 1));
    }
    out.push(toPoint(key, result));
  }
  return out;
}

function toPoint(dateKey: DateKey, r: TdeeResult): TdeeSeriesPoint {
  if (r.source === 'seed') return { dateKey, kcal: null, source: 'seed', ci95: null, holding: false };
  if (r.source === 'formula') return { dateKey, kcal: r.trueTdee, source: 'formula', ci95: null, holding: false };
  return {
    dateKey,
    kcal: r.trueTdee,
    source: 'measured',
    ci95: r.ci95Tdee ?? null,
    holding: r.estimateState === 'holding',
  };
}

// ─── Weight: scale readings and the trend through them ─────────────────────

export interface WeightSeriesPoint {
  dateKey: DateKey;
  /** The day's weigh-in, lb, or null — a GAP, never a zero and never filled. */
  scale: number | null;
  /** Exponentially smoothed trend, lb; null before the first weigh-in. */
  trend: number | null;
}

/**
 * How much of each new weigh-in the trend takes. 0.1 is the Hacker's Diet
 * figure and the one the category's "trend weight" lines use: a 2 lb overnight
 * water swing moves the trend 0.2 lb, while a real week-long change is mostly
 * absorbed within ~10 weigh-ins. It is a DISPLAY smoother — the estimator fits
 * its own robust slope and never reads this.
 */
export const WEIGHT_TREND_ALPHA = 0.1;

/**
 * Scale readings plus a trend line over the given day keys (oldest first).
 *
 * A day without a weigh-in keeps the trend where it was rather than pulling it
 * toward anything — there is no observation to learn from — and keeps `scale`
 * null so the chart can leave a gap at the right x position. The trend starts
 * AT the first reading rather than being seeded from a guess.
 */
export function weightTrendSeries(
  dailyWeights: Readonly<Record<string, number>>,
  keys: readonly DateKey[],
  alpha = WEIGHT_TREND_ALPHA,
): WeightSeriesPoint[] {
  let trend: number | null = null;
  return keys.map((dateKey) => {
    const v = dailyWeights[dateKey];
    const scale = typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
    if (scale != null) trend = trend == null ? scale : trend + alpha * (scale - trend);
    return { dateKey, scale, trend };
  });
}
