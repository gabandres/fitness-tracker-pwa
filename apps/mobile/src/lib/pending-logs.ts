import {
  type DailyLog,
  type LogEntry,
  type PendingLog,
  buildPendingLog,
  newLedgerId,
  withDefaultMealSlot,
} from '@macrolog/core';
import { isOffline } from './connectivity';
import { addLogWithId } from './ledger';
import { parkPendingLog, readPendingLogs, withWriteDeadline } from './quick-add';

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
 * ## What this does NOT cover, and why
 *
 * **Edits and deletes.** They are patches against a server document, so a parked
 * one has to be reconciled rather than replayed: a delete of a row that never
 * landed, or an edit racing an edit from the PWA, needs a merge policy this
 * queue's `setDoc`-of-known-bytes model deliberately does not have. Offline they
 * behave as they always have — the SDK holds them and lands them if the session
 * survives. Adds are the overwhelming majority of offline writes and the only
 * ones that lose *new* information, which is why they are what this buys.
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
export async function addLogDurably(uid: string, entry: LogEntry): Promise<WriteOutcome> {
  const at = entry.timestamp ?? new Date();
  // Applied here rather than inherited from `addLog`: this path writes through
  // `addLogWithId`, which is the id-carrying primitive and deliberately does not
  // guess a slot. Without this line an offline add would file into `other` while
  // the identical online add filed into lunch.
  const withSlot = withDefaultMealSlot(entry, at);
  const id = newLedgerId(Math.random);
  const deadline = isOffline() ? OFFLINE_DEADLINE_MS : ONLINE_DEADLINE_MS;
  try {
    await withWriteDeadline(addLogWithId(uid, id, withSlot), deadline);
    return 'logged';
  } catch {
    await parkPendingLog(buildPendingLog(id, uid, withSlot, at.getTime()));
    return 'queued';
  }
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
  };
}
