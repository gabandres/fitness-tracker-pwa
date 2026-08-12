/**
 * "The parked queue changed" — its own module purely to break a cycle.
 *
 * Both halves of the queue need to announce a change: `quick-add.ts` owns the
 * store and the flush, `pending-logs.ts` owns the in-app park and the overlay
 * that renders it. Putting the emitter in either one makes the other import it
 * back, and a require cycle in a file the Android widget task handler loads at
 * module scope is not a risk worth taking for two functions.
 */

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
