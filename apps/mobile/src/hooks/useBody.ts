import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCachedState } from '@/hooks/useCachedState';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { exportDaily, exportManualWeight, forgetHealthWeight } from '@/lib/health-sync';
import { track } from '@/lib/analytics';
import {
  type BodyFatInput,
  type BodyFatShown,
  type DailyLog,
  type DatedWeight,
  type Measurement,
  type GoalProgress,
  type Profile,
  type WeightProjection,
  LOG_WINDOW_ROWS,
  addDays,
  bodyFatToShow,
  calendarDateKey,
  computeGoalProgress,
  currentWeight as coreCurrentWeight,
  dayBoundaryOf,
  dayKeyAt,
  latestNavyBodyFat,
  missingBodyFatInputs,
  goalProgressAt,
  goalTrendCrossed,
  newLedgerId,
  parseYmd,
  projectWeight,
  sortedWeighIns,
  trailingAverageLb,
  trendShift,
  trendWeightSeries,
  weighInConsistency,
  weighInDeltas,
  weightPointsForDays,
  weightSeriesForDays,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  getAllDailyWeights,
  getEarliestDailyWeight,
  subscribeDailyWeightsSince,
  subscribeMeasurements,
  subscribeProfile,
  subscribeRecentLogs,
} from '@/lib/ledger';
import {
  type BodyWriteOutcome,
  type PendingBodyOverlay,
  commitBodyOp,
  flushPendingBody,
  onPendingBodyChanged,
  readPendingBody,
} from '@/lib/pending-body';

/** Sparkline length — a chart-width choice, not a domain window. */
const SPARK_DAYS = 14;

/**
 * How far back the weights listener reads, in DAYS (Body review, Pf1).
 *
 * Numerically `LOG_WINDOW_ROWS` and the Health import's `IMPORT_DAYS`, and
 * deliberately neither: those count rows and import depth, this counts the
 * calendar days a Body chart can show. 400 covers the longest range chip (1Y)
 * with room for the 28-day projection window at its far edge. The earliest-ever
 * weigh-in, which goal progress measures from, is one extra document read
 * (`getEarliestDailyWeight`); "All" fetches the rest once, on demand.
 */
const WEIGHT_WINDOW_DAYS = 400;

/**
 * Measurement rows the listener holds (bug 7). It was 20, so a weekly measurer
 * lost their first rows from Body after five months with no "show all" able to
 * reach them. 500 is ten years of weekly tapes — a bound on a runaway, not a
 * cap anyone meets. The list renders virtualized (`MeasurementHistorySheet`).
 */
const MEASUREMENT_ROWS = 500;

/** "12 of the last 14 days" (D1). */
const CONSISTENCY_DAYS = 14;

/** The hero's "7-day avg" chip (Body re-score). */
const AVERAGE_DAYS = 7;

export interface WeighIn {
  dateKey: string;
  weight: number;
  /** Change from the previous (older) weigh-in; null on the oldest row. */
  deltaLb?: number | null;
}

/** What a weigh-in save hands back: `landed` for the receipt, `trend` for the
 *  "Trend −0.2" line (D3) — computed from the map the user was looking at. */
export interface WeighInReceipt {
  landed: Promise<BodyWriteOutcome>;
  trend: { beforeLb: number | null; afterLb: number | null };
}

/** A delete: `landed` as above, `fromHealth` resolves true when Ignia's own
 *  Health sample went with it — what the receipt says "also from Apple
 *  Health" on (C4). */
export interface DeleteReceipt {
  landed: Promise<BodyWriteOutcome>;
  fromHealth: Promise<boolean>;
}

