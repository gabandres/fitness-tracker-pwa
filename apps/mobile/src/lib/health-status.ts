import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

/**
 * The Health integration's evidence: is it on, when did it last run, and how
 * much came back.
 *
 * Connected apps promised all three in its header ("both get the same
 * evidence: is it on, when did it last run, what came back") and delivered
 * only the first for Health — `useHealthSync` never tracked a run, so the
 * Health card could not say whether the import had ever done anything (Body
 * review, bug 14). Body wants the same two facts for its footer ("Weight syncs
 * from Apple Health · 9:41").
 *
 * ## Why its own module
 *
 * `health-sync.ts` reaches the native health adapter and the Firestore ledger,
 * and the jest setup mocks it wholesale. These are two AsyncStorage keys and a
 * listener set — a screen that only wants to SAY something about Health must
 * not import the machinery that DOES it. `health-sync.ts` writes here; screens
 * read here.
 *
 * Device-local, like the connected flag itself: which phone imported what is a
 * property of the phone's health store, not of the account.
 */

/** The connected flag's storage key. Owned here so the screen-facing reader
 *  and `health-sync.ts`'s writer cannot drift onto two names. */
export const HEALTH_CONNECTED_KEY = 'ignia.health.connected';
const LAST_SYNC_KEY = 'ignia.health.lastSync.v1';

export interface HealthLastSync {
  /** Epoch ms the last import FINISHED. */
  atMs: number;
  /** Day-values plus workout sessions it wrote. 0 is a real answer: it ran
   *  and everything already matched. */
  count: number;
}

export interface HealthStatus {
  connected: boolean;
  lastSync: HealthLastSync | null;
}

type Listener = (s: HealthStatus) => void;
const listeners = new Set<Listener>();
let current: HealthStatus | null = null;

async function load(): Promise<HealthStatus> {
  try {
    const [connected, raw] = await Promise.all([
      AsyncStorage.getItem(HEALTH_CONNECTED_KEY),
      AsyncStorage.getItem(LAST_SYNC_KEY),
    ]);
    const parsed = raw ? (JSON.parse(raw) as Partial<HealthLastSync>) : null;
    const lastSync =
      parsed && Number.isFinite(parsed.atMs) && Number.isFinite(parsed.count)
        ? { atMs: Number(parsed.atMs), count: Number(parsed.count) }
        : null;
    return { connected: connected === '1', lastSync };
  } catch {
    return { connected: false, lastSync: null };
  }
}

function emit(next: HealthStatus): void {
  current = next;
  for (const l of listeners) l(next);
}

/** Read the status once (cached after the first read). Never throws. */
export async function readHealthStatus(): Promise<HealthStatus> {
  if (current) return current;
  const loaded = await load();
  current ??= loaded;
  return current;
}

/** Called by `health-sync.ts` after every import that ran to completion. */
export async function recordHealthSync(count: number, atMs: number = Date.now()): Promise<void> {
  const base = await readHealthStatus();
  const lastSync = { atMs, count };
  emit({ ...base, lastSync });
  try {
    await AsyncStorage.setItem(LAST_SYNC_KEY, JSON.stringify(lastSync));
  } catch {
    /* The in-memory value still answers for this session. */
  }
}

/** Called by `health-sync.ts` when the connected flag flips, so a screen
 *  already showing the footer updates without a remount. */
export async function noteHealthConnected(connected: boolean): Promise<void> {
  const base = await readHealthStatus();
  emit({ ...base, connected });
}

/** Live status for a screen. `null` until the first read lands. */
export function useHealthStatus(): HealthStatus | null {
  const [status, setStatus] = useState<HealthStatus | null>(current);
  useEffect(() => {
    let alive = true;
    void readHealthStatus().then((s) => alive && setStatus(s));
    listeners.add(setStatus);
    return () => {
      alive = false;
      listeners.delete(setStatus);
    };
  }, []);
  return status;
}
