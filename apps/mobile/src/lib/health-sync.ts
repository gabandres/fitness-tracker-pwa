import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { type HealthKind, reduceImportedSamples, valuesToApply } from '@macrolog/core';
import { getHealthScalarsOnce, setDailySleep, setDailyWater, setDailyWeight } from './ledger';
import { health, type NutritionExport, type ReadableKind, type WorkoutExport } from './health';

/**
 * Health sync orchestration — the glue between the pure `health-mapping` brain,
 * the native `health` adapter, and the Firestore `ledger`.
 *
 * Import (Health → app): read each two-way kind, fold to one value/day
 * (`reduceImportedSamples`), keep only days that differ from the app's current
 * value (`valuesToApply`), write those to Firestore. Idempotent — our own
 * exports are dropped on read (`fromUs`) and unchanged days are skipped.
 *
 * Export (app → Health): thin guarded wrappers the log/weight/workout paths
 * call fire-and-forget; a Health failure never fails the Firestore write.
 *
 * "Connected" is a device preference (AsyncStorage), not user data — it never
 * goes to Firestore. All native calls are `tsc`-verified only; QA needs a build.
 */

const CONNECTED_KEY = 'ignia.health.connected';
/** First-import history depth — matches `LOG_WINDOW` so measured-mode TDEE
 *  benefits from imported weight immediately. */
const IMPORT_DAYS = 400;

/** Per-kind "already equal" tolerance for `valuesToApply` — unit round-trips
 *  and the ledger's own rounding (½-hour sleep, whole fl oz) aren't exact. */
const EPSILON: Record<ReadableKind, number> = { weight: 0.05, sleep: 0.25, water: 1 };

/** Firestore writer per readable kind (all share the `(uid, dateKey, value)`
 *  shape; each clamps/rounds to its own canonical unit). */
const WRITER: Record<ReadableKind, (uid: string, dateKey: string, value: number) => Promise<void>> = {
  weight: setDailyWeight,
  sleep: setDailySleep,
  water: setDailyWater,
};

let connectedCache: boolean | null = null;

export async function isHealthConnected(): Promise<boolean> {
  if (connectedCache != null) return connectedCache;
  connectedCache = (await AsyncStorage.getItem(CONNECTED_KEY)) === '1';
  return connectedCache;
}

async function setConnectedFlag(v: boolean): Promise<void> {
  connectedCache = v;
  await AsyncStorage.setItem(CONNECTED_KEY, v ? '1' : '0');
}

/** Prompt for OS health permissions; persist "connected" only if granted. */
export async function connectHealth(): Promise<boolean> {
  const ok = await health.requestPermissions();
  if (ok) await setConnectedFlag(true);
  return ok;
}

export async function disconnectHealth(): Promise<void> {
  await setConnectedFlag(false);
}

let importing = false;

/**
 * Pull weight + sleep + water from the OS health store into Firestore. Returns
 * the number of day-values written. No-op (returns 0) when disconnected or when
 * an import is already in flight (guard against overlapping app-open + Sync-now).
 */
export async function importHealth(uid: string): Promise<number> {
  if (importing || !uid || !(await isHealthConnected())) return 0;
  importing = true;
  try {
    const current = await getHealthScalarsOnce(uid);
    let applied = 0;
    for (const kind of ['weight', 'sleep', 'water'] as ReadableKind[]) {
      const samples = await health.readSamples(kind, IMPORT_DAYS);
      const reduced = reduceImportedSamples(samples);
      const toApply = valuesToApply(reduced, current[kind], EPSILON[kind]);
      for (const [dateKey, value] of Object.entries(toApply)) {
        await WRITER[kind](uid, dateKey, value);
        applied++;
      }
    }
    return applied;
  } finally {
    importing = false;
  }
}

// ── Export wrappers — guarded + swallow (never fail the Firestore write) ──

export async function exportDaily(kind: HealthKind, dateKey: string, value: number): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeDaily(kind, dateKey, value);
  } catch {
    /* Health write is best-effort; the Firestore write already succeeded. */
  }
}

export async function exportNutrition(entry: NutritionExport): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeNutrition(entry);
  } catch {
    /* best-effort */
  }
}

export async function exportWorkout(w: WorkoutExport): Promise<void> {
  try {
    if (await isHealthConnected()) await health.writeWorkout(w);
  } catch {
    /* best-effort */
  }
}

// ── Hooks ──

/**
 * Settings control surface: availability + connection state, connect/disconnect,
 * and a manual "Sync now". Connecting runs an immediate import so the user sees
 * their Health weight land right away.
 */
export function useHealthSync(uid: string | undefined) {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => {
    let alive = true;
    void health.isAvailable().then((a) => alive && setAvailable(a));
    void isHealthConnected().then((c) => alive && setConnected(c));
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    const ok = await connectHealth();
    setConnected(ok);
    if (ok && uid) {
      setSyncing(true);
      try {
        await importHealth(uid);
      } finally {
        setSyncing(false);
      }
    }
    return ok;
  }, [uid]);

  const disconnect = useCallback(async () => {
    await disconnectHealth();
    setConnected(false);
  }, []);

  const syncNow = useCallback(async () => {
    if (!uid) return 0;
    setSyncing(true);
    try {
      return await importHealth(uid);
    } finally {
      setSyncing(false);
    }
  }, [uid]);

  return { available, connected, syncing, connect, disconnect, syncNow };
}

/**
 * App-shell auto-import: pull from Health once on mount and whenever the app
 * returns to the foreground (guarded/no-op when disconnected). Mount once high
 * in the authed tree so a fresh scale reading shows up without opening Settings.
 */
export function useHealthAutoImport(uid: string | undefined): void {
  useEffect(() => {
    if (!uid) return;
    void importHealth(uid);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void importHealth(uid);
    });
    return () => sub.remove();
  }, [uid]);
}
