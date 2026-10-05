import { useEffect, useMemo, useState } from 'react';
import {
  type ActivityLevel,
  type DailyTargets,
  type DateKey,
  type MeasurementProgress,
  type TdeeResult,
  type TdeeSeriesPoint,
  type WeeklyBudget,
  type WeeklyInsights,
  type WeightSeriesPoint,
  TDEE_SERIES_MAX_DAYS,
  basalMifflinStJeor,
  dayBoundaryOf,
  dayKeyAt,
  computeWeeklyBudget,
  computeWeeklyInsights,
  dailyTargets,
  measurementProgress,
  parseYmd,
  summarizeDays,
  isoWeek,
  tdeeSeries,
  trailingDateKeys,
  weightPointsForDays,
  weightTrendSeries,
} from '@macrolog/core';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';
import { useFocusDay } from '@/hooks/useFocusDay';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import { subscribeMilestones } from '@/lib/ledger';
import { type CompositionTrends, useCompositionTrends } from '@/hooks/useCompositionTrends';
import { type SleepTrends, useSleepTrends } from '@/hooks/useSleepTrends';
import { type FastingTrends, useFastingTrends } from '@/hooks/useFastingTrends';
import { type WaterTrends, useWaterTrends } from '@/hooks/useWaterTrends';

const INSIGHT_DAYS = 7;
const SLOPE_WINDOW_DAYS = 28;

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
   * The chart window's day keys, oldest → newest — {@link TDEE_SERIES_MAX_DAYS}
   * (the free 90-day cap) long, keyed exactly as `dailyTargets` keys the
   * estimator (`MIDNIGHT`), so the expenditure line's right edge is the hero.
   * Every per-day array below is aligned to it; a range chip slices the tail.
   */
  chartKeys: DateKey[];
  /** Scale readings + trend line per chart day. Gaps stay null. */
  weightSeries: WeightSeriesPoint[];
  /** Calories logged per chart day, null on a day with no food logged. */
  intakeSeries: (number | null)[];
  /**
   * The maintenance estimate's history for the last `rangeDays` days, or null
   * while it is still being computed. Deferred past the first paint on
   * purpose — 90 replays of `calculateTdee` are not render-path work
   * (`tdee-series.ts`).
   */
  expenditure: TdeeSeriesPoint[] | null;
  /** Days since the first logged row, capped at the chart window — what the
   *  "All" range means. */
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


/**
 * @param rangeDays How many days of expenditure history the screen is showing
 *   (the range chip). Only that many replays are computed.
 */
export function useTrends(rangeDays: number = 30): TrendsState {
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

  // The trailing seven days, summarised ONCE — insights and the "N of 7" count
  // read the same rows (this was three `summarizeDays` passes).
  const week7 = useMemo(
    () => summarizeDays(trailingDateKeys(INSIGHT_DAYS, focusDay, boundary), logs, weights, boundary),
    [logs, weights, boundary, focusDay],
  );

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
  const chartKeys = useMemo(() => trailingDateKeys(TDEE_SERIES_MAX_DAYS, focusDay), [focusDay]);
  const weightSeries = useMemo(() => weightTrendSeries(weights, chartKeys), [weights, chartKeys]);
  const intakeSeries = useMemo(
    () => summarizeDays(chartKeys, logs, weights, boundary).map((d) => (d.totalCalories > 0 ? d.totalCalories : null)),
    [chartKeys, logs, weights, boundary],
  );
  const historyDays = useMemo(() => {
    let first: string | null = null;
    for (const l of logs) {
      const k = dayKeyAt(l.date, boundary);
      if (first == null || k < first) first = k;
    }
    if (first == null) return 0;
    const span = Math.round((parseYmd(chartKeys[chartKeys.length - 1]).getTime() - parseYmd(first).getTime()) / 86_400_000) + 1;
    return Math.max(1, Math.min(TDEE_SERIES_MAX_DAYS, span));
  }, [logs, boundary, chartKeys]);

  // Deferred: the series is up to 90 `calculateTdee` replays, which is tens of
  // milliseconds on a desktop and more on a phone. Computing it in a memo would
  // put that on the frame that first paints Trends; after an idle callback the
  // screen is already up and scrollable, and the chart fills in.
  const [expenditure, setExpenditure] = useState<TdeeSeriesPoint[] | null>(null);
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      setExpenditure(tdeeSeries(profile, logs, weights, { days: rangeDays, now: focusDay }));
    };
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number }).requestIdleCallback;
    const cic = (globalThis as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
    if (ric && cic) {
      const h = ric(run);
      return () => {
        cancelled = true;
        cic(h);
      };
    }
    const h = setTimeout(run, 0);
    return () => {
      cancelled = true;
      clearTimeout(h);
    };
  }, [loaded, profile, logs, weights, rangeDays, focusDay]);

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
