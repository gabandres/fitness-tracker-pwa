import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type DailyTargets,
  type DaySummary,
  type LogEntry,
  type MealPreset,
  type Profile,
  type ShareStats,
  computeStreak,
  currentWeight as coreCurrentWeight,
  dailyTargets,
  localDateKey,
  summarizeDay,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  addLog as addLogDoc,
  addPreset as addPresetDoc,
  breakFast as breakFastDoc,
  deleteLog as deleteLogDoc,
  deletePreset as deletePresetDoc,
  setDailySleep,
  setDailyWater,
  setHiddenRecentLabels,
  startFast as startFastDoc,
  subscribeDailySleep,
  subscribeDailyWater,
  subscribeDailyWeights,
  subscribePresets,
  subscribeProfile,
  subscribeRecentLogs,
  updateLog as updateLogDoc,
} from '@/lib/ledger';

// Generous window so measured-mode TDEE (≥14 distinct days) can engage.
const LOG_WINDOW = 400;

export interface TodayState {
  loading: boolean;
  error: Error | null;
  summary: DaySummary;
  targets: DailyTargets;
  /** Today's food rows (calories > 0), newest first for the list. */
  todayLogs: DailyLog[];
  /** User-saved quick-add templates. */
  presets: MealPreset[];
  /** Distinct recent meals (deduped by label, newest first, capped at 5,
   *  minus the user's hidden labels) for one-tap re-logging. */
  recentEntries: DailyLog[];
  addEntry: (entry: LogEntry) => Promise<void>;
  updateEntry: (id: string, entry: LogEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addPreset: (preset: Omit<MealPreset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  /** Suppress a label from the recents row (does NOT delete log rows). */
  hideRecent: (label: string) => Promise<void>;
  /** Portion-display preference for the food-search serving sort. */
  unitSystem: 'us' | 'metric';
  /** Today's daily metrics + setters. */
  water: number;
  sleep: number | null;
  setWater: (flOz: number) => Promise<void>;
  setSleep: (hours: number) => Promise<void>;
  /** Fast start time (Date) or null when not fasting. */
  fastStartedAt: Date | null;
  startFast: () => Promise<void>;
  breakFast: () => Promise<void>;
  /** Consecutive logged-day streak ending today (or yesterday). */
  streak: number;
  /** Copy yesterday's food entries onto today (time-of-day preserved).
   *  Returns how many were copied. */
  repeatYesterday: () => Promise<number>;
  /** Numbers-only progress stats for the share card (streak, logged days,
   *  weight change). */
  shareStats: ShareStats;
}

export function useToday(): TodayState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [water, setWaterMap] = useState<Record<string, number>>({});
  const [sleep, setSleepMap] = useState<Record<string, number>>({});
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
      subscribePresets(uid, setPresets, setError),
      subscribeDailyWater(uid, setWaterMap, setError),
      subscribeDailySleep(uid, setSleepMap, setError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const todayKey = localDateKey(new Date());
  const summary = useMemo(() => summarizeDay(todayKey, logs, weights), [todayKey, logs, weights]);
  const targets = useMemo(() => dailyTargets(profile, logs, weights), [profile, logs, weights]);
  const todayLogs = useMemo(
    () =>
      logs
        .filter((l) => localDateKey(l.date) === todayKey && l.calories > 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [logs, todayKey],
  );

  // Distinct recent meals for one-tap re-logging. Mirrors the PWA's
  // FitnessStore.recentEntries: walk newest-first, dedupe case-insensitively
  // by label, skip empty (weight-only / training-marker) rows and any the
  // user suppressed via `hiddenRecentLabels`, cap at 5. `logs` is oldest-first.
  const recentEntries = useMemo(() => {
    const hidden = new Set((profile?.hiddenRecentLabels ?? []).map((l) => l.toLowerCase()));
    const seen = new Set<string>();
    const out: DailyLog[] = [];
    for (let i = logs.length - 1; i >= 0 && out.length < 5; i--) {
      const label = logs[i].mealLabel?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key) || hidden.has(key)) continue;
      seen.add(key);
      out.push(logs[i]);
    }
    return out;
  }, [logs, profile]);

  const streak = useMemo(() => computeStreak(logs).streak, [logs]);

  const shareStats = useMemo<ShareStats>(() => {
    const loggedDays = new Set(
      logs.filter((l) => l.calories > 0).map((l) => localDateKey(l.date)),
    ).size;
    const current = coreCurrentWeight(logs, weights);
    const wKeys = Object.keys(weights).sort();
    let start: number | null = wKeys.length > 0 ? weights[wKeys[0]] : null;
    if (start == null) {
      for (const l of logs) {
        if (l.weight != null) {
          start = l.weight;
          break;
        }
      }
    }
    const weightDeltaLb = start != null && current != null ? +(start - current).toFixed(1) : null;
    return { streak, loggedDays, weightDeltaLb };
  }, [logs, weights, streak]);

  const repeatYesterday = useCallback(async () => {
    if (!uid) return 0;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = localDateKey(y);
    const yLogs = logs.filter((l) => localDateKey(l.date) === yKey && l.calories > 0);
    for (const l of yLogs) {
      const ts = new Date();
      ts.setHours(l.date.getHours(), l.date.getMinutes(), 0, 0);
      await addLogDoc(uid, {
        calories: l.calories,
        protein: l.protein,
        carbs: l.carbs,
        fat: l.fat,
        mealLabel: l.mealLabel,
        mealType: l.mealType,
        timestamp: ts,
      });
    }
    return yLogs.length;
  }, [uid, logs]);

  const addEntry = useCallback(
    async (entry: LogEntry) => {
      if (uid) await addLogDoc(uid, entry);
    },
    [uid],
  );
  const updateEntry = useCallback(
    async (id: string, entry: LogEntry) => {
      if (uid) await updateLogDoc(uid, id, entry);
    },
    [uid],
  );
  const deleteEntry = useCallback(
    async (id: string) => {
      if (uid) await deleteLogDoc(uid, id);
    },
    [uid],
  );
  const addPreset = useCallback(
    async (preset: Omit<MealPreset, 'id'>) => {
      if (uid) await addPresetDoc(uid, preset);
    },
    [uid],
  );
  const deletePreset = useCallback(
    async (id: string) => {
      if (uid) await deletePresetDoc(uid, id);
    },
    [uid],
  );
  const hideRecent = useCallback(
    async (label: string) => {
      const norm = label.trim().toLowerCase();
      if (!uid || !norm) return;
      const current = profile?.hiddenRecentLabels ?? [];
      if (current.includes(norm)) return;
      await setHiddenRecentLabels(uid, [...current, norm]);
    },
    [uid, profile],
  );
  const setWater = useCallback(
    async (flOz: number) => {
      if (uid) await setDailyWater(uid, todayKey, flOz);
    },
    [uid, todayKey],
  );
  const setSleep = useCallback(
    async (hours: number) => {
      if (uid) await setDailySleep(uid, todayKey, hours);
    },
    [uid, todayKey],
  );
  const startFast = useCallback(async () => {
    if (uid) await startFastDoc(uid);
  }, [uid]);
  const breakFast = useCallback(async () => {
    if (uid) await breakFastDoc(uid);
  }, [uid]);

  return {
    loading,
    error,
    summary,
    targets,
    todayLogs,
    presets,
    recentEntries,
    addEntry,
    updateEntry,
    deleteEntry,
    addPreset,
    deletePreset,
    hideRecent,
    unitSystem: profile?.unitSystem === 'metric' ? 'metric' : 'us',
    water: water[todayKey] ?? 0,
    sleep: sleep[todayKey] ?? null,
    setWater,
    setSleep,
    fastStartedAt: profile?.fastStartedAt ?? null,
    startFast,
    breakFast,
    streak,
    repeatYesterday,
    shareStats,
  };
}
