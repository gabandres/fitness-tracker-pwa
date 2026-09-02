import { useCallback } from 'react';
import {
  type CustomFood,
  type LogEntry,
  type MealPreset,
  customFoodDocId,
} from '@macrolog/core';
import { exportNutrition } from '@/lib/health-sync';
import { useAuth } from '@/lib/auth';
import { addLogDurably } from '@/lib/pending-logs';
import { track } from '@/lib/analytics';
import { takeLogTimerSecs } from '@/lib/log-timer';
import {
  addCustomFood as addCustomFoodDoc,
  addPreset as addPresetDoc,
  deleteCustomFood as deleteCustomFoodDoc,
  deleteLog as deleteLogDoc,
  deletePreset as deletePresetDoc,
  updateLog as updateLogDoc,
} from '@/lib/ledger';

/**
 * The write half of a logging tab.
 *
 * `useToday` and `useHistory` are separate hooks on purpose — each owns its own
 * `onSnapshot` subscriptions and ADR-0016 says to keep it that way. But the
 * READ side is what that decision is about. The write side was duplicated
 * verbatim between them and then drifted: Today's `addEntry` grew a meal-slot
 * default and an Apple Health mirror, History's stayed a bare pass-through, so
 * the same meal behaved differently depending on which screen it was added
 * from.
 *
 * These seven verbs hold no state and open no listeners, so sharing them
 * costs nothing the ADR was protecting and removes the surface the drift
 * happened on. The slot default itself lives one level lower still, at the
 * ledger write (`addLog`), where even a caller that never touches this hook
 * gets it.
 */
export interface LogWrites {
  addEntry: (entry: LogEntry) => Promise<void>;
  updateEntry: (id: string, entry: LogEntry) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
  addPreset: (preset: Omit<MealPreset, 'id'>) => Promise<void>;
  deletePreset: (id: string) => Promise<void>;
  /** Save a food to the library. Barcode-sourced foods de-dup at their barcode
   *  doc id via `customFoodDocId`; others auto-id. */
  addCustomFood: (food: Omit<CustomFood, 'id'>) => Promise<void>;
  deleteCustomFood: (id: string) => Promise<void>;
}

export function useLogWrites(): LogWrites {
  const { user } = useAuth();
  const uid = user?.uid;

  const addEntry = useCallback(
    async (entry: LogEntry) => {
      if (!uid) return;
      // Durable: parked on disk if it cannot reach Firestore, because this app
      // has no SDK persistence and an in-memory write dies with the process.
      // See `pending-logs.ts` — edits and deletes below are deliberately not
      // covered, and that file says why.
      const outcome = await addLogDurably(uid, entry);
      // Two counters, not one: `log_queued_offline` is the health signal that
      // says how often the durable path is actually load-bearing. If it is near
      // zero the queue is insurance; if it is not, connectivity is a product
      // problem and the numbers say so.
      track(outcome === 'queued' ? 'log_queued_offline' : 'log_added');
      // Seconds since the logging surface opened (`lib/log-timer.ts`), the
      // numerator of seconds-per-log. Taken on every add so a multi-item scan
      // restarts the clock per item; recorded only against a `log_added`, so
      // the server's `log_secs / log_added` divides like with like.
      const secs = takeLogTimerSecs();
      if (outcome !== 'queued' && secs > 0) track('log_secs', secs);
      // Mirror the meal's macros to Health at the entry's own time (skip
      // weight-only / marker rows). A back-dated add therefore lands on the
      // day it is for, in Health as well as in the ledger. Runs for a queued
      // write too: Health is a local store, so it is reachable when Firestore
      // is not, and the meal was genuinely eaten either way.
      if (entry.calories > 0) {
        void exportNutrition({
          at: entry.timestamp ?? new Date(),
          kcal: entry.calories,
          protein: entry.protein,
          carbs: entry.carbs,
          fat: entry.fat,
        });
      }
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

  const addPreset = useCallback(
    async (preset: Omit<MealPreset, 'id'>) => {
      if (uid) await addPresetDoc(uid, preset);
    },
    [uid],
  );

  const deletePreset = useCallback(
    async (id: string) => {
      if (uid) await deletePresetDoc(uid, id);
    },
    [uid],
  );

  const addCustomFood = useCallback(
    async (food: Omit<CustomFood, 'id'>) => {
      if (uid) await addCustomFoodDoc(uid, food, customFoodDocId(food));
    },
    [uid],
  );

  const deleteCustomFood = useCallback(
    async (id: string) => {
      if (uid) await deleteCustomFoodDoc(uid, id);
    },
    [uid],
  );

  return {
    addEntry,
    updateEntry,
    deleteEntry,
    addPreset,
    deletePreset,
    addCustomFood,
    deleteCustomFood,
  };
}
