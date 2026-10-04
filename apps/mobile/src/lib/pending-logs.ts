import {
  type DailyLog,
  type LogEntry,
  type PendingLog,
  buildPendingLog,
  newLedgerId,
  withDefaultMealSlot,
} from '@macrolog/core';
import { isOffline } from './connectivity';
import { addLogWithId, deleteLog } from './ledger';
import {
  dropPendingLogs,
  parkPendingLog,
  readPendingLogs,
  isUndoneId,
  replacePendingLog,
  reviveUndoneId,
  withWriteDeadline,
} from './quick-add';

/**
 * The in-app half of the durable write queue.
 *
 * ADR-0020 built this queue for the glanceable surfaces, where a tap has no
 * screen to report back to. The same machinery is what an ordinary `EntrySheet`
 * save needs, for a reason that is easy to miss: **the Expo app has no Firestore
 * persistence** (`offline-cache.ts`). The JS SDK holds an unacknowledged write in
 * memory and lands it whenever the socket returns — but only while the process
 * lives. Kill the app on the train, and a meal the user watched appear in their
 * list is gone with no trace and no error. That is silent data loss on the
 * app's primary action.
 *
 * So every add goes to disk first-class: minted id, bounded attempt, parked on
 * failure, flushed on the next foreground by the same `flushPendingLogs` the
 * widget uses. One queue, not two — see {@link parkPendingLog}.
 *
 * ## Edits and deletes of a PARKED row
 *
 * A row still on disk has no server doc to patch, so an edit rewrites it in the
 * queue (`editParkedLog`) and a delete drops it (`dropPendingLogs`). Edits and
 * deletes of rows that already landed are ordinary SDK writes: the SDK holds
 * them and lands them if the session survives, and they are never queued here —
 * a patch against a server document would need a merge policy this queue's
 * `setDoc`-of-known-bytes model deliberately does not have.
 */

/**
 * How long to wait before deciding a write is not going to land.
 *
 * Two values because the cost of waiting is not symmetric. When connectivity is
 * already known bad, the user is standing there holding a phone and a fast
 * "saved, will sync" beats a spinner that is not going anywhere. When it looks
 * fine, a slow write is usually just slow, and parking early would be harmless
 * but pointless churn.
 *
 * Parking early is *safe* either way — the id is minted up front, so a write
 * that lands after we gave up on it is overwritten by identical bytes on flush.
 */
const OFFLINE_DEADLINE_MS = 1500;
const ONLINE_DEADLINE_MS = 8000;

/** Whether a save reached the ledger or is waiting on disk. The difference is
 *  the whole content of the receipt the user gets. */
export type WriteOutcome = 'logged' | 'queued';

/** Re-exported so consumers have one import for the queue. The emitter lives in
 *  its own module to keep `quick-add.ts` — which also fires it, from the flush —
 *  out of a require cycle with this file. */
export { onPendingLogsChanged } from './pending-logs-events';
/** Re-exported for the same reason: the one import for the queue. */
export { dropPendingLogs } from './quick-add';

/**
 * Add one log row, durably.
 *
 * Never throws: the caller is a sheet's save button, and the two outcomes are
 * both successes from the user's point of view. A genuine rejection — rules
 * refusing the shape, a signed-out uid — parks too, and the flush's own retry
 * plus the TTL are what eventually drop it. That is the right trade for a food
 * log: a meal held for a week and dropped is a worse outcome than a meal shown
 * as saved, but it is a far better one than a meal that vanishes at the moment
 * of saving.
 */
