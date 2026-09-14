import { useCallback, useEffect, useMemo, useState } from 'react';
import { useCachedState } from '@/hooks/useCachedState';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { onPendingLogsChanged, pendingLogsAsRows } from '@/lib/pending-logs';
import { repeatYesterday as repeatYesterdayOp, writeDailyMetric } from '@/lib/ledger-ops';
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
  type DayBoundary,
  type DateKey,
  dayBoundaryOf,
  dayKeyAt,
  LOG_WINDOW_ROWS,
  summarizeDay,
  measurementProgress,
  type MeasurementProgress,
} from '@macrolog/core';
import { useSubscription } from '@/lib/subscription';
import { useAuth } from '@/lib/auth';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
import {
  breakFast as breakFastDoc,
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
  /** The user's day boundary and today's key under it (ADR-0030). Exposed so
   *  a second surface on this screen cannot derive "which day is it" a second
   *  way — Trends keyed two cards to two calendars once by doing exactly that. */
  boundary: DayBoundary;
  todayKey: DateKey;
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
  /** Omit `startedAt` to begin now; pass one to correct a running fast. */
  startFast: (startedAt?: Date) => Promise<void>;
  breakFast: () => Promise<void>;
  /** Consecutive logged-day streak ending today (or yesterday). */
  streak: number;
  /** Copy yesterday's food entries onto today (time-of-day preserved).
   *  Returns how many were copied. */
  repeatYesterday: () => Promise<number>;
  /** Numbers-only progress stats for the share card (streak, logged days,
   *  weight change). */
  shareStats: ShareStats;
  /** Days toward the first measured burn, or null once measured mode is
   *  open (core `measurementProgress`). The hero footer before maintenance. */
  measurement: MeasurementProgress | null;
  /** Whether a body weight has ever been recorded, from either source —
   *  `dailyWeights` or a weight riding on a `DailyLog`. Evidence for the
   *  `first-weigh-in` milestone; see the return site for why both count. */
  hasWeighIn: boolean;
  /** Whether a photo-scanned row is visible in the window this hook already
   *  holds. Evidence for `first-scan`, and SUFFICIENT ONLY — see the return
   *  site. */
  hasPhotoScan: boolean;
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
  /** Rows parked on disk by an offline add, not yet in Firestore. */
  const [pending, setPending] = useState<DailyLog[]>([]);

  // Focus-gated (not mount-gated): the tab detaches its Firestore listeners
  // when it blurs, so background tabs stop holding live onSnapshot channels
  // awake (battery/network). Re-subscribes from cache on refocus — no spinner
  // flash, because `useLedgerFeed` keys readiness to the ACCOUNT, not to the
  // subscription cycle. The eight `subscribe*` calls stay this hook's own
  // (ADR-0016); only the wiring around them is the feed's.
  const feed = useLedgerFeed({
    uid,
    label: 'Today',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            // Every slice below honours snapshot PROVENANCE, which the feed now
            // hands each `apply` rather than leaving to eight call sites to
            // remember. Firestore runs memory-only here (RN has no IndexedDB),
            // so an offline listener fires immediately with an EMPTY result
            // carrying `fromCache: true`. Treating that as real data discarded
            // the disk hydration, wrote the empty value through — poisoning the
            // cache for the next cold start — and then clobbered whatever had
            // already been painted. Measured on Train, which took three
            // publishes to get right; this is the same defect on the screen
            // `offline-cache.ts` was actually written for.
            feedChannel({
              key: 'logs',
              // Only a SERVER answer ends the spinner on its own; the disk
              // cache and `feed.failed` below cover the offline cases.
              settles: 'server',
              open: (deliver, fail) => subscribeRecentLogs(uid, LOG_WINDOW_ROWS, deliver, fail),
              apply: setLogs,
            }),
            feedChannel({
              key: 'profile',
              // Any answer settles it — see the `loading` note. Requiring a
              // server answer here would hang a cold-cache offline start.
              settles: 'any',
              open: (deliver) => subscribeProfile(uid, deliver),
              apply: setProfile,
            }),
            // The six below feed the screen but nothing waits on them, and none
            // wires `fail` — exactly as before, because a dropped weights
            // listener must not put Today into the error state that belongs to
            // the logs channel.
            feedChannel({
              key: 'weights',
              settles: 'none',
              open: (deliver) => subscribeDailyWeights(uid, deliver),
              apply: setWeights,
            }),
            feedChannel({
              key: 'presets',
              settles: 'none',
              open: (deliver) => subscribePresets(uid, deliver),
              apply: setPresets,
            }),
            feedChannel({
              key: 'customFoods',
              settles: 'none',
              open: (deliver) => subscribeCustomFoods(uid, deliver),
              apply: setCustomFoods,
            }),
            feedChannel({
              key: 'water',
              settles: 'none',
              open: (deliver) => subscribeDailyWater(uid, deliver),
              apply: setWaterMap,
            }),
            feedChannel({
              key: 'sleep',
              settles: 'none',
              open: (deliver) => subscribeDailySleep(uid, deliver),
              apply: setSleepMap,
            }),
            // Health-imported steps / active energy. Read-only here — the
            // device measures these and the app never writes them back.
            feedChannel({
              key: 'activity',
              settles: 'none',
              open: (deliver) => subscribeDailyActivity(uid, deliver),
              apply: setActivityMap,
            }),
          ]
        : [],
    deps: [uid],
  });
  const error = feed.error;

  // The rule lives in `today-gate.ts` — pure, dependency-free and tested there,
  // because it decides whether a user is shown someone else's calorie target.
  // Every clause is a bug that has actually happened; `isTodayLoading`'s doc
  // comment carries which, including why the profile half deliberately accepts a
  // cache-only answer where the logs half does not.
  const logsReady = feed.answered.logs || logsFromCache;
  const profileReady = feed.answered.profile || profileFromCache;
  const loading = isTodayLoading({ logsReady, profileReady, failed: feed.failed });

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
  // The hero footer before measured mode opens: how many of the 14 logged
  // days the estimator needs are there. Null once `targets.tdee` is measured,
  // so it hands the slot to `maintenanceView` on the same render. Counted
  // over the same rows and weights the targets are — one derivation, one
  // answer (2026-09-10, retention: the daily habit).
  const measurement = useMemo(
    () => measurementProgress(targets.tdee, logs, weights),
    [targets.tdee, logs, weights],
  );
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

  // The multi-row copy is `ledger-ops.repeatYesterday` — which day counts as
  // yesterday under the user's boundary, the rebuilt timestamps and the
  // count-once-per-use event are asserted there, not through a renderer. The
  // merged `logs` (live + parked) are handed down rather than re-read, so the
  // rows copied are exactly the rows the user is looking at.
  const repeatYesterday = useCallback(async () => {
    if (!uid) return 0;
    return repeatYesterdayOp(uid, logs, boundary);
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
  // Write, then mirror to Health — one operation (`ledger-ops.writeDailyMetric`)
  // rather than the three hand-written copies these two and Body's weigh-in
  // used to be. Neither counts an analytics event, which is why neither passes
  // one.
  const setWater = useCallback(
    async (flOz: number) => {
      if (!uid) return;
      await writeDailyMetric(uid, 'water', todayKey, flOz);
    },
    [uid, todayKey],
  );
  const setSleep = useCallback(
    async (hours: number) => {
      if (!uid) return;
      await writeDailyMetric(uid, 'sleep', todayKey, hours);
    },
    [uid, todayKey],
  );
  /**
   * Start a fast, or CORRECT the start of the one already running.
   *
   * `startedAt` is the whole of ADR-0032 decision 3's first item: the adapters
   * have always accepted it and no UI ever passed one, so a fast begun an hour
   * late could never be fixed. Writing the same field again is what a
   * correction IS — the running fast is one scalar on the profile, not a
   * document — so there is no separate update path and no second verb.
   */
  const startFast = useCallback(async (startedAt?: Date) => {
    if (uid) await startFastDoc(uid, startedAt);
  }, [uid]);
  const breakFast = useCallback(async () => {
    if (uid) await breakFastDoc(uid);
  }, [uid]);

  return {
    loading,
    error,
    summary,
    targets,
    // Exposed so Today can open a day-scoped fasting editor without deriving
    // the boundary a second time — two derivations of "which day is it" on one
    // screen is how Trends ended up keying two cards to two calendars.
    boundary,
    todayKey,
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
    measurement,
    /**
     * Whether this account has ever recorded a body weight — the evidence for
     * the `first-weigh-in` milestone.
     *
     * Both sources count. `dailyWeights` is where the weigh-in sheet writes,
     * but a weight can also ride on a `DailyLog` (the workout-finish mirror
     * does exactly that), and a milestone that ignored the second would tell a
     * lifter who has weighed in for months that they never have.
     */
    hasWeighIn:
      Object.keys(weights).length > 0 || logs.some((l) => l.weight != null),
    /**
     * A photo-scanned row inside the window this hook already subscribes — the
     * RECOVERY half of the `first-scan` award (#109).
     *
     * The primary award happens at the write (`lib/first-scan.ts`), which is
     * where `earnedAt` can be honest. This exists for the one case that cannot
     * reach: the milestone write failing after the meal succeeded — the signal
     * dropping in the seconds between the two. It costs **nothing**: `logs` is
     * already here, and the pending overlay is already merged into it, so a
     * scan parked offline counts before it has reached Firestore.
     *
     * **Sufficient, never necessary, and that asymmetry is deliberate.**
     * `subscribeRecentLogs` is a bounded rolling window (ADR-0004 — the three
     * windows are typed and mixing them is a documented footgun), so `false`
     * means "no scan in the last `LOG_WINDOW_ROWS` rows", NOT "never scanned".
     * Reading it as a lifetime answer is exactly the mistake `meals-100` is
     * still parked on. It only ever ADDS a candidate; `newlyEarned` and the
     * write-once rule decide whether anything is recorded, and nothing here can
     * take a milestone away.
     */
    hasPhotoScan: logs.some((l) => l.source === 'photo'),
  };
}
