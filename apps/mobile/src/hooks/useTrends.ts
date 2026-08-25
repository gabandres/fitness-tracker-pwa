import { useMemo } from 'react';
import {
  type ActivityLevel,
  type DailyTargets,
  type TdeeResult,
  type WeeklyBudget,
  type WeeklyInsights,
  type WeightPoint,
  addDays,
  basalMifflinStJeor,
  computeWeeklyBudget,
  computeWeeklyInsights,
  dailyTargets,
  summarizeDays,
  isoWeek,
  trailingDateKeys,
  weightPointsForDays,
  weightSeriesForDays,
} from '@macrolog/core';

/** Sparkline length — a chart-width choice, not a domain window. */
const SPARK_DAYS = 14;
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';
import { type SleepTrends, useSleepTrends } from '@/hooks/useSleepTrends';

const INSIGHT_DAYS = 7;
const SLOPE_WINDOW_DAYS = 28;

export interface TrendsState {
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
  /** Last 14 days of daily weights (oldest → newest) for the weight chart. */
  weightSeries: number[];
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
}


export function useTrends(): TrendsState {
  // Focus-gated so the Trends tab drops its live listeners when it blurs
  // (battery/network); re-subscribes from cache on refocus. That discipline,
  // the 400-row window and the error policy all live in `useCoreSnapshot`.
  const { logs, weights, profile, loaded, error } = useCoreSnapshot('Trends');
  const loading = !loaded;

  // The intake half of the sleep pairing is the stream above; the sleep half is
  // this hook's own listener.
  const sleep = useSleepTrends(logs, weights, profile);

  const targets: DailyTargets = useMemo(
    () => dailyTargets(profile, logs, weights),
    [profile, logs, weights],
  );

  const insights = useMemo(() => {
    const today = new Date();
    const summaries = summarizeDays(trailingDateKeys(INSIGHT_DAYS, today), logs, weights);
    const points = weightPointsForDays(weights, SLOPE_WINDOW_DAYS, today);
    return computeWeeklyInsights(summaries, targets.calorieTarget, points, targets.proteinTarget);
  }, [logs, weights, targets]);

  const loggedThisWeek = useMemo(() => {
    const today = new Date();
    return summarizeDays(trailingDateKeys(INSIGHT_DAYS, today), logs, weights)
      .filter((d) => d.mealCount > 0 && d.totalCalories > 0).length;
  }, [logs, weights]);

  const weightSeries = useMemo<number[]>(
    () => weightSeriesForDays(weights, SPARK_DAYS, new Date()),
    [weights],
  );

  const budget = useMemo<WeeklyBudget | null>(() => {
    // ISO-local week (Monday-start): the seven Mon→Sun date keys and today's
    // 1-based position. Monday is at most 6 days back, so the log window covers
    // the elapsed week.
    const week = isoWeek(new Date());
    const days = summarizeDays(week.keys, logs, weights);
    return computeWeeklyBudget(days, week.daysElapsed, targets.calorieTarget);
  }, [logs, weights, targets]);

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
    weightSeries,
    budget,
    basalKcal,
    activityLevel: profile?.activityLevel ?? null,
    sleep,
  };
}
