/**
 * The active session: the one workout on screen, and the rule for which copy
 * of it wins.
 *
 * Four copies of a live workout exist at once — the one this runtime holds,
 * the device journal (`active-session-journal.ts`), the server's document, and
 * whatever writes are still on their way to it. Until 2026-11-20 the rule for
 * choosing between them lived in `useTrain` as seven refs and a focus effect,
 * reachable only through a rendered hook. It lives here now, as plain
 * TypeScript: `useTrain` holds one of these and tells React what it reports.
 *
 * The rule, in one place:
 *  - **This runtime's copy wins over a server READ.** Every write to it came
 *    from here, so a read can only be equal or behind (`open`).
 *  - **The journal covers a dead runtime.** On a fresh mount it is shown at
 *    once, then reconciled with the server's answer (`reconcileActiveSession`).
 *  - **A session the server says is COMPLETED is not active** (`serverSaw`).
 *    It was finished somewhere else — another device, a data script — and
 *    this runtime's copy can only reopen or re-finish a closed workout. Until
 *    2026-11-20 nothing checked: the phone kept the session and finished it a
 *    second time at the 24 h cap (2026-11-06).
 *  - **A completed session open for editing is not live** (`reopen`): no
 *    server answer replaces it, and the server never closes it.
 *
 * Not a shared subscription (ADR-0016): it opens no listener. The hook feeds
 * it what its own listeners deliver.
 */
import { newLedgerId } from '@macrolog/core';
import {
  type JournalEntry,
  type PendingFinish,
  clearActiveSessionJournal,
  createJournalWriter,
  readActiveSessionJournal,
  reconcileActiveSession,
} from '@/lib/active-session-journal';
import { publishActiveWorkout } from '@/lib/active-workout-signal';
import { readActiveSession, startSession, updateSession } from '@/lib/ledger';
import type { SessionDraft, WorkoutSession } from '@/lib/workout';

/** What the owner of an active session is told. All four are React setters in `useTrain`. */
export interface ActiveSessionHost {
  /** The session on screen changed (or closed). */
  onChange(session: WorkoutSession | null): void;
  /** Whether a session write is waiting on the server. */
  onSaving(saving: boolean): void;
  /** A write was refused. */
  onError(error: Error): void;
  /** The device has answered "is a workout open?" for this account. */
  onResolved(uid: string): void;
}

const asError = (e: unknown, fallback: string): Error => (e instanceof Error ? e : new Error(fallback));

