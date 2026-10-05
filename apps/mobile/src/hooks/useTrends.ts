import { useEffect, useMemo, useRef, useState } from 'react';
import {
  type ActivityLevel,
  type DailyLog,
  type DailyTargets,
  type DateKey,
  type MeasurementProgress,
  type Profile,
  type TdeeResult,
  type TdeeSeriesPoint,
  type WeeklyBudget,
  type WeeklyInsights,
  type WeightSeriesPoint,
  LOG_WINDOW_ROWS,
  MIDNIGHT,
  TDEE_SERIES_MAX_DAYS,
  TDEE_SERIES_PRO_MAX_DAYS,
  addDays,
  basalMifflinStJeor,
  calendarDateKey,
  compareLogsOldestFirst,
  dayBoundaryOf,
  dayKeyAt,
  computeWeeklyBudget,
  computeWeeklyInsights,
  dailyTargets,
  measurementProgress,
  parseYmd,
  summarizeDays,
  isoWeek,
  targetStreak,
  tdeeSeries,
  trailingDateKeys,
  weightPointsForDays,
  weightTrendSeries,
} from '@macrolog/core';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';
import { useFocusDay } from '@/hooks/useFocusDay';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import { getLogsForRange, subscribeMilestones } from '@/lib/ledger';
import { type CompositionTrends, useCompositionTrends } from '@/hooks/useCompositionTrends';
import { type SleepTrends, useSleepTrends } from '@/hooks/useSleepTrends';
import { type FastingTrends, useFastingTrends } from '@/hooks/useFastingTrends';
import { type WaterTrends, useWaterTrends } from '@/hooks/useWaterTrends';

const INSIGHT_DAYS = 7;
const SLOPE_WINDOW_DAYS = 28;

/**
 * How far BEFORE a chart's first day the replay needs rows: the estimator's
 * widest window (`WIDENING_WINDOWS` tops out at 84 logged days in `tdee.ts`).
 * A point replayed without them is computed from less history than the hero
 * had that day, and the left of the line drops into a dashed "formula
 * estimate" the app never showed.
 */
const REPLAY_LOOKBACK_DAYS = 84;

/**
 * Ceiling on the one-shot backfill (`getLogsForRange`). A year plus the
 * lookback at seven entries a day is ~3,150 rows; past this the account is
 * pathological, the ascending query would stop short of the cache and leave a
 * hole, so the result is discarded and the chart clips instead.
 */
const BACKFILL_MAX_ROWS = 4000;
const BACKFILL_TIMEOUT_MS = 15_000;

/** Replay chunk: days computed per idle callback. ~30 `calculateTdee` runs is
 *  tens of ms on a mid-range phone — one chunk never holds a frame long. */
const REPLAY_CHUNK_DAYS = 30;

