import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Measurement, MeasurementInput } from '@macrolog/core';
import { isOffline } from './connectivity';
import {
  addMeasurementWithId,
  deleteDailyWeight,
  deleteMeasurement,
  setDailyWeight,
  updateMeasurement,
} from './ledger';

/**
 * The durable write queue for Body — weigh-ins and tape measurements.
 *
 * ## The bug (Body review, bug 2)
 *
 * The Expo app's Firestore is memory-only (`offline-cache.ts`), and `setDoc`
 * resolves on the SERVER's ack. So an offline weigh-in sat in a sheet whose Save
 * had gone dead — `busy` true, no spinner, no words — and a user who gave up
 * and killed the app lost the weigh-in with no trace. Measurements had the same
 * shape. `FastSheet` already closes on the local write; meals already go to
 * disk first (`pending-logs.ts`). Body was the one logging surface that did
 * neither.
 *
 * ## Why a sibling queue rather than the meal queue
 *
 * The meal queue's rows are `PendingLog`s: one shape, one write (`setDoc` of
 * known bytes at a minted id), and an iOS App Group store that Swift reads too.
 * A weigh-in is keyed by DAY rather than id, a measurement edit is a patch, and
 * deletes have to queue as well — none of which the meal row can express
 * without teaching the widget's Swift reader about shapes it will never write.
 * So this is the same discipline in its own key: disk first, one serialised
 * read-modify-write chain, a bounded first attempt, an idempotent replay on the
 * next foreground, and a "drop only if disk still holds the bytes I wrote"
 * rewrite so an edit made mid-flush is never mistaken for the landed original.
 *
 * ## Disk FIRST, then the write
 *
 * Every op is parked before the network is touched, and dropped once its write
 * lands. The other order — try, park on failure — has a hole the meal queue
 * closes with its `undoneIds` set: a weigh-in edited while its first write was
 * still waiting out a deadline would park the OLD value behind the new one.
 * Parking first means the newest intent for a key is always what is on disk,
 * because {@link mergeBodyOp} coalesces by key.
 *
 * Every op is idempotent on replay: `setDoc` of a value, `deleteDoc`, an add at
 * a minted id, a patch of the same fields. A write that landed after we gave up
 * on it is overwritten by identical bytes on flush.
 */

const KEY = 'ignia.pendingBody.v1';

/** Same budget as the meal queue's in-app path (`pending-logs.ts`): a fast
 *  "saved, will sync" when the device is known offline, patience when it
 *  looks online. Parking early is safe either way — see the header. */
const OFFLINE_DEADLINE_MS = 1500;
const ONLINE_DEADLINE_MS = 8000;

/** Longer than the meal queue's 7 days on purpose: a weigh-in is one number a
 *  day and feeds the measured-TDEE regression, so holding it through a long
 *  trip offline is worth more than it costs. Past this the op is dropped. */
export const PENDING_BODY_TTL_MS = 30 * 86_400_000;

export type BodyOp =
  | { kind: 'weight'; uid: string; dateKey: string; weightLb: number; atMs: number }
  | { kind: 'weightDelete'; uid: string; dateKey: string; atMs: number }
  | {
      kind: 'measurementAdd';
      uid: string;
      id: string;
      entry: MeasurementInput;
      /** The row's own date (the sheet's date stepper, or now). */
      dateMs: number;
      atMs: number;
    }
  | {
      kind: 'measurementUpdate';
      uid: string;
      id: string;
      entry: MeasurementInput;
      /** Set only when the user moved the row to another day. */
      dateMs?: number;
      atMs: number;
    }
  | { kind: 'measurementDelete'; uid: string; id: string; atMs: number };

/**
 * Resolve, or reject once the deadline passes — `quick-add.ts`'s
 * `withWriteDeadline`, restated rather than imported: that module pulls the
 * Firebase auth SDK, two native modules and `health-sync.ts`, and
 * `health-sync.ts` imports THIS file, so the import would be a require cycle
 * through the widget's module graph. `setDoc` never rejects offline; it waits,
 * and this converts the wait into the throw the queue handles.
 */
function withDeadline<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('pending-body write deadline')), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** The coalescing key: one pending intent per weigh-in day / measurement row. */
export function bodyOpKey(op: BodyOp): string {
  return op.kind === 'weight' || op.kind === 'weightDelete'
    ? `w:${op.uid}:${op.dateKey}`
    : `m:${op.uid}:${op.id}`;
}

/**
 * Add `op` to the queue, coalescing with whatever is already parked for its
 * key. Pure, so the rules are pinned by a test rather than by a device.
 *
 * - A weigh-in or its delete REPLACES the day's previous intent: the newest
 *   word on a day is the only one worth landing.
 * - An edit of a measurement that never landed folds INTO its add. A patch
 *   against a server doc that does not exist yet would fail `not-found` and
 *   lose the edit; the add carries the new values instead.
 * - Anything else replaces. A delete after an add that never landed still
 *   queues the delete — the add's write may have landed with its ack lost, and
 *   a delete of a missing doc is a no-op.
 */
