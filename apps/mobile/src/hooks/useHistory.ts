import { useCallback, useEffect, useMemo, useState } from 'react';
import { type DailyLog, type DaySummary, type LogEntry, type MealPreset, localDateKey, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  addLog as addLogDoc,
  addPreset as addPresetDoc,
  deleteLog as deleteLogDoc,
  deletePreset as deletePresetDoc,
  subscribeDailyWeights,
  subscribePresets,
  subscribeRecentLogs,
  updateLog as updateLogDoc,
} from '@/lib/ledger';

const LOG_WINDOW = 400;

export interface HistoryState {
  loading: boolean;
  error: Error | null;
  /** One summary per day that has any food log or weigh-in, newest first. */
  days: DaySummary[];
  logs: DailyLog[];
  weights: Record<string, number>;
  /** Saved quick-add presets (for the day-detail add sheet). */
  presets: MealPreset[];
  /** Add a food entry (its timestamp determines which day it lands on). */
  addEntry: (entry: LogEntry) => Promise<void>;
  updateEntry: (id: string, entry: LogEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addPreset: (preset: Omit<MealPreset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
}

export function useHistory(): HistoryState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [presets, setPresets] = useState<MealPreset[]>([]);
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
      subscribePresets(uid, setPresets, setError),
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

  const addEntry = useCallback(async (entry: LogEntry) => { if (uid) await addLogDoc(uid, entry); }, [uid]);
  const updateEntry = useCallback(async (id: string, entry: LogEntry) => { if (uid) await updateLogDoc(uid, id, entry); }, [uid]);
  const deleteEntry = useCallback(async (id: string) => { if (uid) await deleteLogDoc(uid, id); }, [uid]);
  const addPreset = useCallback(async (preset: Omit<MealPreset, 'id'>) => { if (uid) await addPresetDoc(uid, preset); }, [uid]);
  const deletePreset = useCallback(async (id: string) => { if (uid) await deletePresetDoc(uid, id); }, [uid]);

  return { loading, error, days, logs, weights, presets, addEntry, updateEntry, deleteEntry, addPreset, deletePreset };
}