export interface TrendsState {
  /** Composition-adjusted maintenance + recomp signal (ADR-0043). Behind
   *  `FEATURES.compositionMaintenance`; `enabled: false` renders nothing. */
  composition: CompositionTrends;
  loading: boolean;
  error: Error | null;
  /** 7-day calorie insights, or null below the logged-day gate. */
  insights: WeeklyInsights | null;
  /** Days logged in the last 7 (even below the insight gate) — powers the
   *  "N of 7 days" low-data state. */
  loggedThisWeek: number;
  /** The daily protein target (for weekly protein adherence copy). */
  proteinTarget: number;
  /** Adaptive TDEE engine state (maintenance estimate + mode). */
  tdee: TdeeResult;
  targetCalories: number;
  /**
   * The chart window's day keys, oldest → newest — `maxDays` long (the free
   * 90-day cap, or a year behind `isPro`), keyed exactly as `dailyTargets`
   * keys the estimator (`MIDNIGHT`), so the expenditure line's right edge is
   * the hero. Every per-day array below is aligned to it; a range chip slices
   * the tail.
   */
  chartKeys: DateKey[];
  /** Scale readings + trend line per chart day. Gaps stay null. */
  weightSeries: WeightSeriesPoint[];
  /** Calories logged per chart day, null on a day with no food logged. */
  intakeSeries: (number | null)[];
  /** Protein (g) logged per chart day, null on a day with no food logged. */
  proteinSeries: (number | null)[];
  /**
   * Carbs / fat (g) per chart day, null on a day without them. A logged day
   * at ZERO reads as null too: both fields are optional on `DailyLog` (rows
   * before 2026-06 lack them), so a zero is far likelier an entry that never
   * carried the field than a zero-carb day — and a gap claims less than a
   * false zero.
   */
  carbsSeries: (number | null)[];
  fatSeries: (number | null)[];
  /**
   * The user's day in progress, under their day boundary — the key the charts
   * must treat as "today, still going". Not always the last of `chartKeys`:
   * those are calendar days (the estimator's), so between midnight and a
   * later day start the live day is the second-to-last key (re-score 3, B4).
   */
  todayKey: DateKey;
  /**
   * How many trailing days the intake and the replay are COMPLETE for, when
   * that is fewer than the chart asks for — or null when nothing is missing.
   * Set only when the older rows could not be fetched (`reason: 'failed'`);
   * the screen clips the range to it and says so rather than drawing
   * "nothing logged" over days that were logged.
   */
  historyClip: { days: number; reason: 'failed' } | null;
  /** The last-7-days window the insights read (ending YESTERDAY), for the
   *  caption that names it. */
  insightWindow: { from: DateKey; to: DateKey };
  /** Complete days in a row at or under target, ending yesterday
   *  (`targetStreak`). */
  streak: number;
  /** The `refreshKey` whose replay has finished — equal to the one passed in
   *  once a pull-to-refresh has fully settled. */
  settledKey: number;
  /**
   * The maintenance estimate's history — at least the last `rangeDays` days
   * once settled, keyed by day — or null before the first chunk lands.
   * Deferred past the first paint and computed newest-first in chunks on
   * purpose: 90 replays of `calculateTdee` are not render-path work
   * (`tdee-series.ts`), and a year of them is not one-frame work either.
   */
  expenditure: TdeeSeriesPoint[] | null;
  /** Days since the first logged row, capped at the chart window — what the
   *  "All" range means. Counts the backfilled rows too. */
  historyDays: number;
  /** Milestones on record, for ticks on the charts. Empty until answered. */
  milestones: Record<string, Date>;
  /** How far a not-yet-measured account is from its first measured burn
   *  (formula/seed mode), or null once measured. */
  progress: MeasurementProgress | null;
  /** Weekly calorie budget / banking (Mon→Sun), or null below the target
   *  gate. */
  budget: WeeklyBudget | null;
  /** Bare Mifflin BMR off the profile + latest weight — the basal the
   *  activity-level correction compares against. 0 when the profile can't
   *  produce one (no sex/height/age or no weight yet). */
  basalKcal: number;
  /** The stored self-reported bucket, or null if never stated. */
  activityLevel: ActivityLevel | null;
  /**
   * Sleep for the Trends card (ADR-0033). Its own focus-gated, range-bounded
   * listener — `useCoreSnapshot` does not carry sleep and deliberately never
   * will, since three screens would then pay for a listener one screen reads.
   */
  sleep: SleepTrends;
  /** Fasting for the Trends card (ADR-0034, #98). Its own focus-gated,
   *  range-bounded listener for the same reason sleep has one: `fasts` is not
   *  in `useCoreSnapshot` and adding it would make three screens pay for a
   *  listener one screen reads. */
  fasting: FastingTrends;
  /**
   * Water for the Trends card (#115 §3). Its own focus-gated, range-bounded
   * listener for the same reason the other two have one — and this is the
   * clearest case of the rule, because Today **already** subscribes
   * `dailyWater`. ADR-0016 says the second consumer opens its own channel
   * rather than widening `useCoreSnapshot`; the duplication is the model and
   * focus-gating is what bounds it.
   */
  water: WaterTrends;
}


export interface TrendsOptions {
  /** The chart cap: {@link TDEE_SERIES_MAX_DAYS} free, up to
   *  {@link TDEE_SERIES_PRO_MAX_DAYS} behind `isPro`. */
  maxDays?: number;
  /** Bump to re-fetch the older rows and re-run the replay (pull-to-refresh). */
  refreshKey?: number;
}

/**
 * @param rangeDays How many days of expenditure history the screen is showing
 *   (the range chip). Replays are computed up to the LARGEST range asked for
 *   since mount, once per distinct input, so flipping 1M ⇄ 3M slices a series
 *   already computed instead of recomputing it.
 */
