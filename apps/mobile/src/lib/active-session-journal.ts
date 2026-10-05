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
  /**
   * Whether the server is known to have the session's document — its create
   * was acknowledged, or the session was read back from the server.
   *
   * `false` only for a session started on this device whose create has not
   * landed yet (2026-10-04: a start no longer waits on the network). A restart
   * in that window loses the create with the SDK's memory queue, so "the
   * server has no such session" stops meaning "it was finished or discarded"
   * and starts meaning "it was never sent" — and the journal is then the only
   * copy there is. Absent on entries written before the field existed, which
   * read as `true`: those sessions were all created before they were journaled.
   */
  created?: boolean;
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
  opts: { created?: boolean } = {},
): Promise<void> {
  if (!session.id || session.status !== 'active') return;
  const entry: JournalEntry = { savedAt: now, session };
  if (opts.created === false) entry.created = false;
  try {
    await AsyncStorage.setItem(keyFor(uid), encodeJournal(entry));
  } catch {
    // Storage full or unavailable: Firestore is still written as before.
  }
}

/**
 * The journal write, debounced.
 *
 * `useTrain` used to call {@link journalActiveSession} on EVERY change to the
 * session — which, with deferred per-keystroke edits, is an AsyncStorage write
 * per digit typed. Coalescing them into one write per `delayMs` of quiet
 * costs at most that much of the newest edits on a hard kill, which is the
 * trade the review asked for; the moments that matter are flushed explicitly
 * (the tab blurring, the app backgrounding, a start, a finish), and a flush
 * writes synchronously enough that a reload which follows it reads it back.
 *
 * One writer per hook instance. `cancel` drops a pending write without
 * performing it — for a finish or discard, where writing the old session back
 * a moment later would resurrect it.
 */
export function createJournalWriter(delayMs = 500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: { uid: string; session: WorkoutSession; created?: boolean } | null = null;

  function flush(): Promise<void> {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const next = pending;
    pending = null;
    if (!next) return Promise.resolve();
    return journalActiveSession(next.uid, next.session, Date.now(), { created: next.created });
  }

  return {
    write(uid: string, session: WorkoutSession, created?: boolean): void {
      pending = { uid, session, created };
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), delayMs);
    },
    flush,
    cancel(): void {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}

export type JournalWriter = ReturnType<typeof createJournalWriter>;

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
 * - No active session on the server, and the server ANSWERED (`serverKnown`)
 *   and is known to have had the doc (`journal.created !== false`) → none.
 *   The journal is never used to resurrect a session that was finished or
 *   discarded; it is left in place, not deleted, so a later load that does see
 *   the session can still use it.
 * - No active session in a read that came from the memory cache, or that
 *   failed — offline, a cold start — → the journal's, and `recreate`. RN
 *   Firestore is memory-only, so an offline read after a restart is EMPTY, not
 *   authoritative; trusting it showed Start, and the lifter started a second
 *   workout over the one they were in (Train review bug 4, 2026-10-04).
 * - Same, for a session whose create never landed (`created: false`) → the
 *   journal's, and `recreate`, whatever the server says.
 * - A session the caller knows is already being finished (`finishing`) is
 *   never offered back as active — not from the journal, and not from a
 *   server that has not heard the finish yet.
 * - A different session id → the server's. The journal belongs to another
 *   workout.
 * - Same id, journal strictly newer than the server's last write → the
 *   journal's, and `resync` so the lost edits are written back.
 * - Otherwise the server's: it already has everything this device wrote, or a
 *   later write from somewhere else.
 *
 * `recreate` asks for the whole document to be written (`startSession` with
 * the id) rather than a patch — an update of a document the server never got
 * fails `not-found`.
 *
 * Pure, so the rule is testable without storage or a network.
 */
export function reconcileActiveSession(
  server: WorkoutSession | null,
  journal: JournalEntry | null,
  opts: { serverKnown?: boolean; finishing?: ReadonlySet<string> } = {},
): { session: WorkoutSession | null; resync: boolean; recreate: boolean } {
  const usable = journal && !opts.finishing?.has(journal.session.id ?? '') ? journal : null;
  // A session this device has finished is not active, whatever a server that
  // has not heard the finish yet still says.
  const live = server?.id && opts.finishing?.has(server.id) ? null : server;
  if (!live) {
    if (usable && (opts.serverKnown === false || usable.created === false)) {
      return { session: usable.session, resync: true, recreate: true };
    }
    return { session: null, resync: false, recreate: false };
  }
  if (!usable || usable.session.id !== live.id) return { session: live, resync: false, recreate: false };
  const serverAt = live.updatedAt instanceof Date ? live.updatedAt.getTime() : 0;
  if (usable.savedAt > serverAt) {
    // The status stays the server's: the journal only ever holds an active
    // session, and the server saying `active` is the precondition here.
    return { session: { ...usable.session, status: live.status }, resync: true, recreate: false };
  }
  return { session: live, resync: false, recreate: false };
}

// ─── Finishes that have not landed yet ──────────────────────────

/**
 * A finished workout the server has not acknowledged yet.
 *
 * Finish used to `await` the completed write before closing the sheet, and on
 * a gym's dead signal that write resolves only when the connection returns —
 * "Saving…" forever (Train review bug 2). It now completes on the device: the
 * session moves HERE, out of the active journal, the screen moves on, and the
 * write runs behind it. This list is what survives a restart in between, and
 * `useTrain` replays it on the next mount until each entry lands.
 *
 * A separate key from the active journal on purpose: the next workout can be
 * started — and journaled — before the last one's finish has been heard.
 */
export interface PendingFinish {
  savedAt: number;
  session: WorkoutSession;
  extras: { bodyweight?: number; sleepHours?: number };
}

const FINISH_PREFIX = 'ignia.pendingFinish.v1.';
const finishKeyFor = (uid: string) => `${FINISH_PREFIX}${uid}`;

function decodeFinishes(raw: string | null): PendingFinish[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw, reviver) as PendingFinish[];
    return Array.isArray(parsed)
      ? parsed.filter((p) => typeof p?.savedAt === 'number' && !!p.session?.id)
      : [];
  } catch {
    return [];
  }
}

export async function readPendingFinishes(uid: string): Promise<PendingFinish[]> {
  try {
    return decodeFinishes(await AsyncStorage.getItem(finishKeyFor(uid)));
  } catch {
    return [];
  }
}

async function writeFinishes(uid: string, list: PendingFinish[]): Promise<void> {
  // An empty list is REMOVED, not stored as `[]`: a finished, synced account
  // leaves nothing behind on the device.
  if (list.length === 0) await AsyncStorage.removeItem(finishKeyFor(uid));
  else await AsyncStorage.setItem(finishKeyFor(uid), JSON.stringify(list, replacer));
}

/** Add (or replace, by session id) a finish to replay. Throws on a storage
 *  failure — the caller then falls back to waiting on the network. */
export async function recordPendingFinish(uid: string, entry: PendingFinish): Promise<void> {
  const list = (await readPendingFinishes(uid)).filter((p) => p.session.id !== entry.session.id);
  await writeFinishes(uid, [...list, entry]);
}

/** Drop a finish once its writes have landed (or been refused for good). */
export async function removePendingFinish(uid: string, sessionId: string): Promise<void> {
  try {
    const list = await readPendingFinishes(uid);
    const next = list.filter((p) => p.session.id !== sessionId);
    if (next.length !== list.length) await writeFinishes(uid, next);
  } catch {
    // Replaying a finish that already landed is harmless: the writes are
    // idempotent and `markExercised` checks for its own marker.
  }
}
