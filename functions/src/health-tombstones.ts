import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

/**
 * A deleted Health / Oura workout stays deleted — enforced on the SERVER.
 *
 * ## Why this exists (owner, 2026-10-20)
 *
 * The 10/14 Watch walk (`24D8F0AB…`) was removed on 10/15 at 15:28Z and its
 * `sourceId` written to the session's `dismissedSourceIds`. At 15:34Z the row
 * was back. The phone was still running JS from before the import learned to
 * read `dismissedSourceIds` (an OTA applies on the launch AFTER it downloads),
 * and that import matched by `sourceId` alone, found nothing and re-added it.
 * A client fix cannot reach a client that has not loaded it yet — and a
 * deleted SESSION had no tombstone at all, so its imported walk came back as a
 * new session on the next import, on any build.
 *
 * So the record of a deletion is an account-level document the server keeps,
 * and the server enforces it on every write, from every build:
 *
 * - every id in a session's `dismissedSourceIds` becomes a tombstone at
 *   `users/{uid}/healthTombstones/{encodeURIComponent(sourceId)}`;
 * - deleting a non-active session tombstones every imported block it held;
 * - an id taken OUT of `dismissedSourceIds` while its block is back in
 *   `cardio` is an Undo — its tombstone is removed and the block kept;
 * - any write that leaves a tombstoned block in `cardio` gets it stripped;
 *   a completed session left with no exercises and no cardio is deleted
 *   (it only ever existed to hold the re-added import).
 *
 * The trigger's own write re-fires it and finds nothing to do. It reads the
 * tombstone collection only when the written session carries an imported
 * block, so a lifting session costs one invocation and no reads.
 */

interface Block { sourceId?: unknown }
export interface SessionDoc {
  status?: unknown;
  exercises?: unknown;
  cardio?: unknown;
  dismissedSourceIds?: unknown;
}

const ids = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
const blocks = (v: unknown): Block[] =>
  Array.isArray(v) ? v.filter((b): b is Block => !!b && typeof b === "object") : [];
const sourceIdOf = (b: Block): string | null =>
  typeof b.sourceId === "string" && b.sourceId ? b.sourceId : null;

export interface TombstonePlan {
  /** Tombstones to create. */
  add: string[];
  /** Tombstones to remove (an Undo). */
  remove: string[];
  /** The session's new `cardio`, when a tombstoned block must go. */
  cardio?: Block[];
  /** Delete the session: it held nothing but the stripped import. */
  deleteSession?: boolean;
}

/**
 * What to do about one session write — pure, so the rules above are tested
 * without an emulator. `tombstones` is the account's set BEFORE this write.
 */
export function planTombstones(
  before: SessionDoc | undefined,
  after: SessionDoc | undefined,
  tombstones: ReadonlySet<string>,
): TombstonePlan {
  if (!after) {
    // Deleted. An active session is a discard of a live workout — imports
    // never go into one — so it records nothing.
    if (!before || before.status === "active") return { add: [], remove: [] };
    const gone = [...blocks(before.cardio).map(sourceIdOf), ...ids(before.dismissedSourceIds)]
      .filter((x): x is string => !!x && !tombstones.has(x));
    return { add: [...new Set(gone)], remove: [] };
  }
  const was = new Set(ids(before?.dismissedSourceIds));
  const dismissed = new Set(ids(after.dismissedSourceIds));
  const present = new Set(blocks(after.cardio).map(sourceIdOf).filter((x): x is string => !!x));
  // Undo: the id left `dismissedSourceIds` and its block is back.
  const remove = [...was].filter((x) => !dismissed.has(x) && present.has(x) && tombstones.has(x));
  const undone = new Set(remove);
  const add = [...dismissed].filter((x) => !tombstones.has(x));
  const dead = new Set([...tombstones, ...dismissed].filter((x) => !undone.has(x)));
  const all = blocks(after.cardio);
  const kept = all.filter((b) => {
    const sid = sourceIdOf(b);
    return !sid || !dead.has(sid);
  });
  if (kept.length === all.length) return { add, remove };
  const empty = kept.length === 0
    && (!Array.isArray(after.exercises) || after.exercises.length === 0)
    && after.status !== "active";
  return { add, remove, cardio: kept, ...(empty ? { deleteSession: true } : {}) };
}

/** Firestore doc id for a tombstone: ids are platform UUIDs, but a fallback
 *  id or an Oura id must never be able to add a path segment. */
export const tombstoneDocId = (sourceId: string): string => encodeURIComponent(sourceId);

export const enforceHealthTombstones = onDocumentWritten(
  "users/{uid}/workoutSessions/{sessionId}",
  async (event) => {
    const before = event.data?.before.exists ? (event.data.before.data() as SessionDoc) : undefined;
    const after = event.data?.after.exists ? (event.data.after.data() as SessionDoc) : undefined;
    const imported = (d?: SessionDoc) => blocks(d?.cardio).some((b) => sourceIdOf(b) != null);
    const touchesDismissed = ids(before?.dismissedSourceIds).length > 0 || ids(after?.dismissedSourceIds).length > 0;
    // Nothing imported on either side and nothing dismissed: a plain lifting
    // write. No reads.
    if (!imported(before) && !imported(after) && !touchesDismissed) return;

    const db = getFirestore();
    const { uid, sessionId } = event.params;
    const userRef = db.doc(`users/${uid}`);
    const col = db.collection(`users/${uid}/healthTombstones`);
    const ref = db.doc(`users/${uid}/workoutSessions/${sessionId}`);
    // One transaction: the profile must still exist (an account erasure
    // deletes sessions one by one, and must not have tombstones re-created
    // under it — `gdpr.ts` step 3c), and the session is re-read so a client
    // write that landed since the event is planned against, not overwritten.
    await db.runTransaction(async (tx) => {
      const [userSnap, tombSnap, current] = await Promise.all([tx.get(userRef), tx.get(col), tx.get(ref)]);
      if (!userSnap.exists) return;
      const tombstones = new Set(tombSnap.docs.map((d) => (d.get("sourceId") as string | undefined) ?? decodeURIComponent(d.id)));
      const now = current.exists ? (current.data() as SessionDoc) : undefined;
      // Planned against what is there NOW: a session deleted since the event
      // is planned as a delete, one rewritten since as its current content.
      const plan = planTombstones(before, now, tombstones);
      for (const sid of plan.add) {
        tx.set(col.doc(tombstoneDocId(sid)), {
          sourceId: sid,
          at: FieldValue.serverTimestamp(),
          sessionId,
          reason: now ? "dismissed" : "session-deleted",
        });
      }
      for (const sid of plan.remove) tx.delete(col.doc(tombstoneDocId(sid)));
      if (now && plan.deleteSession) tx.delete(ref);
      else if (now && plan.cardio) tx.update(ref, { cardio: plan.cardio });
    });
  },
);