export function mergeBodyOp(list: readonly BodyOp[], op: BodyOp): BodyOp[] {
  const key = bodyOpKey(op);
  const prev = list.find((p) => bodyOpKey(p) === key);
  let next: BodyOp = op;
  if (prev?.kind === 'measurementAdd' && op.kind === 'measurementUpdate') {
    next = { ...prev, entry: op.entry, dateMs: op.dateMs ?? prev.dateMs, atMs: op.atMs };
  }
  return [...list.filter((p) => bodyOpKey(p) !== key), next];
}

/** What is still worth flushing: this account's ops, younger than the TTL.
 *  Another account's ops are dropped, the meal queue's rule — they are not
 *  ours to write, and keeping them would land them under the wrong user. */
export function pruneBodyOps(list: readonly BodyOp[], nowMs: number, uid: string | null): BodyOp[] {
  return list.filter((op) => nowMs - op.atMs < PENDING_BODY_TTL_MS && (uid == null || op.uid === uid));
}

function isOp(v: unknown): v is BodyOp {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.uid !== 'string' || typeof o.atMs !== 'number') return false;
  switch (o.kind) {
    case 'weight':
      return typeof o.dateKey === 'string' && typeof o.weightLb === 'number' && Number.isFinite(o.weightLb);
    case 'weightDelete':
      return typeof o.dateKey === 'string';
    case 'measurementAdd':
      return typeof o.id === 'string' && typeof o.dateMs === 'number' && !!o.entry && typeof o.entry === 'object';
    case 'measurementUpdate':
      return typeof o.id === 'string' && !!o.entry && typeof o.entry === 'object';
    case 'measurementDelete':
      return typeof o.id === 'string';
    default:
      return false;
  }
}

async function readOps(): Promise<BodyOp[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter(isOp) : [];
  } catch {
    return [];
  }
}

async function writeOps(list: readonly BodyOp[]): Promise<void> {
  if (list.length === 0) await AsyncStorage.removeItem(KEY);
  else await AsyncStorage.setItem(KEY, JSON.stringify(list));
}

/** Every read-modify-write of the queue goes through this one chain — two
 *  parks in parallel would each read the same list and the second write would
 *  drop the first op (the bug `quick-add.ts`'s own `serial` was written for). */
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

type Listener = () => void;
const listeners = new Set<Listener>();