export function useTrends(rangeDays: number = 30, opts: TrendsOptions = {}): TrendsState {
  const maxDays = Math.max(1, Math.min(TDEE_SERIES_PRO_MAX_DAYS, opts.maxDays ?? TDEE_SERIES_MAX_DAYS));
  const refreshKey = opts.refreshKey ?? 0;
  // Focus-gated so the Trends tab drops its live listeners when it blurs
  // (battery/network); re-subscribes from cache on refocus. That discipline,
  // the 400-row window and the error policy all live in `useCoreSnapshot`.
  const { logs, weights, profile, loaded, error } = useCoreSnapshot('Trends');
  const loading = !loaded;
  const { user } = useAuth();
  const uid = user?.uid;

  // The intake half of the sleep pairing is the stream above; the sleep half is
  // this hook's own listener.
  const sleep = useSleepTrends(logs, weights, profile);
  // Takes the profile for two things: the day boundary every window on this
  // screen shares, and `fastStartedAt` — which is what lets the stub row tell
  // someone mid-fast that theirs is running rather than that they have none.
  const fasting = useFastingTrends(profile);
  // Profile only for the day boundary every window on this screen shares. Water
  // has no running state and nothing else on the profile to read.
  const water = useWaterTrends(profile);
  // Display-only, flag-gated (ADR-0043): `targets` below never sees it.
  const composition = useCompositionTrends(logs, weights, profile);

  // The user's day start (ADR-0030). EVERY window below is keyed by it, not by
  // midnight: the sleep card was made boundary-aware when it shipped and the
  // rest of this hook was not, so on any non-midnight boundary one screen was
  // keying two cards to two different calendars — the sleep card counting a
  // 01:00 entry as the previous day while the insight and budget cards counted
  // it as the current one. `MIDNIGHT` is the default everywhere, and under it
  // `dayKeyAt` IS the calendar date, so no existing account moves.
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  // "Now" as of the last focus, changing identity only when the DAY changes —
  // the sibling hooks' rule (`useFocusDay`). Every memo below used to call
  // `new Date()` inside a body keyed on logs/weights/boundary, so a Trends tab
  // left mounted overnight kept yesterday's week until something re-logged.
  const focusDay = useFocusDay(boundary);

  // `focusDay` as `now`: `calculateTdee` only reads it for the day key (to keep
  // the day in progress out of the intake mean), so this is the same answer
  // as a fresh clock — and the SAME `now` the expenditure series replays with,
  // which is what makes that line end on this number.
  const targets: DailyTargets = useMemo(
    () => dailyTargets(profile, logs, weights, focusDay),
    [profile, logs, weights, focusDay],
  );

  // The seven COMPLETE days ending yesterday, summarised ONCE — insights and
  // the "N of 7" count read the same rows (this was three `summarizeDays`
  // passes). Today is left out for the reason the maintenance chart leaves its
  // dot out: at lunch (380 kcal) a half-logged day counted as a whole one,
  // dragged the average down, inflated "under maintenance" and was usually
  // named the "Off day".
  const weekKeys = useMemo(
    () => trailingDateKeys(INSIGHT_DAYS + 1, focusDay, boundary).slice(0, -1),
    [focusDay, boundary],
  );
  const week7 = useMemo(() => summarizeDays(weekKeys, logs, weights, boundary), [weekKeys, logs, weights, boundary]);

  const insights = useMemo(() => {
    const points = weightPointsForDays(weights, SLOPE_WINDOW_DAYS, focusDay, boundary);
    // The deficit is measured against the number the hero shows, and only
    // when that number is MEASURED — a formula figure is a population
    // average, and "312 under maintenance" against it claims an observation.
    const maintenance = targets.tdee.source === 'measured' ? targets.tdee.trueTdee : null;
    return computeWeeklyInsights(week7, targets.calorieTarget, points, targets.proteinTarget, maintenance);
  }, [week7, weights, targets, boundary, focusDay]);

  const loggedThisWeek = useMemo(
    () => week7.filter((d) => d.mealCount > 0 && d.totalCalories > 0).length,
    [week7],
  );

  const budget = useMemo<WeeklyBudget | null>(() => {
    // ISO-local week (Monday-start): the seven Mon→Sun date keys and today's
    // 1-based position. Monday is at most 6 days back, so the log window covers
    // the elapsed week.
    const week = isoWeek(focusDay, boundary);
    const days = summarizeDays(week.keys, logs, weights, boundary);
    return computeWeeklyBudget(days, week.daysElapsed, targets.calorieTarget);
  }, [logs, weights, targets, boundary, focusDay]);

  // ── Chart series ──
  // Keyed at MIDNIGHT (the default) because the estimator is: `dailyTargets`
  // calls `calculateTdee` at MIDNIGHT, and a chart whose days disagree with
  // the estimator's days would end one bucket off the hero for anyone on a
  // later day start. Intake is still attributed by the user's boundary, which
  // is what every other number on this screen does.
  const chartKeys = useMemo(() => trailingDateKeys(maxDays, focusDay), [maxDays, focusDay]);
  const weightSeries = useMemo(() => weightTrendSeries(weights, chartKeys), [weights, chartKeys]);

  // ── Older rows than the 400-row cache holds (review S20, bug 1) ──
  // `logs` is a ROW window: a 7-entry-a-day logger's 400 rows cover ~57 days,
  // while the 3M chart spans 90 and its replay needs 84 more before that. The
  // missing days used to read "nothing logged" and the left of the line was
  // replayed from truncated history. The fix is a one-shot, date-bounded
  // `getDocs` for exactly the stretch the cache cannot cover — and ONLY when
  // the cache is full: an account with fewer than 400 rows in total already
  // has its whole history in hand and costs no reads at all.
  //
  // A fetch, not a listener: rows that old almost never change, `getLogsForRange`
  // is the bounded read History already pages with, and a second live listener
  // over hundreds of rows would bill every refocus for nothing. It re-runs when
  // the window it covers no longer meets the cache, on a larger range, and on
  // pull-to-refresh. The hero, the budget and the insights keep reading the
  // cache alone — they are the hero's numbers and the hero sees 400 rows.
  //
  // The largest range asked for since mount, so 3M → 1M → 3M fetches once.
  // (Adjusting state during render is React's documented derived-state form.)
  const [reach, setReach] = useState(rangeDays);
  if (rangeDays > reach) setReach(rangeDays);
  const wantDays = Math.min(maxDays, Math.max(1, reach));
  const needFromKey = useMemo(
    () => calendarDateKey(addDays(parseYmd(chartKeys[chartKeys.length - 1]), -(wantDays - 1) - REPLAY_LOOKBACK_DAYS)),
    [chartKeys, wantDays],
  );
  const cacheFull = logs.length >= LOG_WINDOW_ROWS;
  const oldestCacheKey = logs.length > 0 ? dayKeyAt(logs[0].date, MIDNIGHT) : null;
  const needsBackfill = loaded && cacheFull && oldestCacheKey != null && oldestCacheKey > needFromKey;
  const [backfill, setBackfill] = useState<Backfill | null>(null);
  const backfillFailed =
    backfill != null && backfill.status === 'failed' && backfill.uid === uid && backfill.refreshKey === refreshKey;
  // What is still to be read: nothing, the gap at either end of what is
  // already held, or — first time, another account, a pull-to-refresh — the
  // whole stretch. Re-reading the whole backfill every time the cache's oldest
  // day moved forward (about once a day for a full-cache logger) cost up to
  // ~3,000 reads per Trends focus, and blanked the old dots while it ran
  // (re-score 3, B3).
  const plan = useMemo(
    () =>
      needsBackfill && uid && oldestCacheKey && !backfillFailed
        ? planBackfill(backfill, { uid, refreshKey, fromKey: needFromKey, toKey: oldestCacheKey })
        : null,
    [needsBackfill, uid, oldestCacheKey, backfillFailed, backfill, refreshKey, needFromKey],
  );
  const backfillPending = plan != null;
  useEffect(() => {
    if (!plan) return;
    let cancelled = false;
    // Bounded in time as well as rows: a getDocs that never answers (a socket
    // the SDK still believes is up) would otherwise hold the chart on its
    // placeholder indefinitely. A timeout is a failure — the chart clips and
    // a pull-to-refresh tries again.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('backfill timeout')), BACKFILL_TIMEOUT_MS);
    });
    const fail: Backfill = { uid: plan.uid, fromKey: plan.fromKey, toKey: plan.toKey, refreshKey: plan.refreshKey, status: 'failed', rows: [] };
    Promise.race([
      Promise.all(plan.ranges.map((r) => getLogsForRange(plan.uid, r.fromKey, r.toKey, MIDNIGHT, BACKFILL_MAX_ROWS))),
      timeout,
    ])
      .then((pages) => {
        if (cancelled) return;
        // A full page means the ascending read stopped short of the cache:
        // a hole in the middle is worse than an honest clip.
        if (pages.some((rows) => rows.length >= BACKFILL_MAX_ROWS)) setBackfill(fail);
        else setBackfill(mergeBackfill(plan, pages));
      })
      .catch(() => {
        if (!cancelled) setBackfill(fail);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [plan]);

  // The cache plus the older rows. Only rows strictly OLDER than the cache's
  // oldest row are taken from the backfill — at or after it, the live cache
  // is the authority (a row deleted since the fetch must not come back).
  // The rows already held keep drawing while a gap or a refresh is read, so
  // the old dots do not vanish and "All" does not shrink and snap back.
  const heldRows = backfill != null && backfill.status === 'done' && backfill.uid === uid ? backfill.rows : null;
  const historyLogs = useMemo(
    () => (needsBackfill && heldRows ? withOlderRows(logs, heldRows) : logs),
    [logs, heldRows, needsBackfill],
  );
  // The fallback when the older rows could not be had: clip the chart to the
  // days the cache covers in full (its oldest day may be partial) and say so.
  const historyClip = useMemo<TrendsState['historyClip']>(() => {
    if (!needsBackfill || !backfillFailed || !oldestCacheKey) return null;
    const today = chartKeys[chartKeys.length - 1];
    const days = Math.round((parseYmd(today).getTime() - parseYmd(oldestCacheKey).getTime()) / 86_400_000);
    return { days: Math.max(1, days), reason: 'failed' };
  }, [needsBackfill, backfillFailed, oldestCacheKey, chartKeys]);

  // One pass over the chart window, read twice: intake and protein.
  const chartDays = useMemo(
    () => summarizeDays(chartKeys, historyLogs, weights, boundary),
    [chartKeys, historyLogs, weights, boundary],
  );
  const intakeSeries = useMemo(() => chartDays.map((d) => (d.totalCalories > 0 ? d.totalCalories : null)), [chartDays]);
  const proteinSeries = useMemo(
    () => chartDays.map((d) => (d.totalCalories > 0 ? Math.round(d.totalProtein) : null)),
    [chartDays],
  );
  const carbsSeries = useMemo(
    () => chartDays.map((d) => (d.totalCalories > 0 && d.totalCarbs > 0 ? Math.round(d.totalCarbs) : null)),
    [chartDays],
  );
  const fatSeries = useMemo(
    () => chartDays.map((d) => (d.totalCalories > 0 && d.totalFat > 0 ? Math.round(d.totalFat) : null)),
    [chartDays],
  );
  // The live day by the user's boundary. The chart keys are calendar days, so
  // "drop the last key" dropped an empty calendar day between midnight and a
  // 03:00 day start and counted the day still in progress as complete.
  const todayKey = useMemo(() => dayKeyAt(focusDay, boundary), [focusDay, boundary]);
  // Complete days only — today's lunchtime total is under every target.
  const streak = useMemo(
    () => targetStreak(chartDays.filter((d) => d.dateKey < todayKey), targets.calorieTarget),
    [chartDays, targets, todayKey],
  );
  const historyDays = useMemo(() => {
    let first: string | null = null;
    for (const l of historyLogs) {
      const k = dayKeyAt(l.date, boundary);
      if (first == null || k < first) first = k;
    }
    if (first == null) return 0;
    const span = Math.round((parseYmd(chartKeys[chartKeys.length - 1]).getTime() - parseYmd(first).getTime()) / 86_400_000) + 1;
    return Math.max(1, Math.min(maxDays, span));
  }, [historyLogs, boundary, chartKeys, maxDays]);

  // Deferred and chunked: the series is up to a year of `calculateTdee`
  // replays. Computing it in a memo would put that on the frame that first
  // paints Trends; in idle callbacks, newest month first, the screen is up and
  // scrollable and the line fills in from the right.
  //
  // Computed ONCE per distinct input. A refocus re-delivers every snapshot as
  // new arrays with the same rows, and each used to re-run the whole replay
  // (100–300 ms on a mid-range Android). The signature is what the replay
  // actually reads, so identical data skips; a range change only computes the
  // days not yet computed for it.
  const [expenditure, setExpenditure] = useState<TdeeSeriesPoint[] | null>(null);
  const [settledKey, setSettledKey] = useState(refreshKey);
  const computed = useRef<{ sig: string; days: number }>({ sig: '', days: 0 });
  useEffect(() => {
    if (!loaded || backfillPending) return;
    const sig = replaySignature(profile, historyLogs, weights, focusDay, refreshKey);
    const have = computed.current.sig === sig ? computed.current.days : 0;
    if (have >= wantDays) {
      setSettledKey(refreshKey);
      return;
    }
    let cancelled = false;
    let done = have;
    let cancelNext: () => void = () => {};
    const step = () => {
      if (cancelled) return;
      const n = Math.min(REPLAY_CHUNK_DAYS, wantDays - done);
      const chunk = tdeeSeries(profile, historyLogs, weights, {
        days: n,
        now: focusDay,
        endOffset: done,
        maxDays,
        windowRows: LOG_WINDOW_ROWS,
      });
      // A fresh signature starts from 0, so a stale series stays on screen
      // and is replaced day by day rather than blanking the chart.
      setExpenditure((prev) => mergeSeries(prev, chunk));
      done += n;
      computed.current = { sig, days: done };
      if (done < wantDays) cancelNext = idle(step);
      else setSettledKey(refreshKey);
    };
    cancelNext = idle(step);
    return () => {
      cancelled = true;
      cancelNext();
    };
  }, [loaded, backfillPending, profile, historyLogs, weights, focusDay, wantDays, maxDays, refreshKey]);

  const progress = useMemo(
    () => measurementProgress(targets.tdee, logs, weights, boundary),
    [targets, logs, weights, boundary],
  );

  // Milestones for the chart ticks — the screen's own focus-gated listener
  // (ADR-0016: a second consumer opens its own channel; `useMilestoneRecord`
  // is a mount-long listener built for the archive screen, which is not what a
  // tab may hold). Never gates readiness: a chart without ticks is complete.
  const [milestones, setMilestones] = useState<Record<string, Date>>({});
  useLedgerFeed({
    uid,
    label: 'Trends/milestones',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'milestones',
              settles: 'none',
              // No `fail`: missing ticks are not an error worth a banner.
              open: (deliver) => subscribeMilestones(uid, deliver),
              apply: setMilestones,
            }),
          ]
        : [],
    deps: [uid],
  });

  const basalKcal = useMemo(() => {
    if (!profile || profile.heightIn == null || profile.age == null || profile.sex == null) return 0;
    // Latest weigh-in: dateKeys sort chronologically, so the max key is newest.
    const keys = Object.keys(weights);
    if (keys.length === 0) return 0;
    const latest = weights[keys.reduce((a, b) => (a > b ? a : b))];
    if (!(latest > 0)) return 0;
    return basalMifflinStJeor(
      { heightIn: profile.heightIn, age: profile.age, sex: profile.sex },
      latest,
    );
  }, [profile, weights]);

  return {
    loading,
    error,
    insights,
    loggedThisWeek,
    proteinTarget: targets.proteinTarget,
    tdee: targets.tdee,
    targetCalories: targets.calorieTarget,
    chartKeys,
    weightSeries,
    intakeSeries,
    proteinSeries,
    carbsSeries,
    fatSeries,
    todayKey,
    historyClip,
    insightWindow: { from: weekKeys[0], to: weekKeys[weekKeys.length - 1] },
    streak,
    settledKey,
    expenditure,
    historyDays,
    milestones,
    progress,
    budget,
    basalKcal,
    activityLevel: profile?.activityLevel ?? null,
    sleep,
    fasting,
    water,
    composition,
  };
}

