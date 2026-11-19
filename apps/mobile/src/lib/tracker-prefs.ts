import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';

/**
 * Which secondary trackers Today shows (2026-11-19, activation work).
 *
 * Production said a new user's Today opened with five secondary trackers and
 * nothing pointing at the one thing they had to do. These switches let a user
 * hide what they don't use, and a NEW account starts with the three least
 * common ones off. Hiding a row deletes nothing — it is a view preference.
 *
 * Device-local like the reminder prefs (`lib/reminders.ts`), keyed by account
 * so a second account on the same phone starts from its own state. An account
 * with nothing stored sees every row, exactly as before this file existed —
 * which is what every existing user has.
 */

export type TrackerKey = 'fasting' | 'water' | 'sleep' | 'hunger' | 'dayLogged';
export type TrackerPrefs = Record<TrackerKey, boolean>;

/** The order Today and Settings list them in. */
export const TRACKER_KEYS: readonly TrackerKey[] = ['fasting', 'water', 'sleep', 'hunger', 'dayLogged'];

export const ALL_TRACKERS_ON: TrackerPrefs = Object.freeze({
  fasting: true,
  water: true,
  sleep: true,
  hunger: true,
  dayLogged: true,
});

export const NEW_ACCOUNT_TRACKERS: TrackerPrefs = Object.freeze({
  fasting: false,
  water: true,
  sleep: true,
  hunger: false,
  dayLogged: false,
});

export function trackerPrefsKey(uid: string): string {
  return `trackerPrefs.v1.${uid}`;
}

/**
 * A stored blob → prefs. Anything missing, unknown or not a boolean reads as
 * ON: the failure direction is "shows a row", never "hides a row the user
 * never chose to hide". Null when nothing usable is stored.
 */
export function parseTrackerPrefs(raw: string | null | undefined): TrackerPrefs | null {
  if (raw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  return mergeTrackerPrefs(parsed as Partial<Record<string, unknown>>);
}

/** Overlay a partial (possibly untyped) object on {@link ALL_TRACKERS_ON}. */
export function mergeTrackerPrefs(partial: Partial<Record<string, unknown>>): TrackerPrefs {
  const out = { ...ALL_TRACKERS_ON };
  for (const k of TRACKER_KEYS) {
    if (typeof partial[k] === 'boolean') out[k] = partial[k] as boolean;
  }
  return out;
}

/** True when no tracker row would render. */
export function allTrackersOff(prefs: TrackerPrefs): boolean {
  return TRACKER_KEYS.every((k) => !prefs[k]);
}

/** Stored prefs for this account on this device, or ALL_TRACKERS_ON when
 *  nothing is stored (or storage fails). */
export async function loadTrackerPrefs(uid: string): Promise<TrackerPrefs> {
  try {
    return parseTrackerPrefs(await AsyncStorage.getItem(trackerPrefsKey(uid))) ?? { ...ALL_TRACKERS_ON };
  } catch {
    return { ...ALL_TRACKERS_ON };
  }
}

export async function saveTrackerPrefs(uid: string, prefs: TrackerPrefs): Promise<void> {
  const next = mergeTrackerPrefs(prefs);
  await AsyncStorage.setItem(trackerPrefsKey(uid), JSON.stringify(next));
  publish(uid, next);
}

/** First-run only: writes NEW_ACCOUNT_TRACKERS if and only if nothing is
 *  stored yet. Never overwrites. Never throws. */
export async function initTrackerPrefsForNewAccount(uid: string): Promise<void> {
  try {
    const existing = await AsyncStorage.getItem(trackerPrefsKey(uid));
    if (existing != null) return;
    await AsyncStorage.setItem(trackerPrefsKey(uid), JSON.stringify(NEW_ACCOUNT_TRACKERS));
    publish(uid, { ...NEW_ACCOUNT_TRACKERS });
  } catch {
    // Storage failing leaves the account on "everything shows" — the
    // existing-user behaviour, which is the safe one.
  }
}

// ─── Live store: every mounted consumer sees one value per account ─────────

const cache = new Map<string, TrackerPrefs>();
const listeners = new Set<(uid: string, prefs: TrackerPrefs) => void>();

function publish(uid: string, prefs: TrackerPrefs): void {
  cache.set(uid, prefs);
  for (const l of listeners) l(uid, prefs);
}

/** Test seam: forget the in-memory cache. */
export function __resetTrackerPrefsCache(): void {
  cache.clear();
}

/** Live prefs for the signed-in user; `ready` false until the first read.
 *  Updates every mounted consumer when `setTracker` is called. */
export function useTrackerPrefs(): {
  prefs: TrackerPrefs;
  ready: boolean;
  setTracker: (key: TrackerKey, on: boolean) => void;
} {
  const { user } = useAuth();
  const uid = user?.uid;
  const [state, setState] = useState<{ uid: string | undefined; prefs: TrackerPrefs | null }>(() => ({
    uid,
    prefs: uid ? cache.get(uid) ?? null : null,
  }));

  useEffect(() => {
    if (!uid) return;
    let alive = true;
    const onChange = (changed: string, prefs: TrackerPrefs) => {
      if (alive && changed === uid) setState({ uid, prefs });
    };
    listeners.add(onChange);
    const cached = cache.get(uid);
    if (cached) setState({ uid, prefs: cached });
    else {
      void loadTrackerPrefs(uid).then((prefs) => {
        if (!alive) return;
        // A write that landed while the read was in flight wins.
        const now = cache.get(uid) ?? prefs;
        cache.set(uid, now);
        setState({ uid, prefs: now });
      });
    }
    return () => {
      alive = false;
      listeners.delete(onChange);
    };
  }, [uid]);

  const setTracker = useCallback(
    (key: TrackerKey, on: boolean) => {
      if (!uid) return;
      const base = cache.get(uid) ?? ALL_TRACKERS_ON;
      const next = { ...base, [key]: on };
      // Optimistic: every consumer moves now; a failed write keeps the switch
      // honest for this session and is retried by the next toggle.
      publish(uid, next);
      void AsyncStorage.setItem(trackerPrefsKey(uid), JSON.stringify(next)).catch(() => undefined);
    },
    [uid],
  );

  const current = state.uid === uid ? state.prefs : null;
  return { prefs: current ?? ALL_TRACKERS_ON, ready: !!uid && current != null, setTracker };
}
