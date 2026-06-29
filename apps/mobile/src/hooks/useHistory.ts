import { useEffect, useMemo, useState } from 'react';
import { type DailyLog, type DaySummary, localDateKey, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeRecentLogs } from '@/lib/ledger';

const LOG_WINDOW = 400;

export interface HistoryState {
  loading: boolean;
  error: Error | null;
  /** One summary per day that has any food log or weigh-in, newest first. */
  days: DaySummary[];
  logs: DailyLog[];
  weights: Record<string, number>;
}

export function useHistory(): HistoryState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
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

  return { loading, error, days, logs, weights };
}
