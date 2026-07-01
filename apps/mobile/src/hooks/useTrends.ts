import { useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type DailyTargets,
  type Profile,
  type TdeeResult,
  type WeeklyBudget,
  type WeeklyInsights,
  type WeightPoint,
  addDays,
  computeWeeklyBudget,
  computeWeeklyInsights,
  dailyTargets,
  localDateKey,
  summarizeDays,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

const LOG_WINDOW = 400;
const INSIGHT_DAYS = 7;
const SLOPE_WINDOW_DAYS = 28;

export interface TrendsState {
  loading: boolean;
  error: Error | null;
  /** 7-day calorie insights, or null below the logged-day gate. */
  insights: WeeklyInsights | null;
  /** Adaptive TDEE engine state (maintenance estimate + mode). */
  tdee: TdeeResult;
  targetCalories: number;
  /** Last 14 days of daily weights (oldest → newest) for the weight chart. */
  weightSeries: number[];
  /** Weekly calorie budget / banking (Mon→Sun), or null below the target
   *  gate. */
  budget: WeeklyBudget | null;
}

const SPARK_DAYS = 14;

export function useTrends(): TrendsState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubs = [
      subscribeRecentLogs(
        uid,
        LOG_WINDOW,
        (l) => {
          setLogs(l);
          setLoading(false);
        },
        setError,
      ),
      subscribeDailyWeights(uid, setWeights, setError),
      subscribeProfile(uid, setProfile, setError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const targets: DailyTargets = useMemo(
    () => dailyTargets(profile, logs, weights),
    [profile, logs, weights],
  );

  const insights = useMemo(() => {
    const today = new Date();
    const dayKeys = Array.from({ length: INSIGHT_DAYS }, (_, i) =>
      localDateKey(addDays(today, -(INSIGHT_DAYS - 1 - i))),
    );
    const summaries = summarizeDays(dayKeys, logs, weights);
    const points: WeightPoint[] = [];
    for (let i = SLOPE_WINDOW_DAYS - 1; i >= 0; i--) {
      const key = localDateKey(addDays(today, -i));
      const v = weights[key];
      if (typeof v === 'number') points.push({ dateKey: key, weightLb: v });
    }
    return computeWeeklyInsights(summaries, targets.calorieTarget, points);
  }, [logs, weights, targets]);

  const weightSeries = useMemo<number[]>(() => {
    const today = new Date();
    const out: number[] = [];
    for (let i = SPARK_DAYS - 1; i >= 0; i--) {
      const v = weights[localDateKey(addDays(today, -i))];
      if (typeof v === 'number') out.push(v);
    }
    return out;
  }, [weights]);

  const budget = useMemo<WeeklyBudget | null>(() => {
    // ISO-local week (Monday-start): the seven Mon→Sun date keys and today's
    // 1-based position. Monday is at most 6 days back, so the log window covers
    // the elapsed week.
    const today = new Date();
    const daysSinceMonday = (today.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
    const monday = addDays(today, -daysSinceMonday);
    const keys = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(monday, i)));
    const days = summarizeDays(keys, logs, weights);
    return computeWeeklyBudget(days, daysSinceMonday + 1, targets.calorieTarget);
  }, [logs, weights, targets]);

  return {
    loading,
    error,
    insights,
    tdee: targets.tdee,
    targetCalories: targets.calorieTarget,
    weightSeries,
    budget,
  };
}