/** Subscribe to queue changes (park, land, flush). Returns an unsubscribe. */
export function onPendingBodyChanged(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify(): void {
  for (const l of listeners) l();
}

async function park(op: BodyOp): Promise<void> {
  await serial(async () => {
    await writeOps(mergeBodyOp(await readOps(), op));
  });
  notify();
}

/** Drop the op for `key` only if disk still holds exactly `bytes` — a newer
 *  intent parked while this write was in flight must survive to its own
 *  write. */
async function dropIfUnchanged(key: string, bytes: string): Promise<void> {
  let changed = false;
  await serial(async () => {
    try {
      const list = await readOps();
      const remaining = list.filter((p) => !(bodyOpKey(p) === key && JSON.stringify(p) === bytes));
      if (remaining.length !== list.length) {
        changed = true;
        await writeOps(remaining);
      }
    } catch {
      /* Worst case the landed op is replayed — idempotent. */
    }
  });
  if (changed) notify();
}

/** The one place an op becomes a Firestore write. */
function apply(op: BodyOp): Promise<void> {
  switch (op.kind) {
    case 'weight':
      return setDailyWeight(op.uid, op.dateKey, op.weightLb);
    case 'weightDelete':
      return deleteDailyWeight(op.uid, op.dateKey);
    case 'measurementAdd':
      return addMeasurementWithId(op.uid, op.id, op.entry, new Date(op.dateMs));
    case 'measurementUpdate':
      return updateMeasurement(op.uid, op.id, op.entry, op.dateMs != null ? new Date(op.dateMs) : undefined);
    case 'measurementDelete':
      return deleteMeasurement(op.uid, op.id);
  }
}

/**
 * A rejection no retry will fix: the rules refusing the shape, or an edit of a
 * row that no longer exists. These are dropped and REPORTED, never parked —
 * parking one would retry it on every foreground for a month and tell nobody.
 * Everything else (no network, a deadline, an expired token mid-refresh) is
 * the queue's job.
 */
export function isPermanentWriteError(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  return code === 'permission-denied' || code === 'invalid-argument' || code === 'not-found' || code === 'failed-precondition';
}

/** Whether a write reached the ledger, is waiting on disk, or was refused for
 *  good. A refusal is a VALUE, not a rejection: `landed` is awaited after the
 *  sheet has closed, and an unhandled rejection in this app reports exactly
 *  like a crash (OTA 80). */
export type BodyWriteOutcome = 'saved' | 'queued' | 'rejected';

/**
 * Commit one op, durably.
 *
 * Resolves `{ landed }` as soon as the op is ON DISK — that is the local write
 * the sheet closes on. `landed` then resolves (never rejects) with the outcome
 * the receipt reports: `saved` (the server took it), `queued` (it will flush on
 * a later foreground), or `rejected` for a permanent refusal, which the caller
 * must surface because the SDK has already rolled the optimistic value back.
 *
 * Rejects outright only when the op could not even be parked — the one case
 * where nothing at all was recorded and the sheet must stay open.
 */
export async function commitBodyOp(op: BodyOp): Promise<{ landed: Promise<BodyWriteOutcome> }> {
  await park(op);
  const key = bodyOpKey(op);
  const bytes = JSON.stringify(op);
  const deadline = isOffline() ? OFFLINE_DEADLINE_MS : ONLINE_DEADLINE_MS;
  const landed = (async (): Promise<BodyWriteOutcome> => {
    try {
      await withDeadline(apply(op), deadline);
    } catch (e) {
      if (!isPermanentWriteError(e)) return 'queued';
      await dropIfUnchanged(key, bytes);
      return 'rejected';
    }
    await dropIfUnchanged(key, bytes);
    return 'saved';
  })();
  return { landed };
}

let flushing = false;

/**
 * Land every parked op for `uid`, then rewrite the queue with what is left.
 * Called on foreground (`useHealthAutoImport`'s run, which every authed
 * session mounts) and when Body gains focus. Each op is attempted on its own —
 * one permanent failure must not block the rest. Returns how many landed.
 */
export async function flushPendingBody(uid: string, nowMs: number = Date.now()): Promise<number> {
  if (flushing || !uid) return 0;
  flushing = true;
  try {
    const all = await readOps();
    if (all.length === 0) return 0;
    const mine = pruneBodyOps(all, nowMs, uid);
    if (mine.length !== all.length) {
      // Age and account pruning first: what failed the filter is not "failed",
      // it is not ours to write any more.
      await serial(async () => writeOps(pruneBodyOps(await readOps(), nowMs, uid)));
      notify();
    }
    let landedCount = 0;
    for (const listed of mine) {
      // Re-read just before the write: this loop can sit on an earlier op for
      // minutes offline, and the freshest bytes are the user's latest word.
      const op = (await readOps()).find((p) => bodyOpKey(p) === bodyOpKey(listed));
      if (!op) continue;
      const bytes = JSON.stringify(op);
      try {
        await apply(op);
        landedCount++;
        await dropIfUnchanged(bodyOpKey(op), bytes);
      } catch (e) {
        if (isPermanentWriteError(e)) await dropIfUnchanged(bodyOpKey(op), bytes);
        /* Anything else stays parked for the next foreground. */
      }
    }
    return landedCount;
  } finally {
    flushing = false;
  }
}

/**
 * What the queue holds for one account, as an overlay the Body screen applies
 * on top of its snapshot. Cold-start offline, the snapshot is the last online
 * session's — it does not contain the weigh-in that never reached Firestore —
 * and without this the user watches it vanish on relaunch and logs it twice.
 */
export interface PendingBodyOverlay {
  /** `dateKey → lb`, or null for a parked delete. */
  weights: Record<string, number | null>;
  /** Parked adds, as rows. */
  added: Measurement[];
  /** Parked edits of landed rows: `id → entry (+ new date)`. */
  updated: Record<string, { entry: MeasurementInput; date?: Date }>;
  /** Parked deletes. */
  deleted: string[];
}

export function overlayFromOps(ops: readonly BodyOp[], uid: string): PendingBodyOverlay {
  const out: PendingBodyOverlay = { weights: {}, added: [], updated: {}, deleted: [] };
  for (const op of ops) {
    if (op.uid !== uid) continue;
    switch (op.kind) {
      case 'weight':
        out.weights[op.dateKey] = op.weightLb;
        break;
      case 'weightDelete':
        out.weights[op.dateKey] = null;
        break;
      case 'measurementAdd':
        out.added.push({ ...op.entry, id: op.id, date: new Date(op.dateMs) } as Measurement);
        break;
      case 'measurementUpdate':
        out.updated[op.id] = { entry: op.entry, ...(op.dateMs != null ? { date: new Date(op.dateMs) } : {}) };
        break;
      case 'measurementDelete':
        out.deleted.push(op.id);
        break;
    }
  }
  return out;
}

export async function readPendingBody(uid: string): Promise<PendingBodyOverlay> {
  return overlayFromOps(await readOps(), uid);
}

/** Sign-out / account deletion. Not wired into `auth.tsx` (not this module's
 *  file); the uid filter in {@link pruneBodyOps} already keeps one account's
 *  ops from ever landing under another's. */
export async function clearPendingBody(): Promise<void> {
  try {
    await serial(async () => AsyncStorage.removeItem(KEY));
  } catch {
    /* best-effort */
  }
  notify();
}
