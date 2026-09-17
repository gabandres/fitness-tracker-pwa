/**
 * "Is a workout open right now?" — readable from any tab, without a second
 * Firestore listener.
 *
 * ## The gap this closes
 *
 * A live session was visible only from the Train tab. Nothing in the tab bar
 * said so, and the raised coral Log button actively pulls you to Today
 * mid-workout (to log a shake), from where the open session is invisible. Hevy
 * and Strong both keep a persistent in-progress affordance for exactly this.
 *
 * ## Why a signal and not a shared subscription
 *
 * [ADR-0016](../../../docs/adr/0016-mobile-per-hook-subscriptions-intentional.md)
 * says reading hooks own their own `onSnapshot` calls and the duplication is
 * intentional. This is **not** a shared subscription cache and must not grow
 * into one: it opens no listener, holds no documents, and is written by
 * exactly one producer (`useTrain`'s `setActive`). It is a single boolean plus
 * a name — the minimum a tab bar needs to draw a dot.
 *
 * ## Why it is persisted
 *
 * `useTrain` only mounts once the Train tab has been visited. Without a cached
 * value, the one case that matters most — quitting the app mid-workout and
 * reopening it on Today — would show no dot at all. The cached value is a
 * HINT: `useTrain` overwrites it with the truth the moment Train loads, and
 * every write is uid-scoped so signing into another account cannot inherit it.
 *
 * Storage failures are swallowed on purpose. A missing dot is a cosmetic loss;
 * a crashed tab bar is not.
 */
import { useSyncExternalStore } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface ActiveWorkoutSignal {
  active: boolean;
  /** The source template's name, when the session came from one. */
  name: string | null;
}

const EMPTY: ActiveWorkoutSignal = { active: false, name: null };

let current: ActiveWorkoutSignal = EMPTY;
let listeners: (() => void)[] = [];

const keyFor = (uid: string) => `activeWorkout:${uid}`;

function emit(next: ActiveWorkoutSignal) {
  // Same object identity for an unchanged value, or `useSyncExternalStore`
  // re-renders every tab on every set that is logged.
  if (next.active === current.active && next.name === current.name) return;
  current = next;
  for (const l of listeners) l();
}

/** Called by `useTrain` whenever the active session changes. `uid` scopes the
 *  cached copy; pass `null` when signed out, which clears the signal. */
export function publishActiveWorkout(
  uid: string | undefined,
  session: { templateName?: string } | null,
): void {
  const next: ActiveWorkoutSignal = session
    ? { active: true, name: session.templateName ?? null }
    : EMPTY;
  emit(next);
  if (!uid) return;
  const k = keyFor(uid);
  const write = session
    ? AsyncStorage.setItem(k, JSON.stringify(next))
    : AsyncStorage.removeItem(k);
  void write.catch(() => {});
}

/** Restore the cached hint at app start, before Train has ever mounted. Never
 *  overwrites a signal `useTrain` has already published — the live value is
 *  always the truth, and a slow disk read must not resurrect a finished
 *  workout. */
export async function hydrateActiveWorkout(uid: string | undefined): Promise<void> {
  if (!uid || current.active) return;
  try {
    const raw = await AsyncStorage.getItem(keyFor(uid));
    if (!raw || current.active) return;
    const parsed = JSON.parse(raw) as ActiveWorkoutSignal;
    if (parsed?.active) emit({ active: true, name: parsed.name ?? null });
  } catch {
    // Unreadable or malformed cache: no dot. See the module docstring.
  }
}

function subscribe(onChange: () => void): () => void {
  listeners.push(onChange);
  return () => {
    listeners = listeners.filter((l) => l !== onChange);
  };
}

const snapshot = () => current;

/** Read the signal. Returns a stable object while nothing changes. */
export function useActiveWorkout(): ActiveWorkoutSignal {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** Test seam — resets module state between cases. */
export function __resetActiveWorkoutSignal(): void {
  current = EMPTY;
  listeners = [];
}