/** The older rows held for the chart: every row whose MIDNIGHT day is in
 *  `[fromKey, toKey]`, read for one account and one refresh generation. */
export interface Backfill {
  uid: string | undefined;
  fromKey: DateKey;
  toKey: DateKey;
  refreshKey: number;
  status: 'done' | 'failed';
  rows: DailyLog[];
}

/** The stretch the chart needs read: the replay's first day to the cache's
 *  oldest (partial) day, inclusive. */
export interface BackfillNeed {
  uid: string;
  refreshKey: number;
  fromKey: DateKey;
  toKey: DateKey;
}

/** What to read for a need: one or two day ranges (inclusive), and the held
 *  backfill they extend — null when it is a fresh read. */
export interface BackfillPlan extends BackfillNeed {
  base: Backfill | null;
  ranges: { fromKey: DateKey; toKey: DateKey }[];
}

function dayBefore(key: DateKey): DateKey {
  return calendarDateKey(addDays(parseYmd(key), -1));
}

/**
 * Null when what is held already covers the need. Otherwise only the missing
 * ends: older days when the range grew, newer days when the cache's oldest day
 * moved forward — that newer read starts AT the old edge day, so a row deleted
 * there since the first read does not survive the merge. A held backfill from
 * another account, another refresh generation or a failed read is not
 * extended; the whole stretch is read again.
 */
