import { useCallback, useMemo, useState } from 'react';
import { type CustomFood, type DailyLog, type DaySummary, type MealPreset, type DayBoundary, type DateKey, dayBoundaryOf, dayKeyAt, LOG_WINDOW_ROWS, summarizeDays, trainedDayRows } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import type { WorkoutSession } from '@/lib/workout';
import { useCachedState } from '@/hooks/useCachedState';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { mergeLogs, monthRange, monthToWatch, oldestLogKey } from '@/lib/history-paging';
import {
  subscribeCustomFoods,
  subscribeDailyWeights,
  subscribeLogsForRange,
  subscribePresets,
  subscribeRecentLogs,
  subscribeRecentSessions,
  subscribeDailyLogged,
} from '@/lib/ledger';


/** The on-demand read behind the 400-row window (UX_AUDIT S18-13). */
export interface OlderMonths {
  /** A month fetch is in flight. */
  loading: boolean;
  /** The last month fetch failed; the calendar says so where it used to say
   *  "older days aren't loaded". */
  error: Error | null;
}

/** Reads are this hook's own (ADR-0016); the writes are the shared set every
 *  logging surface uses — `addEntry`'s timestamp still determines which day
 *  the row lands on, and now also which slot. */
export interface HistoryState extends LogWrites {
  loading: boolean;
  error: Error | null;
  /** One summary per day that has any food log or weigh-in, newest first. */
  days: DaySummary[];
  /** The 400-row window PLUS every older month this screen has fetched, oldest
   *  first and deduplicated (`history-paging.ts`). */
  logs: DailyLog[];
  weights: Record<string, number>;
  /** "Day fully logged?" answers, `dateKey → complete` — the day screen's
   *  replayed target reads them as Today's does (2026-10-24). */
  dayComplete: Record<string, boolean>;
  /** Saved quick-add presets (for the day-detail add sheet). */
  presets: MealPreset[];
  /** User's saved food library (My Foods, ADR-0013) for the day-detail sheet. */
  customFoods: CustomFood[];
  /** The day boundary in force (ADR-0030). Surfaced here rather than re-derived
   *  per screen so the calendar and the day detail cannot disagree about which
   *  day a 00:30 meal belongs to. Empty ⇒ calendar days. */
  boundary: DayBoundary;
  /**
   * Make sure the month containing `view` is on screen. Nothing is read when
   * the window already covers it or is not full (everything is loaded); an
   * older month gets ONE bounded range listener while it is the viewed month
   * on a focused screen (2026-10-15 — a kept one-shot read went stale). Safe to
   * call from an effect on every view change.
   */
  ensureMonthLoaded: (view: Date) => void;
  olderMonths: OlderMonths;
}

const EMPTY_MONTHS: Record<string, DailyLog[]> = Object.freeze({}) as Record<string, DailyLog[]>;

/** Sessions read for History's trained days. */
const HISTORY_SESSIONS = 200;

