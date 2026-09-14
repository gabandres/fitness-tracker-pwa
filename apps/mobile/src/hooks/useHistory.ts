import { useMemo, useState } from 'react';
import { type CustomFood, type DailyLog, type DaySummary, type MealPreset, type DayBoundary, dayBoundaryOf, dayKeyAt, LOG_WINDOW_ROWS, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import {
  subscribeCustomFoods,
  subscribeDailyWeights,
  subscribePresets,
  subscribeRecentLogs,
} from '@/lib/ledger';


/** Reads are this hook's own (ADR-0016); the writes are the shared set every
 *  logging surface uses — `addEntry`'s timestamp still determines which day
 *  the row lands on, and now also which slot. */
export interface HistoryState extends LogWrites {
  loading: boolean;
  error: Error | null;
  /** One summary per day that has any food log or weigh-in, newest first. */
  days: DaySummary[];
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
}

export function useHistory(): HistoryState {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
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
  const loading = !feed.answered.logs;
  const error = feed.error;

  // ADR-0030. `profile` comes off the auth context, which is already
  // subscribed app-wide — reading it here adds no listener, so this does not
  // break the per-hook subscription model (ADR-0016).
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);

  const days = useMemo(() => {
    const keys = new Set<string>();
    for (const l of logs) keys.add(dayKeyAt(l.date, boundary));
    for (const k of Object.keys(weights)) keys.add(k);
    const sorted = [...keys].sort().reverse(); // newest first
    return summarizeDays(sorted, logs, weights, boundary);
  }, [logs, weights, boundary]);

  const writes = useLogWrites();

  return { loading, error, days, logs, weights, presets, customFoods, boundary, ...writes };
}
