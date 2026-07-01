import { useCallback, useEffect, useMemo, useState } from 'react';
import { type CustomFood, type DailyLog, type DaySummary, type LogEntry, type MealPreset, customFoodDocId, localDateKey, summarizeDays } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import {
  addCustomFood as addCustomFoodDoc,
  addLog as addLogDoc,
  addPreset as addPresetDoc,
  deleteCustomFood as deleteCustomFoodDoc,
  deleteLog as deleteLogDoc,
  deletePreset as deletePresetDoc,
  subscribeCustomFoods,
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
  /** User's saved food library (My Foods, ADR-0013) for the day-detail sheet. */
  customFoods: CustomFood[];
  /** Add a food entry (its timestamp determines which day it lands on). */
  addEntry: (entry: LogEntry) => Promise<void>;
  updateEntry: (id: string, entry: LogEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addPreset: (preset: Omit<MealPreset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  addCustomFood: (food: Omit<CustomFood, 'id'>) => Promise<void>;
  deleteCustomFood: (id: string) => Promise<void>;
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
        LOG_WINDOW,
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

  const addEntry = useCallback(async (entry: LogEntry) => { if (uid) await addLogDoc(uid, entry); }, [uid]);
  const updateEntry = useCallback(async (id: string, entry: LogEntry) => { if (uid) await updateLogDoc(uid, id, entry); }, [uid]);
  const deleteEntry = useCallback(async (id: string) => { if (uid) await deleteLogDoc(uid, id); }, [uid]);
  const addPreset = useCallback(async (preset: Omit<MealPreset, 'id'>) => { if (uid) await addPresetDoc(uid, preset); }, [uid]);
  const deletePreset = useCallback(async (id: string) => { if (uid) await deletePresetDoc(uid, id); }, [uid]);
  const addCustomFood = useCallback(async (food: Omit<CustomFood, 'id'>) => { if (uid) await addCustomFoodDoc(uid, food, customFoodDocId(food)); }, [uid]);
  const deleteCustomFood = useCallback(async (id: string) => { if (uid) await deleteCustomFoodDoc(uid, id); }, [uid]);

  return { loading, error, days, logs, weights, presets, customFoods, addEntry, updateEntry, deleteEntry, addPreset, deletePreset, addCustomFood, deleteCustomFood };
}
