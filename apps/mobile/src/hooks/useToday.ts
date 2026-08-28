import { useCallback, useEffect, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { trackSubs } from '@/lib/sub-debug';
import { useCachedState } from '@/hooks/useCachedState';
import { addLogDurably, onPendingLogsChanged, pendingLogsAsRows } from '@/lib/pending-logs';
import { track } from '@/lib/analytics';
import { exportDaily } from '@/lib/health-sync';
import {
  type CustomFood,
  type DailyLog,
  type DailyTargets,
  type DaySummary,
  type MealPreset,
  type Profile,
  type ShareStats,
  STREAK_FREEZE_MAX_GAP_PRO,
  computeStreak,
  currentWeight as coreCurrentWeight,
  dailyTargets,
  dayBoundaryOf,
  dayKeyAt,
  LOG_WINDOW_ROWS,
  summarizeDay,
} from '@macrolog/core';
import { useSubscription } from '@/lib/subscription';
import { useAuth } from '@/lib/auth';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
import {
  breakFast as breakFastDoc,
  setDailySleep,
  setDailyWater,
  setHiddenRecentLabels,
  startFast as startFastDoc,
  subscribeCustomFoods,
  subscribeDailyActivity,
  subscribeDailySleep,
  subscribeDailyWater,
  subscribeDailyWeights,
  subscribePresets,
  subscribeProfile,
  subscribeRecentLogs,
  type DailyActivity,
} from '@/lib/ledger';
import { isTodayLoading } from '@/lib/today-gate';



/** Reads are this hook's own (ADR-0016); the writes are the shared set every
 *  logging surface uses — see `useLogWrites`. */
export interface TodayState extends LogWrites {
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
  /** User's saved food library (My Foods, ADR-0013). */
  customFoods: CustomFood[];
  /** Suppress a label from the recents row (does NOT delete log rows). */
  hideRecent: (label: string) => Promise<void>;
  /** Portion-display preference for the food-search serving sort. */
  unitSystem: 'us' | 'metric';
  /** Today's daily metrics + setters. */
  water: number;
  sleep: number | null;
  activity: DailyActivity | undefined;
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
  // Every read slice is cached to disk on the way in, so a cold start with no
  // signal paints the last online session instead of an empty day
  // (`offline-cache.ts`). The setters are the same ones `onSnapshot` already
  // called — the write-through is invisible from here.
  const [liveLogs, setLogs, logsFromCache] = useCachedState<DailyLog[]>(uid, 'logs', []);
  const [weights, setWeights] = useCachedState<Record<string, number>>(uid, 'weights', {});
  const [profile, setProfile, profileFromCache] = useCachedState<Profile | null>(
    uid,
    'profile',
    null,
  );
  const [presets, setPresets] = useCachedState<MealPreset[]>(uid, 'presets', []);
  const [customFoods, setCustomFoods] = useCachedState<CustomFood[]>(uid, 'customFoods', []);
  const [water, setWaterMap] = useCachedState<Record<string, number>>(uid, 'water', {});
  const [sleep, setSleepMap] = useCachedState<Record<string, number>>(uid, 'sleep', {});
  const [activity, setActivityMap] = useCachedState<Record<string, DailyActivity>>(
    uid,
    'activity',
    {},
  );
  const [snapshotArrived, setSnapshotArrived] = useState(false);
  /**
   * The profile listener has answered AT ALL — server or cache, present or
   * genuinely absent. Not "authoritative", deliberately: see {@link loading}.
   */
  const [profileSettled, setProfileSettled] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [failed, setFailed] = useState(false);
  /** Record the error AND release the spinner, so a failure is not a hang. */
  const failWith = useCallback((e: Error) => {
    setError(e);
    setFailed(true);
  }, []);
  /** Rows parked on disk by an offline add, not yet in Firestore. */
  const [pending, setPending] = useState<DailyLog[]>([]);

  // The rule lives in `today-gate.ts` — pure, dependency-free and tested there,
  // because it decides whether a user is shown someone else's calorie target.
  // Every clause is a bug that has actually happened; `isTodayLoading`'s doc
  // comment carries which, including why the profile half deliberately accepts a
  // cache-only answer where the logs half does not.
  const logsReady = snapshotArrived || logsFromCache;
  const profileReady = profileSettled || profileFromCache;
  const loading = isTodayLoading({ logsReady, profileReady, failed });

  // Re-read the parked queue when it changes (a park, or a flush that emptied
  // it) and whenever the account does. Cheap: one AsyncStorage read of a list
  // capped at PENDING_LOGS_MAX.
  useEffect(() => {
    if (!uid) {
      setPending([]);
      return;
    }
    let cancelled = false;
    const reload = () => {
      void pendingLogsAsRows(uid).then((rows) => {
        if (!cancelled) setPending(rows);
      });
    };
    reload();
    const off = onPendingLogsChanged(reload);
    return () => {
      cancelled = true;
      off();
    };
  }, [uid]);

  /**
   * Live rows, with anything still parked laid over the top.
   *
   * Deduped by id, live wins. A parked row carries the id its flush will write
   * to, so the moment the real document arrives the two collapse into one with
   * no flicker and no double-counted calories — which is the entire reason the
   * id is minted before the attempt (ADR-0020).
   */
  const logs = useMemo(() => {
    if (pending.length === 0) return liveLogs;
    const live = new Set(liveLogs.map((l) => l.id).filter(Boolean));
    const extra = pending.filter((p) => !live.has(p.id));
    if (extra.length === 0) return liveLogs;
    // `logs` is oldest-first by contract (the ledger seam) and every consumer
    // below relies on it, so the merge re-sorts rather than appending.
    return [...liveLogs, ...extra].sort((a, b) => a.date.getTime() - b.date.getTime());
  }, [liveLogs, pending]);

  // Focus-gated (not mount-gated): the tab detaches its Firestore listeners
  // when it blurs, so background tabs stop holding live onSnapshot channels
  // awake (battery/network). Re-subscribes from cache on refocus — no spinner
  // flash, hence no setLoading(true) here (initial state covers first load).
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const unsubs = [
        // Every slice below honours snapshot PROVENANCE. Firestore runs
        // memory-only here (RN has no IndexedDB), so an offline listener fires
        // immediately with an EMPTY result carrying `fromCache: true`. Treating
        // that as real data discarded the disk hydration, wrote the empty value
        // through — poisoning the cache for the next cold start — and then
        // clobbered whatever had already been painted. Measured on Train, which
        // took three publishes to get right; this is the same defect on the
        // screen `offline-cache.ts` was actually written for.
        subscribeRecentLogs(
          uid,
          LOG_WINDOW_ROWS,
          (l, meta) => {
            const authoritative = !meta?.fromCache;
            setLogs(l, { authoritative });
            // Only a SERVER answer ends the spinner on its own; the disk cache
            // and `failed` below cover the offline cases.
            if (authoritative) setSnapshotArrived(true);
          },
          failWith,
        ),
        subscribeDailyWeights(uid, (w, meta) =>
          setWeights(w, { authoritative: !meta?.fromCache }),
        ),
        subscribeProfile(uid, (p, meta) => {
          setProfile(p, { authoritative: !meta.fromCache });
          // Any answer settles it — see the `loading` note. Requiring a server
          // answer here would hang a cold-cache offline start.
          setProfileSettled(true);
        }),
        subscribePresets(uid, (rows, meta) =>
          setPresets(rows, { authoritative: !meta?.fromCache }),
        ),
        subscribeCustomFoods(uid, (rows, meta) =>
          setCustomFoods(rows, { authoritative: !meta?.fromCache }),
        ),
        subscribeDailyWater(uid, (m, meta) =>
          setWaterMap(m, { authoritative: !meta?.fromCache }),
        ),
        subscribeDailySleep(uid, (m, meta) =>
          setSleepMap(m, { authoritative: !meta?.fromCache }),
        ),
        // Health-imported steps / active energy. Read-only here — the
        // device measures these and the app never writes them back.
        subscribeDailyActivity(uid, (m, meta) =>
          setActivityMap(m, { authoritative: !meta?.fromCache }),
        ),
      ];
      return trackSubs('Today', unsubs);
    }, [uid]),
  );

  // ADR-0030: which day "today" IS, and which day each row belongs to, both
  // come from the profile's boundary. An empty boundary is the calendar date,
  // which is every account until the Settings row is used.
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  const todayKey = dayKeyAt(new Date(), boundary);
  const summary = useMemo(
    () => summarizeDay(todayKey, logs, weights, boundary),
    [todayKey, logs, weights, boundary],
  );
  const targets = useMemo(() => dailyTargets(profile, logs, weights), [profile, logs, weights]);
  const todayLogs = useMemo(
    () =>
      logs
        .filter((l) => dayKeyAt(l.date, boundary) === todayKey && l.calories > 0)
        .sort((a, b) => b.date.getTime() - a.date.getTime()),
    [logs, todayKey, boundary],
  );

  // Distinct recent meals for one-tap re-logging. Mirrors the PWA's
  // FitnessStore.recentEntries: walk newest-first, dedupe case-insensitively
  // by label, skip empty (weight-only / training-marker) rows and any the
  // user suppressed via `hiddenRecentLabels`. `logs` is oldest-first.
  //
  // Cap raised 5 -> 12 (2026-08-08): recents used to be one of four competing
  // sections in the add sheet, so a short list was mercy. It is now the single
  // ranked list that sheet opens on, and 5 was leaving the surface empty-looking.
  const recentEntries = useMemo(() => {
    const hidden = new Set((profile?.hiddenRecentLabels ?? []).map((l) => l.toLowerCase()));
    const seen = new Set<string>();
    const out: DailyLog[] = [];
    for (let i = logs.length - 1; i >= 0 && out.length < 12; i--) {
      const label = logs[i].mealLabel?.trim();
      if (!label) continue;
      const key = label.toLowerCase();
      if (seen.has(key) || hidden.has(key)) continue;
      seen.add(key);
      out.push(logs[i]);
    }
    return out;
  }, [logs, profile]);

  const { isPro } = useSubscription();
  const streak = useMemo(
    () =>
      computeStreak(logs, { freezeMaxGap: isPro ? STREAK_FREEZE_MAX_GAP_PRO : 0, boundary })
        .streak,
    [logs, isPro, boundary],
  );

  const shareStats = useMemo<ShareStats>(() => {
    const loggedDays = new Set(
      logs.filter((l) => l.calories > 0).map((l) => dayKeyAt(l.date, boundary)),
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
  }, [logs, weights, streak, boundary]);

  const repeatYesterday = useCallback(async () => {
    if (!uid) return 0;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = dayKeyAt(y, boundary);
    const yLogs = logs.filter((l) => dayKeyAt(l.date, boundary) === yKey && l.calories > 0);
    for (const l of yLogs) {
      const ts = new Date();
      ts.setHours(l.date.getHours(), l.date.getMinutes(), 0, 0);
      // Durable like every other add — a repeat is the one-tap path a user
      // reaches for precisely when they cannot be bothered to retype a day,
      // and losing it offline would be losing a whole day of meals at once.
      await addLogDurably(uid, {
        calories: l.calories,
        protein: l.protein,
        carbs: l.carbs,
        fat: l.fat,
        mealLabel: l.mealLabel,
        mealType: l.mealType,
        timestamp: ts,
      });
    }
    // Counted once per use, not once per row copied — the question it answers
    // is whether the shortcut earns its place on an empty Today.
    if (yLogs.length > 0) track('repeat_yesterday');
    return yLogs.length;
  }, [uid, logs, boundary]);

  // Every logging surface's writes, shared with History so the two cannot
  // drift again (`useLogWrites`). The meal-slot default sits below even that,
  // at the ledger write.
  const writes = useLogWrites();

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
      if (!uid) return;
      await setDailyWater(uid, todayKey, flOz);
      void exportDaily('water', todayKey, flOz);
    },
    [uid, todayKey],
  );
  const setSleep = useCallback(
    async (hours: number) => {
      if (!uid) return;
      await setDailySleep(uid, todayKey, hours);
      void exportDaily('sleep', todayKey, hours);
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
    customFoods,
    ...writes,
    hideRecent,
    unitSystem: profile?.unitSystem === 'metric' ? 'metric' : 'us',
    water: water[todayKey] ?? 0,
    sleep: sleep[todayKey] ?? null,
    activity: activity[todayKey],
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