export interface BodyState {
  loading: boolean;
  error: Error | null;
  /** Most recent weight (daily weights first, then log weights). */
  currentWeight: number | null;
  /** The day `currentWeight` was recorded, when it came from a weigh-in. */
  currentWeightDateKey: string | null;
  /** Today's logged weight, or null if not weighed in today. */
  todayWeight: number | null;
  /** Today's key under the account's day boundary. */
  todayKey: string;
  /** EWMA trend at the latest weigh-in (U3) — the same smoother the Trends
   *  chart draws (`weight-trend.ts`). */
  trendWeight: number | null;
  /** All loaded weigh-ins, newest first, each with its change from the last. */
  weighIns: WeighIn[];
  /** The raw `dateKey → lb` map, overlay applied — for the sheet's outlier
   *  check and trend preview, which need neighbours rather than a list. */
  weights: Record<string, number>;
  /** Every loaded reading, oldest first — the long-range chart's scale dots. */
  weightPoints: DatedWeight[];
  /** The trend at every reading, oldest first — the chart's line. */
  trendPoints: DatedWeight[];
  /** Weighed days in the last 14 (D1). */
  consistency: { logged: number; days: number };
  /** Mean of the last 7 days' weigh-ins, or null under two readings. */
  weekAverage: { avgLb: number; count: number } | null;
  /** The weight everything "since you started" is measured from: the
   *  earliest-ever weigh-in (the same start goal progress uses), else the
   *  oldest loaded one. Stable — it does not slide with the 400-day window or
   *  jump when "All" loads (Body re-score, bug 4). */
  startLb: number | null;
  /** True when there is weigh-in history older than the listener's window
   *  that `loadAllHistory` has not fetched yet. */
  hasOlderHistory: boolean;
  /** Fetch every weigh-in once, for the chart's "All" range. */
  loadAllHistory: () => void;
  /** `health: false` writes the weigh-in without mirroring it to Health —
   *  the Undo of a delete whose value came FROM Health (see `setWeight`). */
  setWeight: (weight: number, dateKey?: string, opts?: { health?: boolean }) => Promise<WeighInReceipt>;
  /** Delete a day's weigh-in, durably, and tell Health (bug 1). */
  deleteWeighIn: (dateKey: string) => Promise<DeleteReceipt>;
  /** Measurement rows, newest first. */
  measurements: Measurement[];
  /** Navy body-fat % from the latest measurement + profile, or null when
   *  inputs are missing (no sex/height, or no waist/neck — hip for female). */
  bodyFat: number | null;
  /** Why body-fat can't be shown, for an inline hint. null when shown. */
  bodyFatGap: 'profile' | 'measurement' | null;
  /** Exactly which tape inputs are still missing, so the nudge can name them.
   *  Empty when the estimate is available or the gap is the profile. */
  bodyFatMissing: BodyFatInput[];
  /** What the body-fat card shows: a measured %BF (ADR-0043) when it is at
   *  least as recent as the newest tape, else the Navy estimate. `bodyFat`
   *  above stays the Navy number — it is what is mirrored to Health. */
  bodyFatShown: BodyFatShown | null;
  addMeasurement: (entry: Omit<Measurement, 'id' | 'date'>, date?: Date) => Promise<{ landed: Promise<BodyWriteOutcome> }>;
  /** Edits a saved row in place, keeping its original date unless `date` is
   *  passed. Clearing a field removes it, so a value typed into the wrong box
   *  can be undone. */
  updateMeasurement: (
    id: string,
    entry: Omit<Measurement, 'id' | 'date'>,
    date?: Date,
  ) => Promise<{ landed: Promise<BodyWriteOutcome> }>;
  deleteMeasurement: (id: string) => Promise<{ landed: Promise<BodyWriteOutcome> }>;
  /** The Undo of a measurement delete: the same row back, at its own id and
   *  its own date. */
  restoreMeasurement: (m: Measurement) => Promise<{ landed: Promise<BodyWriteOutcome> }>;
  /** Linear-fit weight trend + projected goal date, or null when there
   *  aren't enough weigh-ins to fit a line. */
  projection: WeightProjection | null;
  /** Whether the fitted trend has crossed the user's own goal weight — the
   *  OBJECTIVE half only (`goalTrendCrossed`, never `goalReached`). What the
   *  `goal-reached` milestone prompt asks a question with; the person answering
   *  supplies the provenance the schema cannot (#110). */
  goalCrossed: boolean;
  /** Last 14 days of daily weights (oldest → newest) for the sparkline. */
  weightSeries: number[];
  /** 7-day dashed forecast stepping from the last weight along the fitted
   *  slope, or [] when there's no trend. */
  projectedSeries: number[];
  /** Progress from the starting weight toward the goal (cut/bulk-aware), or
   *  null when there's no goal or no weight history. Measured at the TREND
   *  weight (`goalProgressAt`), not the latest scale reading. */
  goalProgress: GoalProgress | null;
  /** The goal weight (lb) the chart draws its line at, or null. */
  goalWeight: number | null;
}

