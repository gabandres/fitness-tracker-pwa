import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DailyLog, currentWeight as coreCurrentWeight, localDateKey } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { setDailyWeight, subscribeDailyWeights, subscribeRecentLogs } from '@/lib/ledger';

export interface WeighIn {
  dateKey: string;
  weight: number;
}

export interface BodyState {
  loading: boolean;
  error: Error | null;
  /** Most recent weight (daily weights first, then log weights). */
  currentWeight: number | null;
  /** Today's logged weight, or null if not weighed in today. */
  todayWeight: number | null;
  /** All weigh-ins, newest first. */
  weighIns: WeighIn[];
  setWeight: (weight: number, dateKey?: string) => Promise<void>;
}

export function useBody(): BodyState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubs = [
      subscribeDailyWeights(
        uid,
        (w) => {
          setWeights(w);
          setLoading(false);
        },
        setError,
      ),
      subscribeRecentLogs(uid, 400, setLogs, setError),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const todayKey = localDateKey(new Date());
  const weighIns = useMemo<WeighIn[]>(
    () =>
      Object.entries(weights)
        .map(([dateKey, weight]) => ({ dateKey, weight }))
        .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)),
    [weights],
  );

  const setWeight = useCallback(
    async (weight: number, dateKey?: string) => {
      if (uid) await setDailyWeight(uid, dateKey ?? todayKey, weight);
    },
    [uid, todayKey],
  );

  return {
    loading,
    error,
    currentWeight: coreCurrentWeight(logs, weights),
    todayWeight: weights[todayKey] ?? null,
    weighIns,
    setWeight,
  };
}
