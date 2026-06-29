import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type DailyTargets,
  type DaySummary,
  type LogEntry,
  type Profile,
  dailyTargets,
  localDateKey,
  summarizeDay,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  addLog as addLogDoc,
  deleteLog as deleteLogDoc,
  subscribeDailyWeights,
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
  addEntry: (entry: LogEntry) => Promise<void>;
  updateEntry: (id: string, entry: LogEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
}

export function useToday(): TodayState {
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

  return { loading, error, summary, targets, todayLogs, addEntry, updateEntry, deleteEntry };
}
