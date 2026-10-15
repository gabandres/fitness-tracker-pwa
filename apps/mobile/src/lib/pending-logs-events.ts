/**
 * "The parked queue changed" — its own module purely to break a cycle.
 *
 * Both halves of the queue need to announce a change: `quick-add.ts` owns the
 * store and the flush, `pending-logs.ts` owns the in-app park and the overlay
 * that renders it. Putting the emitter in either one makes the other import it
 * back, and a require cycle in a file the Android widget task handler loads at
 * module scope is not a risk worth taking for two functions.
 */

import type { PendingLog } from '@macrolog/core';

type Listener = () => void;

const listeners = new Set<Listener>();

/** Subscribe to park/flush events. Returns an unsubscribe. */
export function onPendingLogsChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Announce that the queue's contents may have changed. Safe to over-call —
 *  every listener's response is one small AsyncStorage read. */
export function notifyPendingLogsChanged(): void {
  for (const l of listeners) l();
}

/**
 * "A parked row was REFUSED on flush and dropped" (audit #21). The rules
 * answer the same bytes the same way forever, so keeping such a row only
 * counted it on Today for the queue's 7-day TTL and then lost it in silence.
 * The flush drops it and announces the rows here; Today says it was not
 * saved (the S20 "rejected" copy).
 */
type RejectedListener = (rows: readonly PendingLog[]) => void;
const rejectedListeners = new Set<RejectedListener>();

export function onPendingLogsRejected(fn: RejectedListener): () => void {
  rejectedListeners.add(fn);
  return () => {
    rejectedListeners.delete(fn);
  };
}

export function notifyPendingLogsRejected(rows: readonly PendingLog[]): void {
  if (rows.length === 0) return;
  for (const l of rejectedListeners) l(rows);
}
