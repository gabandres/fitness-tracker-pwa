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
 * ## Bounded by the tier cap
 *
 * {@link CHART_HISTORY_DAYS_FREE} (90) points for the free tier — the one
 * number that says how much chart history "free" means — and at most
 * {@link TDEE_SERIES_PRO_MAX_DAYS} (a year) behind `isPro`, which v1 forces
 * true. Each replay is the bounded run fits inside `calculateTdee` (n ≤ 84
 * weigh-ins), which is cheap once and not cheap ninety times: tens of
 * milliseconds on a desktop, more on a phone. A caller should compute only the
 * range on screen, in chunks (`endOffset`), and off the first paint (Trends
 * does it in idle callbacks), never in a render-path memo.
 *
 * ## The rows the hero saw that day (`windowRows`)
 *
 * The app's hero is computed from a ROW window (`LOG_WINDOW_ROWS`), not from
 * all history. A caller that hands this function more history than that — to
 * stop the left of a 3M line being replayed from rows the cache had already
 * dropped — passes `windowRows`, and each point is then computed from the
 * newest `windowRows` rows that existed by the end of that day: what the hero
 * would have been handed on that day. With every row inside the window it is
 * the same answer as the plain prefix replay.
 */

/** Longest FREE history this series will replay (the default cap). */
export const TDEE_SERIES_MAX_DAYS = CHART_HISTORY_DAYS_FREE;

/** Longest history at all — the Pro cap (`isPro`; forced true in v1). A year,
 *  the same reach as Body's 1Y chip. */
