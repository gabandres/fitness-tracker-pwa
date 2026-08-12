import { useEffect, useState } from 'react';

/**
 * Whether the app can currently reach Firestore — derived from the SDK itself.
 *
 * ## Why not a network library
 *
 * `@react-native-community/netinfo` and `expo-network` both carry native code,
 * and native code moves the `runtimeVersion` fingerprint (`AGENTS.md`), which
 * turns a JS-only fix into a store build for every platform. It would also
 * answer the wrong question: "the radio has an IP address" is not "Firestore is
 * reachable", and captive-portal wifi is exactly the case a food log meets in a
 * hotel or a gym.
 *
 * Firestore already knows. Every snapshot carries `metadata.fromCache`, which is
 * true precisely when the SDK is serving from its own memory because the backend
 * is unreachable. `subscribeRecentLogs` reports it here; this module turns that
 * stream of booleans into one debounced flag with listeners.
 *
 * ## Two deliberate biases
 *
 * **Slow to claim offline** ({@link OFFLINE_AFTER_MS}). The first snapshot of any
 * new listener is `fromCache: true` for a moment before the server responds, so
 * reacting instantly would flash an offline banner on every tab focus. Nothing
 * is lost by waiting: a genuinely offline session stays offline.
 *
 * **Fast to claim online, and it forgets.** One server-backed snapshot clears the
 * flag immediately. And because only a *focused* Today feeds this — ADR-0016
 * detaches listeners on blur — a report that stops arriving means "nobody is
 * looking", not "the network died". After {@link STALE_AFTER_MS} with no report
 * the flag decays to online. A banner that wrongly says *offline* is worse than
 * one that wrongly says nothing: it tells a user with a working connection that
 * their meals are not saving, which is a support ticket and a bad review.
 */

/** How long snapshots must keep coming from cache before the UI says so. */
const OFFLINE_AFTER_MS = 4000;

/** How long an unrefreshed verdict is trusted. Past this it decays to online —
 *  see the module header for why the bias runs that way. */
const STALE_AFTER_MS = 30_000;

type Listener = (offline: boolean) => void;

const listeners = new Set<Listener>();
let offline = false;
let confirmTimer: ReturnType<typeof setTimeout> | null = null;
let decayTimer: ReturnType<typeof setTimeout> | null = null;

function publish(next: boolean): void {
  if (next === offline) return;
  offline = next;
  for (const l of listeners) l(next);
}

function clearTimers(): void {
  if (confirmTimer) {
    clearTimeout(confirmTimer);
    confirmTimer = null;
  }
  if (decayTimer) {
    clearTimeout(decayTimer);
    decayTimer = null;
  }
}

/**
 * Feed one snapshot's `metadata.fromCache` in. Called from the ledger adapter,
 * which is the only place that holds a Firestore snapshot.
 */
export function reportSnapshotMeta(fromCache: boolean): void {
  if (decayTimer) clearTimeout(decayTimer);
  decayTimer = setTimeout(() => publish(false), STALE_AFTER_MS);

  if (!fromCache) {
    if (confirmTimer) {
      clearTimeout(confirmTimer);
      confirmTimer = null;
    }
    publish(false);
    return;
  }
  // Already offline, or already counting down to saying so — nothing to restart,
  // or the countdown would never finish on a query that re-fires every second.
  if (offline || confirmTimer) return;
  confirmTimer = setTimeout(() => {
    confirmTimer = null;
    publish(true);
  }, OFFLINE_AFTER_MS);
}

/** The current verdict, for non-React callers (the write path asks before it
 *  decides how long to wait for a write). */
export function isOffline(): boolean {
  return offline;
}

/** Subscribe. Returns an unsubscribe. */
export function onConnectivityChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Reset to the cold-start state. Sign-out only — and tests. */
export function resetConnectivity(): void {
  clearTimers();
  offline = false;
}

/** React binding for {@link isOffline}. */
export function useIsOffline(): boolean {
  const [value, setValue] = useState(offline);
  useEffect(() => {
    setValue(offline);
    return onConnectivityChange(setValue);
  }, []);
  return value;
}