export function planBackfill(prev: Backfill | null, need: BackfillNeed): BackfillPlan | null {
  const usable = prev != null && prev.status === 'done' && prev.uid === need.uid && prev.refreshKey === need.refreshKey;
  if (!usable) return { ...need, base: null, ranges: [{ fromKey: need.fromKey, toKey: need.toKey }] };
  const ranges: BackfillPlan['ranges'] = [];
  if (need.fromKey < prev.fromKey) ranges.push({ fromKey: need.fromKey, toKey: dayBefore(prev.fromKey) });
  if (need.toKey > prev.toKey) ranges.push({ fromKey: prev.toKey, toKey: need.toKey });
  return ranges.length > 0 ? { ...need, base: prev, ranges } : null;
}

/** The held rows plus what a plan read, oldest first. Held rows inside a
 *  range that was re-read are replaced by the read, and rows older than the
 *  need are dropped, so the held set does not grow day after day. */
export function mergeBackfill(plan: BackfillPlan, pages: readonly (readonly DailyLog[])[]): Backfill {
  const reread = (l: DailyLog) => {
    const k = dayKeyAt(l.date, MIDNIGHT);
    return k < plan.fromKey || plan.ranges.some((r) => k >= r.fromKey && k <= r.toKey);
  };
  const kept = (plan.base?.rows ?? []).filter((l) => !reread(l));
  const toKey = plan.base && plan.base.toKey > plan.toKey ? plan.base.toKey : plan.toKey;
  return {
    uid: plan.uid,
    fromKey: plan.fromKey,
    toKey,
    refreshKey: plan.refreshKey,
    status: 'done',
    rows: [...kept, ...pages.flat()].sort(compareLogsOldestFirst),
  };
}