export const TDEE_SERIES_PRO_MAX_DAYS = 365;

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
  /** Days to replay, newest last. Clamped to [1, `maxDays`]. */
  days: number;
  /** The clock. Today's point uses it verbatim; earlier points end at their
   *  own next midnight, so each of those days counts as finished. */
  now: Date;
  /** The cap `days` is clamped to — {@link TDEE_SERIES_MAX_DAYS} by default,
   *  at most {@link TDEE_SERIES_PRO_MAX_DAYS}. */
  maxDays?: number;
  /**
   * Days before today the series ENDS on (default 0 — today). A chunk of an
   * older stretch: `{ days: 60, endOffset: 30 }` is the 60 days before the
   * newest 30, so a long range can be replayed newest-first across several
   * idle callbacks instead of in one long block. Every point is independent
   * of the others, so chunks concatenate to exactly the one-call answer.
   */
  endOffset?: number;
  /** Replay each day from at most this many of the newest rows by its end —
   *  the hero's row window (see the header). Omit for every row. */
  windowRows?: number;
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
  const cap = Math.max(1, Math.min(TDEE_SERIES_PRO_MAX_DAYS, Math.trunc(opts.maxDays ?? TDEE_SERIES_MAX_DAYS) || 1));
  const days = Math.max(1, Math.min(cap, Math.trunc(opts.days) || 1));
  const endOffset = Math.max(0, Math.trunc(opts.endOffset ?? 0) || 0);
  const windowRows = opts.windowRows != null && opts.windowRows > 0 ? Math.trunc(opts.windowRows) : null;
  const boundary: DayBoundary = MIDNIGHT;
  const rows = logs ?? [];
  const merged = mergeDailyWeights(rows, dailyWeights ?? {}, boundary);
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

  // Row-window mode: the raw rows' day keys, for "the newest N rows by the end
  // of day D". Rows are oldest-first (the ledger seam's contract), so the
  // count of rows on or before D only grows as D walks forward.
  const rowKeys = windowRows != null ? rows.map((l) => dayKeyAt(l.date, boundary)) : null;

  const todayKey = dayKeyAt(opts.now, boundary);
  const anchor = parseYmd(todayKey);
  const out: TdeeSeriesPoint[] = [];
  let end = 0;
  let rowEnd = 0;
  for (let i = endOffset + days - 1; i >= endOffset; i--) {
    const isToday = i === 0;
    const key = calendarDateKey(addDays(anchor, -i));
    let result: TdeeResult;
    if (windowRows != null && rowKeys) {
      if (isToday) {
        // The hero's call over the hero's rows: the newest `windowRows`.
        result = calculateTdee(merged.slice(-windowRows), adjusted, boundary, opts.now);
      } else {
        while (rowEnd < rowKeys.length && rowKeys[rowEnd] <= key) rowEnd++;
        const window = merged.slice(Math.max(0, rowEnd - windowRows), rowEnd);
        result = calculateTdee(window, adjusted, boundary, addDays(parseYmd(key), 1));
      }
    } else if (isToday) {
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
  /** Smoothed trend, lb (`weightTrendStep`); null before the first weigh-in. */
  trend: number | null;
}

/**
 * The trend filter: a damped level-plus-slope smoother (Holt's linear method
 * with a damped trend), stepped once per weigh-in and aware of the gap since
 * the last one. It is a DISPLAY smoother — the estimator fits its own robust
 * slope and never reads this.
 *
 * ## Why not the plain 0.1 EWMA it replaced (S20)
 *
 * The Hacker's Diet average takes 10% of each reading and nothing else, so on
 * a steady loss it LAGS by about (1 − α)/α ≈ 9 weigh-ins. Measured on the QA
 * account: six weeks of losing ~0.18 lb/day drew a "trend" ABOVE every single
 * dot, ending at 180.2 lb over a 177.5 reading — the line a user is told to
 * trust, sitting where they no longer are. And a gap held it frozen, so two
 * weeks off the scale left it two weeks stale.
 *
 * Tracking the slope as well removes the lag on a steady change (the level is
 * predicted forward by the slope before the reading corrects it), while a
 * one-off 2 lb water swing still moves the level only 0.2 lb and the slope
 * 0.02 lb/day. Over a gap the prediction rolls forward on a DAMPED slope
 * (φ per day), and the reading after it counts for more (1 − (1 − α)^days):
 * it carries more news. The slope is capped at a physiological ±0.5 lb/day so
 * a typo cannot fling the line.
 */
export const WEIGHT_TREND_ALPHA = 0.1;
/** How much of each step's observed slope the trend's slope takes. */
export const WEIGHT_TREND_BETA = 0.1;
/** Per-day damping of the slope across a gap — a trend fades, it does not run on. */
export const WEIGHT_TREND_PHI = 0.9;
const MAX_TREND_SLOPE_LB_PER_DAY = 0.5;

/** The filter's state after a reading. `day` is a whole-day index. */
export interface WeightTrendState {
  level: number;
  slope: number;
  day: number;
}

/** Whole days since the epoch for a `YYYY-MM-DD` key — gaps, not instants. */
export function trendDayIndex(dateKey: string): number {
  const [y, m, d] = dateKey.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** One weigh-in through the filter. The first reading starts it, flat. */
export function weightTrendStep(
  prev: WeightTrendState | null,
  day: number,
  reading: number,
  alpha: number = WEIGHT_TREND_ALPHA,
): WeightTrendState {
  if (!prev) return { level: reading, slope: 0, day };
  const dt = Math.max(1, day - prev.day);
  const phi = WEIGHT_TREND_PHI;
  // Damped-trend forecast: the slope's contribution over `dt` days, each day
  // after the first weaker by φ. One day ⇒ exactly the slope.
  const carried = prev.slope * ((1 - phi ** dt) / (1 - phi));
  const predicted = prev.level + carried;
  const gain = 1 - (1 - alpha) ** dt;
  const level = predicted + gain * (reading - predicted);
  // The slope fades only across MISSED days: on a daily cadence it carries
  // whole (damping every step re-introduced most of the lag it exists to fix).
  const decayed = prev.slope * phi ** (dt - 1);
  const observed = (level - prev.level) / dt;
  const raw = decayed + WEIGHT_TREND_BETA * (observed - decayed);
  const slope = Math.max(-MAX_TREND_SLOPE_LB_PER_DAY, Math.min(MAX_TREND_SLOPE_LB_PER_DAY, raw));
  return { level, slope, day };
}

function validReading(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null;
}

/**
 * Scale readings plus a trend line over the given day keys (oldest first).
 *
 * **Warmed on the whole history.** The filter is stepped through every reading
 * BEFORE `keys[0]` first, so the window's trend is the same number Body's
 * `trendWeightSeries` reaches over all readings — a filter started at the
 * first reading inside a 90-day window disagreed with Body's "Trend X" for a
 * sparse weigher. The trend starts AT the first reading ever rather than being
 * seeded from a guess.
 *
 * **Between two weigh-ins the trend is drawn straight from one level to the
 * next.** It used to repeat the last level on every day without a reading, so
 * a weekly weigher saw a staircase: six flat days, then a jump. The filter
 * still only LEARNS at a reading — the interpolated days are the line between
 * two levels it actually reached, not extra observations — and the weigh-in
 * days carry the filter's value exactly. After the newest reading the level is
 * held (nothing later exists to draw towards), and `scale` stays null on every
 * day without a reading so the chart leaves the dot out.
 */
export function weightTrendSeries(
  dailyWeights: Readonly<Record<string, number>>,
  keys: readonly DateKey[],
  alpha = WEIGHT_TREND_ALPHA,
): WeightSeriesPoint[] {
  const out: WeightSeriesPoint[] = keys.map((dateKey) => ({ dateKey, scale: validReading(dailyWeights[dateKey]), trend: null }));
  if (keys.length === 0) return out;
  let state: WeightTrendState | null = null;
  // Warm-up: every reading before the window, in date order.
  const first = keys[0];
  const before = Object.keys(dailyWeights ?? {})
    .filter((k) => k < first && validReading(dailyWeights[k]) != null)
    .sort();
  for (const k of before) state = weightTrendStep(state, trendDayIndex(k), dailyWeights[k], alpha);

  // The last level the filter reached, and on which day — the left end of the
  // segment being drawn towards the next reading.
  let anchor: { day: number; level: number } | null = state ? { day: state.day, level: state.level } : null;
  let pending: number[] = []; // window indexes waiting for the next reading
  out.forEach((p, i) => {
    if (p.scale == null) {
      if (anchor) pending.push(i);
      return;
    }
    const day = trendDayIndex(p.dateKey);
    state = weightTrendStep(state, day, p.scale, alpha);
    if (anchor) {
      const span = day - anchor.day;
      for (const j of pending) {
        const f = span > 0 ? (trendDayIndex(out[j].dateKey) - anchor.day) / span : 1;
        out[j].trend = anchor.level + f * (state.level - anchor.level);
      }
    }
    pending = [];
    p.trend = state.level;
    anchor = { day, level: state.level };
  });
  // After the newest reading: held, as before.
  if (anchor) for (const j of pending) out[j].trend = (anchor as { level: number }).level;
  return out;
}