export async function addLogDurably(
  uid: string,
  entry: LogEntry,
  /** Minted by the caller when it needs the id back — the add receipt's Undo
   *  deletes by it. Defaults to a fresh one. */
  id: string = newLedgerId(Math.random),
): Promise<WriteOutcome> {
  const at = entry.timestamp ?? new Date();
  // Applied here rather than inherited from `addLog`: this path writes through
  // `addLogWithId`, which is the id-carrying primitive and deliberately does not
  // guess a slot. Without this line an offline add would file into `other` while
  // the identical online add filed into lunch.
  const withSlot = withDefaultMealSlot(entry, at);
  // A write at an id the user once undid (the Undo of a delete) is the newer
  // intent; it must not be treated as undone by a flush already in flight.
  reviveUndoneId(id);
  const deadline = isOffline() ? OFFLINE_DEADLINE_MS : ONLINE_DEADLINE_MS;
  try {
    await withWriteDeadline(addLogWithId(uid, id, withSlot), deadline);
    return 'logged';
  } catch {
    // Undone while this write waited out its deadline: parking it now would
    // bring back the row the user just removed.
    if (isUndoneId(id)) return 'queued';
    await parkPendingLog(buildPendingLog(id, uid, withSlot, at.getTime()));
    return 'queued';
  }
}

/**
 * Apply an edit to a row that is still parked offline. Resolves with the entry
 * as it will land — the edit, plus what the sheet never sends but the row must
 * keep (its `source`: a photo-scanned meal edited offline would otherwise land
 * as a typed one and lose its first-scan evidence) — when the row was parked;
 * null when it is not on disk and the server doc should be patched instead.
 * The queue carries the note too, so the flush lands the edit whole.
 */
export async function editParkedLog(uid: string, id: string, entry: LogEntry): Promise<LogEntry | null> {
  const parked = (await readPendingLogs()).find((p) => p.id === id && p.uid === uid);
  if (!parked) return null;
  const at = entry.timestamp ?? new Date(parked.atMs);
  const merged: LogEntry = withDefaultMealSlot(
    { ...entry, ...(entry.source ?? parked.source ? { source: entry.source ?? parked.source } : {}) },
    at,
  );
  const ok = await replacePendingLog(id, buildPendingLog(id, uid, merged, at.getTime()));
  return ok ? { ...merged, timestamp: at } : null;
}

/**
 * Reverse adds, wherever they got to: drop them from the queue if they parked
 * (one write for the whole set — see `dropPendingLogs`), and delete the server
 * docs in case they landed, or land later from a write that outlived its
 * deadline (a delete of a missing doc is a no-op). The server half is not
 * awaited: offline the SDK holds the deletes like any other write.
 */
export async function undoAdds(uid: string, ids: readonly string[]): Promise<void> {
  await dropPendingLogs(ids);
  for (const id of ids) {
    void deleteLog(uid, id).catch(() => {
      /* Offline or already gone — the overlay drop above is what the user sees. */
    });
  }
}

/** One-id form of {@link undoAdds}. */
export function undoAdd(uid: string, id: string): Promise<void> {
  return undoAdds(uid, [id]);
}

/**
 * The parked rows for one account, as domain rows the day view can render.
 *
 * Rendering them is not cosmetic. Cold-start offline and the read cache paints
 * the last session's day — which does not contain the meal just logged, because
 * that meal never reached Firestore and so was never cached. Without the
 * overlay the user watches their entry disappear on relaunch and logs it twice.
 *
 * Ids match what the flush will write, so when the real row arrives the dedupe
 * in `useToday` collapses the pair with no flicker and no double count.
 */
export async function pendingLogsAsRows(uid: string): Promise<DailyLog[]> {
  const all = await readPendingLogs();
  return all.filter((p) => p.uid === uid).map(toRow);
}

function toRow(p: PendingLog): DailyLog {
  return {
    id: p.id,
    date: new Date(p.atMs),
    calories: p.calories,
    ...(p.protein != null ? { protein: p.protein } : {}),
    ...(p.carbs != null ? { carbs: p.carbs } : {}),
    ...(p.fat != null ? { fat: p.fat } : {}),
    ...(p.mealLabel ? { mealLabel: p.mealLabel } : {}),
    ...(p.mealType ? { mealType: p.mealType } : {}),
    // Carried into the overlay row, not just onto the wire: Today reads the
    // merged window for the `first-scan` evidence, and a parked scan that
    // rendered without its provenance would be invisible to it for exactly as
    // long as the device is offline — the one window where the award-at-write
    // has already failed.
    ...(p.source ? { source: p.source } : {}),
    ...(p.note ? { note: p.note } : {}),
  };
}
