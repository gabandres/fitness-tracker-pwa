import { useEffect, useMemo, useState } from 'react';
import { type CustomFood, type DailyLog, type DaySummary, type MealPreset, localDateKey, LOG_WINDOW_ROWS, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { type LogWrites, useLogWrites } from '@/hooks/useLogWrites';
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
}

export function useHistory(): HistoryState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [presets, setPresets] = useState<MealPreset[]>([]);
  const [customFoods, setCustomFoods] = useState<CustomFood[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubs = [
      subscribeRecentLogs(
        uid,
        LOG_WINDOW_ROWS,
        (l) => {
          setLogs(l);
          setLoading(false);
        },
        setError,
      ),
      subscribeDailyWeights(uid, setWeights, setError),
      subscribePresets(uid, setPresets, setError),
      subscribeCustomFoods(uid, setCustomFoods, setError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const days = useMemo(() => {
    const keys = new Set<string>();
    for (const l of logs) keys.add(localDateKey(l.date));
    for (const k of Object.keys(weights)) keys.add(k);
    const sorted = [...keys].sort().reverse(); // newest first
    return summarizeDays(sorted, logs, weights);
  }, [logs, weights]);

  const writes = useLogWrites();

  return { loading, error, days, logs, weights, presets, customFoods, ...writes };
}