export function createActiveSession(host: ActiveSessionHost) {
  let current: WorkoutSession | null = null;
  /** The session the journal put on screen before the server answered, if it
   *  is still the one showing. The server's answer may replace THAT; it never
   *  replaces a session the user started or edited in the meantime. */
  let provisional: WorkoutSession | null = null;
  /** Pristine snapshot of a reopened completed session, for Cancel. */
  let editOriginal: WorkoutSession | null = null;
  /** Ids of sessions started on THIS device whose create has not been
   *  acknowledged. Journaled as `created: false`, which is what lets a cold
   *  start tell "never reached the server" from "finished elsewhere". */
  const uncreated = new Set<string>();
  /** How many session writes are waiting on the server. A counter, not a
   *  boolean: two overlapping writes used to clear `saving` when the FIRST
   *  one landed, while the second was still out. */
  let inFlight = 0;
  const journal = createJournalWriter();

  /** Every write to the active session goes through here. */
  function set(uid: string | undefined, next: WorkoutSession | null): void {
    current = next;
    host.onChange(next);
    // On the device BEFORE Firestore hears of it: the SDK's write queue is
    // memory-only on RN and dies with the runtime. Debounced — one
    // AsyncStorage write per burst of keystrokes, flushed on blur, background
    // and every start/finish (Train review item 30).
    if (uid && next) journal.write(uid, next, uncreated.has(next.id ?? '') ? false : undefined);
    // The one honest place to tell the rest of the app a workout is open.
    // One boolean and a name, no listener, one producer (`active-workout-signal.ts`).
    publishActiveWorkout(uid, next);
  }

  /** Take the session off the screen and make sure no journal brings it back:
   *  not the stored one, and not a debounced write still waiting to land. */
  function close(uid: string): void {
    set(uid, null);
    journal.cancel();
    void clearActiveSessionJournal(uid);
  }

  /** The whole document for a session, for a create that has to be (re)sent.
   *  The id names the doc; the timestamps are the writer's. */
  async function writeWhole(uid: string | undefined, session: WorkoutSession): Promise<void> {
    if (!uid || !session.id) return;
    const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = session;
    try {
      await startSession(uid, draft as SessionDraft, id);
      uncreated.delete(id);
    } catch (e) {
      host.onError(asError(e, 'Save failed'));
    }
  }

  /** Send the session's live fields to the server. */
  async function persist(uid: string | undefined, session: WorkoutSession): Promise<void> {
    if (!uid || !session.id) return;
    inFlight += 1;
    host.onSaving(true);
    const sessionId = session.id;
    const patch = {
      exercises: session.exercises,
      // Absent stays ABSENT. `toSessionPatch` writes the key only when it is
      // present, so a strength-only session never gains an empty array — but
      // a session that HAS cardio must carry it, and omitting it here is a
      // silent data loss rather than a rejected write: the block renders, the
      // summary updates, and Firestore never hears about it. Measured on the
      // LG G6 on 2026-08-24, by Maestro flow 21.
      ...(session.cardio !== undefined ? { cardio: session.cardio } : {}),
      // A removed imported block's id (2026-10-15) — without it the next
      // Health import re-adds the block the user just took out.
      ...(session.dismissedSourceIds !== undefined ? { dismissedSourceIds: session.dismissedSourceIds } : {}),
      // Travel mode: the lifter's "not comparable" switch (false clears it).
      ...(session.notComparable !== undefined ? { notComparable: session.notComparable } : {}),
    };
    try {
      await updateSession(uid, sessionId, patch);
    } catch (e) {
      // `not-found` on the session still on screen means its create never
      // reached the server (started offline, then a restart) — not that it
      // was deleted: a discard or finish closes the session before it writes.
      // So send the whole document instead of losing the workout.
      const code = (e as { code?: string } | null)?.code;
      if (code === 'not-found' && session.status === 'active' && current?.id === sessionId) {
        await writeWhole(uid, current);
      } else {
        host.onError(asError(e, 'Save failed'));
      }
    } finally {
      inFlight -= 1;
      if (inFlight === 0) host.onSaving(false);
    }
  }

  /**
   * Begin a live session from a draft: id minted HERE, session on screen and
   * journaled at once, create sent behind it. The create's failure surfaces
   * as a save error on the session itself (Train review bug 3), and a later
   * edit re-sends the whole document if the create never landed (`persist`).
   */
  function begin(uid: string, draft: SessionDraft): void {
    // A Firestore-shaped id (20 chars of [A-Za-z0-9]) from core, the same
    // minting the durable food queue uses — no SDK call, so no network.
    const id = newLedgerId(Math.random);
    const now = new Date();
    uncreated.add(id);
    set(uid, { ...draft, id, createdAt: now, updatedAt: now });
    // The session's birth is not a keystroke: written now, not debounced.
    void journal.flush();
    startSession(uid, draft, id)
      .then(() => {
        uncreated.delete(id);
        if (current?.id === id) journal.write(uid, current);
      })
      .catch((e) => host.onError(asError(e, 'Start failed')));
  }

  /**
   * The tab gained focus: show what the DEVICE holds at once, then let the
   * server's answer correct it.
   *
   * The device first, because a cold start offline waited on a server read
   * the memory-only SDK cannot answer for seconds, and showed Start the whole
   * time — long enough to start a second workout over the one still open
   * (Train review bug 4).
   *
   * `alive()` is the feed's: a resolve that lands after the tab blurred must
   * not revive a torn-down screen. `finishes` are the finishes recorded on
   * the device and not yet heard by the server.
   */
  function open(uid: string, opts: { alive: () => boolean; finishes: Promise<PendingFinish[]> }): void {
    const { alive, finishes } = opts;
    const journalRead = readActiveSessionJournal(uid);
    void Promise.all([journalRead, finishes])
      .then(([entry, list]) => {
        if (!alive() || editOriginal || current || !entry) return;
        if (list.some((f) => f.session.id === entry.session.id)) return;
        // Carried forward, or the next journal write would forget that the
        // server never got this session's create.
        if (entry.created === false && entry.session.id) uncreated.add(entry.session.id);
        provisional = entry.session;
        set(uid, entry.session);
      })
      // A storage failure is an answer too ("nothing on the device"); the
      // server read below still corrects it.
      .catch(() => {})
      // AFTER `set`, so no render sees "answered" with the journal's session
      // still missing.
      .finally(() => {
        if (alive()) host.onResolved(uid);
      });
    Promise.all([
      // A failed read is an unreachable server, not an empty one.
      readActiveSession(uid).catch(() => ({ session: null, fromCache: true })),
      journalRead,
      finishes,
    ])
      .then(([read, entry, list]) => answer(uid, alive, read, entry, list))
      // Nothing to report: the read's own failure is handled above, and a
      // storage failure only costs the journal's head start.
      .catch(() => {});
  }

  /** The server's read of "which session is active" has arrived. */
  function answer(
    uid: string,
    alive: () => boolean,
    read: { session: WorkoutSession | null; fromCache: boolean },
    entry: JournalEntry | null,
    list: PendingFinish[],
  ): void {
    // Not while a COMPLETED session is open for editing. `reopen` loads it
    // without changing its status, so this query answers `null` on every
    // refocus — and writing that through closed the editor while the edit
    // chrome and the Cancel snapshot stayed set, leaving the NEXT workout
    // started wearing them: "Done" then never marked it completed.
    if (!alive() || editOriginal) return;
    const local = current;
    const fromJournal = local != null && local === provisional;
    provisional = null;
    // A session started, resumed or edited in THIS runtime wins. Every write
    // to it came from here, so the server's copy can only be equal or behind
    // — behind by any deferred edit not yet committed, or by writes still
    // queued on a slow connection. Replacing it threw those away, and the
    // next whole-array write made it permanent. (Until 2026-10-04 this held
    // only for the same id; a start tapped while this read was in flight was
    // then replaced by the read's `null`.)
    if (local && !fromJournal) return;
    // A fresh mount (cold start, OTA reload): the device journal wins when it
    // is newer than the server's last write — or when the server could not be
    // asked — and is written back so Firestore gets the edits a dead runtime
    // never sent.
    const { session, resync, recreate } = reconcileActiveSession(read.session, entry, {
      serverKnown: !read.fromCache,
      finishing: new Set(list.map((f) => f.session.id ?? '')),
    });
    if (session?.id) {
      if (recreate) uncreated.add(session.id);
      else uncreated.delete(session.id);
    }
    if (session !== local) set(uid, session);
    if (session && resync) void (recreate ? writeWhole(uid, session) : persist(uid, session));
  }

  /**
   * The sessions listener delivered. If the session on screen is in that list
   * as COMPLETED, it was finished somewhere else: close it here.
   *
   * `finishing` are the ids this device is finishing right now — its own
   * finish is not "somewhere else", and that path closes the session itself.
   * Returns whether the session was closed.
   */
  function serverSaw(uid: string, sessions: readonly WorkoutSession[], finishing: { has(id: string): boolean } | null = null): boolean {
    const local = current;
    if (!local?.id || editOriginal) return false;
    if (finishing?.has(local.id)) return false;
    const theirs = sessions.find((s) => s.id === local.id);
    if (theirs?.status !== 'completed') return false;
    provisional = null;
    uncreated.delete(local.id);
    close(uid);
    return true;
  }

  return {
    /**
     * The session on screen. Read by every mutation instead of a value a
     * callback closed over, which could be a render stale.
     *
     * Methods, not properties, and none named `current`: React Compiler treats
     * `x.current` as a ref read, could not match that against the callbacks'
     * dependency lists, and skipped ALL of `useTrain` (measured 2026-11-20 with
     * `scripts/react-compiler-report.mjs`).
     */
    peek(): WorkoutSession | null {
      return current;
    },
    /** The pristine copy of the completed session being edited, or null. */
    editing(): WorkoutSession | null {
      return editOriginal;
    },
    /** Whether any session write is still waiting on the server. */
    isSaving(): boolean {
      return inFlight > 0;
    },
    set,
    close,
    begin,
    persist,
    open,
    serverSaw,
    /** Open a completed session for editing. Refused while a workout is live. */
    reopen(uid: string | undefined, session: WorkoutSession): boolean {
      if (current || !session.id) return false;
      // The edit callbacks replace (map/spread) rather than mutate, so this
      // reference stays untouched.
      editOriginal = session;
      set(uid, session);
      return true;
    },
    /** Leave edit mode and take the session off the screen. Returns what was
     *  on screen and the pristine copy, for the caller's final write. */
    endEdit(uid: string | undefined): { edited: WorkoutSession | null; original: WorkoutSession | null } {
      const result = { edited: current, original: editOriginal };
      editOriginal = null;
      set(uid, null);
      return result;
    },
    /** Write the journal now: on blur, on background, at a start or resume. */
    flush(): Promise<void> {
      return journal.flush();
    },
  };
}

export type ActiveSession = ReturnType<typeof createActiveSession>;