/** The cache plus the backfilled rows older than its oldest row, oldest
 *  first. A same-instant row is kept only when the cache does not hold it. */
export function withOlderRows(cache: readonly DailyLog[], older: readonly DailyLog[]): DailyLog[] {
  if (older.length === 0) return cache as DailyLog[];
  if (cache.length === 0) return [...older].sort(compareLogsOldestFirst);
  const edge = cache[0].date.getTime();
  const ids = new Set(cache.map((l) => l.id).filter((id): id is string => id != null));
  const keep = older.filter((r) => {
    const t = r.date.getTime();
    return t < edge || (t === edge && !(r.id != null && ids.has(r.id)));
  });
  return [...keep, ...cache].sort(compareLogsOldestFirst);
}

/** Newer points win by day; the result is oldest first. */
export function mergeSeries(prev: TdeeSeriesPoint[] | null, chunk: readonly TdeeSeriesPoint[]): TdeeSeriesPoint[] {
  const byKey = new Map<string, TdeeSeriesPoint>();
  for (const p of prev ?? []) byKey.set(p.dateKey, p);
  for (const p of chunk) byKey.set(p.dateKey, p);
  return [...byKey.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

/**
 * Everything the replay reads, as one comparable string: the rows' day,
 * calories and weight, the weights map, the profile, the day, and the
 * refresh generation. A few ms for a few thousand rows — against a replay
 * that costs a hundred times that.
 */
export function replaySignature(
  profile: Profile | null,
  logs: readonly DailyLog[],
  weights: Readonly<Record<string, number>>,
  now: Date,
  refreshKey: number,
): string {
  const rows = logs.map((l) => `${l.date.getTime()}:${l.calories}:${l.weight ?? ''}`).join(',');
  const w = Object.keys(weights)
    .sort()
    .map((k) => `${k}=${weights[k]}`)
    .join(',');
  return `${refreshKey}|${calendarDateKey(now)}|${JSON.stringify(profile)}|${w}|${rows}`;
}

/** One idle callback (a timeout where the runtime has none); returns its cancel. */
function idle(run: () => void): () => void {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
  const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
  if (ric && cic) {
    const h = ric(run);
    return () => cic(h);
  }
  const h = setTimeout(run, 0);
  return () => clearTimeout(h);
}