const PROJECTION_WINDOW_DAYS = 28;
const FORECAST_DAYS = 7;

const EMPTY_OVERLAY: PendingBodyOverlay = { weights: {}, added: [], updated: {}, deleted: [] };

/**
 * The "All" fetch merged under the live window (Body re-score, bug 3).
 *
 * `getAllDailyWeights` is a one-time read of EVERY day, recent ones included,
 * so spreading it under the snapshot let a day deleted since the fetch come
 * back the moment the delete landed and the overlay stopped hiding it. Only
 * the days OLDER than the listener's window come from the fetch — inside the
 * window the live snapshot is the only authority.
 */
export function mergeOlderWeights(
  older: Readonly<Record<string, number>>,
  snap: Readonly<Record<string, number>>,
  sinceKey: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of Object.keys(older)) if (k < sinceKey) out[k] = older[k];
  return Object.assign(out, snap);
}

/** The day the hero weight was recorded: the newest weigh-in, else the newest
 *  log carrying a weight — the same order `currentWeight` reads them in. */
function latestWeightDateKey(
  weightPoints: readonly DatedWeight[],
  logs: readonly DailyLog[],
  boundary: ReturnType<typeof dayBoundaryOf>,
): string | null {
  if (weightPoints.length) return weightPoints[weightPoints.length - 1].dateKey;
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].weight != null) return dayKeyAt(logs[i].date, boundary);
  }
  return null;
}

/** Snapshot + parked ops. Parked wins: it is the user's newer word. */
function overlayWeights(base: Record<string, number>, overlay: PendingBodyOverlay): Record<string, number> {
  const keys = Object.keys(overlay.weights);
  if (keys.length === 0) return base;
  const out = { ...base };
  for (const k of keys) {
    const v = overlay.weights[k];
    if (v == null) delete out[k];
    else out[k] = v;
  }
  return out;
}

function overlayMeasurements(base: Measurement[], overlay: PendingBodyOverlay): Measurement[] {
  if (!overlay.added.length && !overlay.deleted.length && !Object.keys(overlay.updated).length) return base;
  const deleted = new Set(overlay.deleted);
  const seen = new Set<string>();
  const rows: Measurement[] = [];
  for (const m of base) {
    if (!m.id || deleted.has(m.id)) continue;
    seen.add(m.id);
    const u = overlay.updated[m.id];
    // An edit replaces the editable fields wholesale — the same semantics as
    // `toMeasurementPatch`, where a cleared field is removed.
    rows.push(u ? ({ id: m.id, date: u.date ?? m.date, ...u.entry } as Measurement) : m);
  }
  for (const a of overlay.added) {
    if (a.id && !deleted.has(a.id) && !seen.has(a.id)) rows.push(a);
  }
  return rows.sort((a, b) => b.date.getTime() - a.date.getTime());
}

