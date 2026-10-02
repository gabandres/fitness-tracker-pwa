import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WorkoutSession } from './workout';

/**
 * A durable copy of the in-progress workout, on the device.
 *
 * ## Why this exists (2026-10-02)
 *
 * The owner logged RIR 0 on every set of two 10-01 Push Day lifts (Incline
 * Dumbbell Press, Chest Dip) and three 09-29 Leg Day lifts, and Firestore holds
 * **no `rir` key** on any of those sets — while the same sessions stored `rir: 0`
 * on every other lift. It is never one set: it is every set of whole exercises,
 * in the middle of a session, with later exercises intact.
 *
 * Nothing in a live process can do that. The reducer, `toSessionPatch`,
 * `pruneUndefined` and the reader all keep 0 (`set-zero-roundtrip.test.ts`), and
 * `firestore.rules` does not look inside `exercises`, so no write is rejected
 * over a set's contents. What CAN do it is a restart of the JS runtime while
 * those writes are still unacknowledged:
 *
 *  1. The React Native Firestore SDK keeps unsent writes **in memory only** (no
 *     persistent cache on RN). On a weak gym connection a run of set edits sits
 *     in that queue for minutes.
 *  2. The runtime restarts. `useAutoApplyOta` calls `Updates.reloadAsync()` on
 *     the first foreground after an update downloads, and a workout took no
 *     `ota-hold` (only the photo scan did); iOS also kills a backgrounded app
 *     under memory pressure. Either way the queue is gone.
 *  3. Train mounts, loads the session from the server — which never heard of
 *     those edits — and the very next set edit writes the WHOLE `exercises`
 *     array back, making the loss permanent and invisible.
 *
 * Which is why it is intermittent and per-exercise: it needs a restart while
 * a stretch of edits is still queued, and RIR is usually the last thing
 * entered for a lift.
 *
 * ## What this does
 *
 * Every change to the active session is written here, synchronously with the
 * state change and BEFORE the Firestore write. On load, {@link reconcileActiveSession}
 * prefers this copy over the server's when it is the newer of the two, and the
 * hook writes it back so the server converges. AsyncStorage survives both a
 * `reloadAsync` and a process death; the SDK's queue survives neither.
 *
 * Same shape of answer `pending-logs.ts` gave food adds (ADR-0020), for the
 * same reason.
 */

const KEY_PREFIX = 'ignia.activeSession.v1.';
const keyFor = (uid: string) => `${KEY_PREFIX}${uid}`;

export interface JournalEntry {
  /** Device clock when this copy was taken. Compared with the server doc's
   *  `updatedAt`, which `toSessionPatch` stamps from the SAME device clock. */
  savedAt: number;
  session: WorkoutSession;
}

/** Dates round-trip as `{ $d: ms }`: `JSON.stringify` would turn them into
 *  strings that nothing downstream expects. `this[key]` is read because a
 *  Date's `toJSON` has already run by the time the replacer sees `value`. */
function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw = this[key];
  return raw instanceof Date ? { $d: raw.getTime() } : value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    if (typeof o.$d === 'number' && Object.keys(o).length === 1) return new Date(o.$d);
  }
  return value;
}

export function encodeJournal(entry: JournalEntry): string {
  return JSON.stringify(entry, replacer);
}

export function decodeJournal(raw: string | null): JournalEntry | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw, reviver) as JournalEntry;
    if (typeof parsed?.savedAt !== 'number' || !parsed.session?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Record the session as it is now. Only an ACTIVE session with an id is
 * journaled — a reopened completed session is edited in place and has its
 * own Cancel snapshot. Never throws: a failed journal write must not break
 * logging, it only loses the safety net for that one edit.
 */
export async function journalActiveSession(
  uid: string,
  session: WorkoutSession,
  now: number = Date.now(),
): Promise<void> {
  if (!session.id || session.status !== 'active') return;
  try {
    await AsyncStorage.setItem(keyFor(uid), encodeJournal({ savedAt: now, session }));
  } catch {
    // Storage full or unavailable: Firestore is still written as before.
  }
}

export async function readActiveSessionJournal(uid: string): Promise<JournalEntry | null> {
  try {
    return decodeJournal(await AsyncStorage.getItem(keyFor(uid)));
  } catch {
    return null;
  }
}

/** Drop the journal — after a finish or discard has LANDED, not before. */
export async function clearActiveSessionJournal(uid: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(uid));
  } catch {
    // A stale journal is harmless: it only applies to a session with the same
    // id that is still active on the server and older than it.
  }
}

/**
 * Which copy of the active session the screen should show, and whether the
 * server needs to be told.
 *
 * - No active session on the server → none. The journal is never used to
 *   resurrect a session that was finished or discarded (or that an offline
 *   cache simply cannot see yet); it is left in place, not deleted, so a
 *   later load that does see the session can still use it.
 * - A different session id → the server's. The journal belongs to another
 *   workout.
 * - Same id, journal strictly newer than the server's last write → the
 *   journal's, and `resync` so the lost edits are written back.
 * - Otherwise the server's: it already has everything this device wrote, or a
 *   later write from somewhere else.
 *
 * Pure, so the rule is testable without storage or a network.
 */
export function reconcileActiveSession(
  server: WorkoutSession | null,
  journal: JournalEntry | null,
): { session: WorkoutSession | null; resync: boolean } {
  if (!server) return { session: null, resync: false };
  if (!journal || journal.session.id !== server.id) return { session: server, resync: false };
  const serverAt = server.updatedAt instanceof Date ? server.updatedAt.getTime() : 0;
  if (journal.savedAt > serverAt) {
    // The status stays the server's: the journal only ever holds an active
    // session, and the server saying `active` is the precondition here.
    return { session: { ...journal.session, status: server.status }, resync: true };
  }
  return { session: server, resync: false };
}
