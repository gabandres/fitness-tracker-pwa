import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type CustomFood, type DailyLog, type DaySummary, type MealPreset, type DayBoundary, type DateKey, dayBoundaryOf, dayKeyAt, LOG_WINDOW_ROWS, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useCachedState } from '@/hooks/useCachedState';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
import { asError, feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { mergeLogs, monthRange, monthToFetch, oldestLogKey } from '@/lib/history-paging';
import {
  getLogsForRange,
  subscribeCustomFoods,
  subscribeDailyWeights,
  subscribePresets,
  subscribeRecentLogs,
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
  /** Saved quick-add presets (for the day-detail add sheet). */
  presets: MealPreset[];
  /** User's saved food library (My Foods, ADR-0013) for the day-detail sheet. */
  customFoods: CustomFood[];
  /** The day boundary in force (ADR-0030). Surfaced here rather than re-derived
   *  per screen so the calendar and the day detail cannot disagree about which
   *  day a 00:30 meal belongs to. Empty ⇒ calendar days. */
  boundary: DayBoundary;
  /**
   * Make sure the month containing `view` is on screen. A no-op when the window
   * already covers it, when the window is not full (everything is loaded), or
   * when that month was already requested — so a screen may call it from an
   * effect on every view change. ONE bounded `getDocs` per month, never a
   * listener; the rows are held in this hook's state for its lifetime.
   */
  ensureMonthLoaded: (view: Date) => void;
  olderMonths: OlderMonths;
}

const EMPTY_MONTHS: Record<string, DailyLog[]> = Object.freeze({}) as Record<string, DailyLog[]>;

export function useHistory(): HistoryState {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  // The window and the weights are the SAME queries Today caches to disk, so
  // they hydrate the same slices: a cold open paints the last session's
  // calendar at once and the live snapshot replaces it (`offline-cache.ts`).
  // The other two feed the day-detail add sheet and were never waited on.
  const [windowLogs, setLogs, logsFromCache] = useCachedState<DailyLog[]>(uid, 'logs', []);
  const [weights, setWeights] = useCachedState<Record<string, number>>(uid, 'weights', {});
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
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
  // Component state on purpose: it lives and dies with the screen, so paging
  // back and forth re-queries nothing while the screen is up, and nothing
  // accumulates past it. Not a shared cache and not a listener (ADR-0016).
  // Keyed to the ACCOUNT the way `useLedgerFeed` keys readiness: a different
  // uid reads as empty rather than being cleared in an effect a frame later.
  const [fetchedRaw, setFetched] = useState<{ uid: string | undefined; months: Record<string, DailyLog[]> }>(
    () => ({ uid, months: {} }),
  );
  const fetched = fetchedRaw.uid === uid ? fetchedRaw.months : EMPTY_MONTHS;
  const [inFlight, setInFlight] = useState(0);
  const [olderError, setOlderError] = useState<Error | null>(null);
  /** Months requested this mount — in flight or done. Both count. */
  const requested = useRef<{ uid: string | undefined; months: Set<string> }>({ uid, months: new Set() });
  if (requested.current.uid !== uid) requested.current = { uid, months: new Set() };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const oldestWindowKey = useMemo(() => oldestLogKey(windowLogs, boundary), [windowLogs, boundary]);
  const windowRows = windowLogs.length;

  const ensureMonthLoaded = useCallback(
    (view: Date) => {
      if (!uid) return;
      const month = monthToFetch({ view, oldestWindowKey, windowRows, requested: requested.current.months });
      if (!month) return;
      requested.current.months.add(month);
      const { fromKey, toKey } = monthRange(month);
      setInFlight((n) => n + 1);
      getLogsForRange(uid, fromKey as DateKey, toKey as DateKey, boundary)
        .then((rows) => {
          if (!alive.current) return;
          setFetched((f) => ({
            uid,
            months: { ...(f.uid === uid ? f.months : {}), [month]: rows },
          }));
          setOlderError(null);
        })
        .catch((e: unknown) => {
          if (!alive.current) return;
          // Let a retry happen: the month is no longer "requested".
          requested.current.months.delete(month);
          setOlderError(asError(e, 'History: older month fetch failed'));
        })
        .finally(() => {
          if (alive.current) setInFlight((n) => n - 1);
        });
    },
    [uid, oldestWindowKey, windowRows, boundary],
  );

  const logs = useMemo(() => mergeLogs(windowLogs, fetched), [windowLogs, fetched]);

  const days = useMemo(() => {
    const keys = new Set<string>();
    for (const l of logs) keys.add(dayKeyAt(l.date, boundary));
    for (const k of Object.keys(weights)) keys.add(k);
    const sorted = [...keys].sort().reverse(); // newest first
    return summarizeDays(sorted, logs, weights, boundary);
  }, [logs, weights, boundary]);

  const writes = useLogWrites();

  return {
    loading,
    error,
    days,
    logs,
    weights,
    presets,
    customFoods,
    boundary,
    ensureMonthLoaded,
    olderMonths: { loading: inFlight > 0, error: olderError },
    ...writes,
  };
}