export function useBody(): BodyState {
  const { user } = useAuth();
  const uid = user?.uid;

  // The same three slices `useCoreSnapshot` hydrates, so a cold open of Body
  // paints from disk like every other tab (UX_AUDIT S18-13). Body states its
  // own channels rather than calling `useCoreSnapshot` for ONE reason: its
  // weights listener is date-bounded (Pf1) and the shared hook's is not. The
  // listener model is unchanged — still this hook's own `subscribe*` calls,
  // still focus-gated through `useLedgerFeed` (ADR-0016).
  const [logs, setLogs, logsFromCache] = useCachedState<DailyLog[]>(uid, 'logs', []);
  // NB this writes the 400-day map through to the SAME `weights` disk slice
  // the unbounded listeners write. A cold paint elsewhere may therefore start
  // from the bounded map for a frame before its own listener answers; nothing
  // derives from weights older than 400 days except goal progress, which every
  // screen recomputes from its live snapshot.
  const [snapWeights, setSnapWeights, weightsFromCache] = useCachedState<Record<string, number>>(uid, 'weights', {});
  const [profile, setProfile, profileFromCache] = useCachedState<Profile | null>(uid, 'profile', null);
  // Cached like the core three (UX_AUDIT S18-13): a cold open of Body should
  // show the last body-fat estimate rather than "no measurements" for a second.
  const [snapMeasurements, setMeasurements] = useCachedState<Measurement[]>(uid, 'measurements', []);
  const [earliest, setEarliest] = useState<{ dateKey: string; weight: number } | null>(null);
  const [olderWeights, setOlderWeights] = useState<Record<string, number> | null>(null);
  const [overlay, setOverlay] = useState<PendingBodyOverlay>(EMPTY_OVERLAY);

  // Anchored on the calendar, not the account's boundary: a window edge that
  // moves by a few hours once a profile lands would re-open the listener for
  // a difference of at most one day out of 400. Re-derived per calendar day
  // (re-score 3): computed once at mount, a session left open for days slid
  // the window by that many. A new day re-opens the listener once.
  const calendarToday = calendarDateKey(new Date());
  const sinceKey = useMemo(
    () => calendarDateKey(addDays(parseYmd(calendarToday), -WEIGHT_WINDOW_DAYS)),
    [calendarToday],
  );

  const feed = useLedgerFeed({
    uid,
    label: 'Body',
    gate: 'focus',
    // Same reasoning as `useCoreSnapshot`: `loaded` is gated on `!error`, so a
    // refocus has to be a retry or one failure strands the screen.
    retryOnOpen: true,
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'logs',
              open: (deliver, fail) => subscribeRecentLogs(uid, LOG_WINDOW_ROWS, deliver, fail),
              apply: setLogs,
            }),
            feedChannel({
              key: 'weights',
              open: (deliver, fail) => subscribeDailyWeightsSince(uid, sinceKey, deliver, fail),
              apply: setSnapWeights,
            }),
            feedChannel({
              key: 'profile',
              open: (deliver, fail) => subscribeProfile(uid, deliver, fail),
              apply: setProfile,
            }),
          ]
        : [],
    deps: [uid, sinceKey],
    onOpen: ({ uid: u, alive }) => {
      // One document, once per focus: the start line goal progress measures
      // from. A failure leaves `earliest` null and progress falls back to the
      // oldest weigh-in in the window — a later start, never a wrong one.
      getEarliestDailyWeight(u)
        .then((e) => alive() && setEarliest(e))
        .catch(() => {});
      // Anything parked offline gets another chance whenever Body is opened.
      flushPendingBody(u).catch(() => {});
    },
  });

  // Measurements are this tab's alone, so they stay their own subscription —
  // focus-gated and tracked the same way (ADR-0016).
  const measurementFeed = useLedgerFeed({
    uid,
    label: 'BodyMeasurements',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'measurements',
              open: (deliver, fail) => subscribeMeasurements(uid, MEASUREMENT_ROWS, deliver, fail),
              apply: setMeasurements,
            }),
          ]
        : [],
    deps: [uid],
  });

  // The parked overlay: what the durable queue holds, re-read on every change.
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const refresh = () => {
      void readPendingBody(uid).then((o) => alive && setOverlay(o));
    };
    refresh();
    const off = onPendingBodyChanged(refresh);
    return () => {
      alive = false;
      off();
    };
  }, [uid]);

  const painted = logsFromCache && weightsFromCache && profileFromCache;
  const loading = !(!feed.error && (feed.ready || painted));
  // Two independent reads, one error slot — the tab can only show one message,
  // and the core snapshot is the one that blanks the whole screen.
  const error = feed.error ?? measurementFeed.error;

  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  const todayKey = dayKeyAt(new Date(), boundary);

  const weights = useMemo(
    () => overlayWeights(olderWeights ? mergeOlderWeights(olderWeights, snapWeights, sinceKey) : snapWeights, overlay),
    [snapWeights, olderWeights, overlay, sinceKey],
  );
  const measurements = useMemo(() => overlayMeasurements(snapMeasurements, overlay), [snapMeasurements, overlay]);

  const weighIns = useMemo<WeighIn[]>(
    () => weighInDeltas(weights).map((r) => ({ dateKey: r.dateKey, weight: r.weightLb, deltaLb: r.deltaLb })),
    [weights],
  );
  const weightPoints = useMemo(() => sortedWeighIns(weights), [weights]);
  const trendPoints = useMemo(() => trendWeightSeries(weightPoints), [weightPoints]);
  const trendWeight = trendPoints.length ? trendPoints[trendPoints.length - 1].weightLb : null;
  const consistency = useMemo(
    () => weighInConsistency(weights, CONSISTENCY_DAYS, new Date(), boundary),
    [weights, boundary],
  );
  const weekAverage = useMemo(
    () => trailingAverageLb(weights, AVERAGE_DAYS, new Date(), boundary),
    [weights, boundary],
  );

  const hasOlderHistory = !olderWeights && earliest != null && earliest.dateKey < sinceKey;
  const loadingOlder = useRef(false);
  const loadAllHistory = useCallback(() => {
    if (!uid || olderWeights || loadingOlder.current) return;
    loadingOlder.current = true;
    getAllDailyWeights(uid)
      .then((all) => setOlderWeights(all))
      .catch(() => {
        /* The chart keeps the 400-day window; "All" is a nicety. */
      })
      .finally(() => {
        loadingOlder.current = false;
      });
  }, [uid, olderWeights]);

  // Body-fat from the latest measurement that carries the inputs the Navy
  // formula needs. `bodyFatGap` explains a null so the UI can nudge the user
  // toward the missing piece (profile sex/height vs. a tape measurement).
  const { bodyFat, bodyFatGap, bodyFatMissing } = useMemo<{
    bodyFat: number | null;
    bodyFatGap: BodyState['bodyFatGap'];
    bodyFatMissing: BodyFatInput[];
  }>(() => {
    if (!profile?.sex || !profile?.heightIn) {
      return { bodyFat: null, bodyFatGap: 'profile', bodyFatMissing: [] };
    }
    // Most recent measurement that actually has the tape inputs — not just the
    // single newest, which may be a partial (e.g. bicep-only) entry.
    const bf = latestNavyBodyFat(measurements, profile.sex, profile.heightIn);
    if (bf != null) return { bodyFat: bf, bodyFatGap: null, bodyFatMissing: [] };
    // Name the missing fields rather than repeating a generic ask. The old
    // message said "waist + neck" to everyone, which a woman can satisfy in
    // full and still get nothing — the formula also needs hip.
    return {
      bodyFat: null,
      bodyFatGap: 'measurement',
      bodyFatMissing: missingBodyFatInputs(measurements, profile.sex),
    };
  }, [profile, measurements]);

  const bodyFatShown = useMemo(
    () => bodyFatToShow(measurements, profile?.sex, profile?.heightIn, boundary),
    [measurements, profile, boundary],
  );

  const goalWeight = profile?.targetWeightLbs ?? profile?.goalWeightLbs ?? null;

  // The 28-day window both the projection and the goal-crossing read — built
  // ONCE (Pf2; it was rebuilt per consumer on every render).
  const projectionPoints = useMemo(
    () => weightPointsForDays(weights, PROJECTION_WINDOW_DAYS, new Date(), boundary),
    [weights, boundary],
  );

  // Fit the trend over a 28-day window of daily weights (longer than the
  // history list so this week's water-weight noise doesn't dominate).
  const projection = useMemo<WeightProjection | null>(
    () => projectWeight(projectionPoints, goalWeight),
    [projectionPoints, goalWeight],
  );

  /**
   * Has the weight TREND crossed the goal the user set for themselves?
   *
   * Only the objective half (`goalTrendCrossed`, not `goalReached`). It is what
   * the Body prompt asks a question with — `dailyWeights` carries no `source`,
   * so nothing here can tell a hand-typed weigh-in from an auto-imported one,
   * and the person answering the prompt IS the provenance (#110).
   *
   * Reads the same fitted trend the Body hero already shows, over the same
   * 28-day window, so the prompt cannot disagree with the number above it.
   */
  const goalCrossed = useMemo<boolean>(
    () =>
      goalTrendCrossed({
        goalDirection: profile?.goalDirection,
        targetWeightLbs: goalWeight,
        trendWeightLb: projection?.currentFittedLb ?? null,
        readingCount: projectionPoints.length,
      }),
    [profile?.goalDirection, goalWeight, projection, projectionPoints.length],
  );

  // 14-day weight line (oldest → newest), missed days dropped.
  const weightSeries = useMemo<number[]>(
    // Boundary-aware like `todayKey` above and the Trends weight chart: between
    // midnight and a 3 AM day start, a midnight-keyed window includes a day
    // that has not begun and drops the oldest real one.
    () => weightSeriesForDays(weights, SPARK_DAYS, new Date(), boundary),
    [weights, boundary],
  );

  // Dashed forecast: step from the last plotted weight along the fitted slope.
  const projectedSeries = useMemo<number[]>(() => {
    if (!projection || weightSeries.length < 2) return [];
    const last = weightSeries[weightSeries.length - 1];
    const perDay = projection.slopeLbPerWeek / 7;
    return Array.from({ length: FORECAST_DAYS }, (_, k) => +(last + perDay * (k + 1)).toFixed(1));
  }, [projection, weightSeries]);

  // Memoized (Pf2): both walk every key of the weights map, on every render.
  const currentWeight = useMemo(() => coreCurrentWeight(logs, weights), [logs, weights]);
  // The day the hero number was recorded. `currentWeight` falls back to a
  // log-embedded weight when there are no weigh-ins, and the caption has to
  // name THAT day, not none (Body re-score, bug 10).
  const currentWeightDateKey = latestWeightDateKey(weightPoints, logs, boundary);
  // The earliest-ever weigh-in rides along so the start line is the real one,
  // not the oldest inside the 400-day window. A parked delete of that very day
  // still wins — the overlay is applied to `weights`, and the start is only
  // added when the day is not deleted.
  const startBase = useMemo(
    () =>
      earliest && !(earliest.dateKey in weights) && overlay.weights[earliest.dateKey] !== null
        ? { [earliest.dateKey]: earliest.weight, ...weights }
        : weights,
    [weights, earliest, overlay],
  );
  const goalProgress = useMemo(() => {
    // Directional `remaining` (0 once past the goal) lives in core since S20.
    const scale = computeGoalProgress(logs, startBase, goalWeight);
    // Judged on the trend, not the morning's reading (re-score 3, bug 3): one
    // light day said "Goal reached" and celebrated, the next said 0.6 lb to
    // go. Needs two readings, like the trend headline it agrees with.
    return scale && weightPoints.length >= 2 ? goalProgressAt(scale, trendWeight) : scale;
  }, [logs, startBase, goalWeight, weightPoints.length, trendWeight]);
  // One start for goal progress AND the trend milestones (bug 4): the toast
  // said "since you started" while measuring from the oldest reading in a
  // window that slides forward a day at a time.
  const startLb = useMemo(() => {
    const first = sortedWeighIns(startBase)[0];
    return first?.weightLb ?? null;
  }, [startBase]);

  // The trend preview reads the LATEST map, not the one this callback closed
  // over: an Undo fires from a toast created before the delete it undoes was
  // applied, and against that stale map "before" still held the deleted row,
  // so the receipt said "trend unchanged" (bug 10).
  const weightsRef = useRef(weights);
  useEffect(() => {
    weightsRef.current = weights;
  }, [weights]);

  const setWeight = useCallback(
    async (weight: number, dateKey?: string, opts?: { health?: boolean }): Promise<WeighInReceipt> => {
      const key = dateKey ?? todayKey;
      if (!uid) return { landed: Promise.resolve('saved'), trend: { beforeLb: null, afterLb: null } };
      const trend = trendShift(weightsRef.current, key, weight);
      // Disk first, then the write (`pending-body.ts`): resolves once the
      // weigh-in is durable, which is what the sheet closes on (bug 2).
      const { landed } = await commitBodyOp({ kind: 'weight', uid, dateKey: key, weightLb: weight, atMs: Date.now() });
      // Health is local, so it is mirrored now rather than when the server
      // answers — and the manual act is recorded so a scale's earlier sample
      // for the day cannot "correct" this one back (bug 1). Skipped for the
      // Undo of a delete whose value was a scale's: the scale's own sample is
      // still in Health, and exporting would put a duplicate beside it
      // (re-score 3, bug 6). The delete already recorded the override.
      if (opts?.health !== false) void exportManualWeight(uid, key, weight);
      // Counted once the weigh-in is either in the ledger or parked to land
      // there — both are a logged weight. A refusal is not.
      void landed.then((o) => {
        if (o !== 'rejected') track('weight_logged');
      });
      return { landed, trend };
    },
    [uid, todayKey],
  );

  const deleteWeighIn = useCallback(
    async (dateKey: string): Promise<DeleteReceipt> => {
      if (!uid) return { landed: Promise.resolve('saved'), fromHealth: Promise.resolve(false) };
      const { landed } = await commitBodyOp({ kind: 'weightDelete', uid, dateKey, atMs: Date.now() });
      return { landed, fromHealth: forgetHealthWeight(uid, dateKey) };
    },
    [uid],
  );

  // Mirror the derived Navy body-fat % to Health when it changes (export-only —
  // the app computes its own, so it's never imported). Seed on first observation
  // so opening the tab doesn't re-write an unchanged value every session.
  const prevBodyFat = useRef<number | null>(null);
  useEffect(() => {
    if (bodyFat == null) return;
    if (prevBodyFat.current == null) {
      prevBodyFat.current = bodyFat;
      return;
    }
    if (bodyFat !== prevBodyFat.current) {
      prevBodyFat.current = bodyFat;
      void exportDaily('bodyFat', todayKey, bodyFat);
    }
  }, [bodyFat, todayKey]);

  const addMeasurement = useCallback(
    async (entry: Omit<Measurement, 'id' | 'date'>, date?: Date) => {
      if (!uid) return { landed: Promise.resolve<BodyWriteOutcome>('saved') };
      return commitBodyOp({
        kind: 'measurementAdd',
        uid,
        // Minted here so a replay lands on the same document (`addMeasurementWithId`).
        id: newLedgerId(Math.random),
        entry,
        dateMs: (date ?? new Date()).getTime(),
        atMs: Date.now(),
      });
    },
    [uid],
  );
  const updateMeasurement = useCallback(
    async (id: string, entry: Omit<Measurement, 'id' | 'date'>, date?: Date) => {
      if (!uid) return { landed: Promise.resolve<BodyWriteOutcome>('saved') };
      return commitBodyOp({
        kind: 'measurementUpdate',
        uid,
        id,
        entry,
        ...(date ? { dateMs: date.getTime() } : {}),
        atMs: Date.now(),
      });
    },
    [uid],
  );
  const deleteMeasurement = useCallback(
    async (id: string) => {
      if (!uid) return { landed: Promise.resolve<BodyWriteOutcome>('saved') };
      return commitBodyOp({ kind: 'measurementDelete', uid, id, atMs: Date.now() });
    },
    [uid],
  );
  const restoreMeasurement = useCallback(
    async (m: Measurement) => {
      if (!uid || !m.id) return { landed: Promise.resolve<BodyWriteOutcome>('saved') };
      const { id: _id, date, ...entry } = m;
      return commitBodyOp({ kind: 'measurementAdd', uid, id: m.id, entry, dateMs: date.getTime(), atMs: Date.now() });
    },
    [uid],
  );

  return {
    loading,
    error,
    currentWeight,
    currentWeightDateKey,
    todayWeight: weights[todayKey] ?? null,
    todayKey,
    trendWeight,
    weighIns,
    weights,
    weightPoints,
    trendPoints,
    consistency,
    weekAverage,
    startLb,
    hasOlderHistory,
    loadAllHistory,
    setWeight,
    deleteWeighIn,
    measurements,
    bodyFat,
    bodyFatGap,
    bodyFatMissing,
    bodyFatShown,
    addMeasurement,
    updateMeasurement,
    deleteMeasurement,
    restoreMeasurement,
    projection,
    goalCrossed,
    weightSeries,
    projectedSeries,
    goalProgress,
    goalWeight,
  };
}