export function useHistory(): HistoryState {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  // The window and the weights are the SAME queries Today caches to disk, so
  // they hydrate the same slices: a cold open paints the last session's
  // calendar at once and the live snapshot replaces it (`offline-cache.ts`).
  // The other two feed the day-detail add sheet and were never waited on.
  const [windowLogs, setLogs, logsFromCache] = useCachedState<DailyLog[]>(uid, 'logs', []);
  const [weights, setWeights] = useCachedState<Record<string, number>>(uid, 'weights', {});
  const [dayComplete, setDayComplete] = useCachedState<Record<string, boolean>>(uid, 'dayLogged', {});
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
  // Finished workouts, for each day's "trained" (core `trainedDayRows`): a
  // finish no longer writes a marker row into `dailyLogs` (2026-10-15, owner
  // bug C). The newest HISTORY_SESSIONS cover the calendar a user pages
  // through; older trained days still show wherever an old marker exists.
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  // MOUNT-gated, not focus-gated, and left that way on purpose: nothing in the
  // code shows the choice to be a bug, so the migration to `useLedgerFeed`
  // states it (`gate: 'mount'`) rather than quietly upgrading it. What the feed
  // does add here is the `trackSubs` wrapping this hook never had — four
  // listeners that the dev counter could not see were four it could not blame.
  const feed = useLedgerFeed({
    uid,
    label: 'History',
    gate: 'mount',
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'logs',
              open: (deliver, fail) => subscribeRecentLogs(uid, LOG_WINDOW_ROWS, deliver, fail),
              apply: setLogs,
            }),
            // The other three feed the calendar but the spinner has never
            // waited on them — a day with weights and no logs still needs the
            // rows to know which days exist.
            feedChannel({
              key: 'weights',
              settles: 'none',
              open: (deliver, fail) => subscribeDailyWeights(uid, deliver, fail),
              apply: setWeights,
            }),
            feedChannel({
              key: 'presets',
              settles: 'none',
              open: (deliver, fail) => subscribePresets(uid, deliver, fail),
              apply: setPresets,
            }),
            feedChannel({
              key: 'customFoods',
              settles: 'none',
              open: (deliver, fail) => subscribeCustomFoods(uid, deliver, fail),
              apply: setCustomFoods,
            }),
            feedChannel({
              key: 'sessions',
              settles: 'none',
              open: (deliver, fail) => subscribeRecentSessions(uid, HISTORY_SESSIONS, deliver, fail),
              apply: setSessions,
            }),
            feedChannel({
              key: 'dayComplete',
              settles: 'none',
              // No `fail`: a missing answer map is the 1,000 kcal rule alone,
              // which is a correct target — not an error for this screen.
              open: (deliver) => subscribeDailyLogged(uid, deliver),
              apply: setDayComplete,
            }),
          ]
        : [],
    deps: [uid],
  });
  // A disk paint ends the spinner as a server answer does; a failed feed ends
  // it too, so the error line can render instead of a spinner that never stops.
  const loading = !feed.failed && !(feed.answered.logs || logsFromCache);
  const error = feed.error;

  // ADR-0030. `profile` comes off the auth context, which is already
  // subscribed app-wide — reading it here adds no listener, so this does not
  // break the per-hook subscription model (ADR-0016).
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);

  // ── Older months (S18-13) ───────────────────────────────────────
  // The month on screen, when it lies behind the window, is a focus-gated
  // LISTENER (2026-10-15 audit). It was one `getDocs` kept for the screen's
  // life, so an add or delete on an old day — made from the day-detail route,
  // which mounts its own `useHistory` — never reached the calendar's copy.
  // Months viewed before stay in `fetched` as the last copy seen, which paints
  // a re-view at once while its listener re-opens; only the viewed month is
  // live, so this is one bounded listener at most (ADR-0016). Keyed to the
  // ACCOUNT the way `useLedgerFeed` keys readiness: a different uid reads as
  // empty rather than being cleared in an effect a frame later.
  const [fetchedRaw, setFetched] = useState<{ uid: string | undefined; months: Record<string, DailyLog[]> }>(
    () => ({ uid, months: {} }),
  );
  const fetched = fetchedRaw.uid === uid ? fetchedRaw.months : EMPTY_MONTHS;
  const [watchRaw, setWatch] = useState<{ uid: string | undefined; month: string | null }>(() => ({ uid, month: null }));
  const watched = watchRaw.uid === uid ? watchRaw.month : null;

  const oldestWindowKey = useMemo(() => oldestLogKey(windowLogs, boundary), [windowLogs, boundary]);
  const windowRows = windowLogs.length;

  const ensureMonthLoaded = useCallback(
    (view: Date) => {
      if (!uid) return;
      const month = monthToWatch({ view, oldestWindowKey, windowRows });
      setWatch((w) => (w.uid === uid && w.month === month ? w : { uid, month }));
    },
    [uid, oldestWindowKey, windowRows],
  );

  const monthFeed = useLedgerFeed({
    uid,
    label: 'History month',
    gate: 'focus',
    // A refocus is a retry: a failed month must not stay failed for the
    // screen's life.
    retryOnOpen: true,
    channels: () => {
      if (!uid || !watched) return [];
      const { fromKey, toKey } = monthRange(watched);
      return [
        feedChannel({
          key: 'month',
          open: (deliver, fail) =>
            subscribeLogsForRange(uid, fromKey as DateKey, toKey as DateKey, boundary, deliver, fail),
          apply: (rows: DailyLog[]) =>
            setFetched((f) => ({ uid, months: { ...(f.uid === uid ? f.months : {}), [watched]: rows } })),
        }),
      ];
    },
    deps: [uid, watched, boundary],
  });
  const olderLoading = watched != null && !(watched in fetched) && !monthFeed.failed;

  const logs = useMemo(() => mergeLogs(windowLogs, fetched), [windowLogs, fetched]);

  const days = useMemo(() => {
    const trained = trainedDayRows(sessions);
    const rows = trained.length ? [...logs, ...trained] : logs;
    const keys = new Set<string>();
    for (const l of rows) keys.add(dayKeyAt(l.date, boundary));
    for (const k of Object.keys(weights)) keys.add(k);
    const sorted = [...keys].sort().reverse(); // newest first
    return summarizeDays(sorted, rows, weights, boundary);
  }, [logs, sessions, weights, boundary]);

  const writes = useLogWrites();

  return {
    loading,
    error,
    days,
    logs,
    weights,
    dayComplete,
    presets,
    customFoods,
    boundary,
    ensureMonthLoaded,
    olderMonths: { loading: olderLoading, error: monthFeed.error },
    ...writes,
  };
}
