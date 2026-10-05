import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useCachedState } from '@/hooks/useCachedState';
import { asError, feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { finishWorkout as finishWorkoutOp } from '@/lib/ledger-ops';
import { useAuth } from '@/lib/auth';
import {
  type PendingFinish,
  clearActiveSessionJournal,
  createJournalWriter,
  readActiveSessionJournal,
  readPendingFinishes,
  reconcileActiveSession,
  recordPendingFinish,
  removePendingFinish,
} from '@/lib/active-session-journal';
import { useOtaHold } from '@/lib/ota-hold';
import {
  addExercise as addExerciseDoc,
  addTemplate as addTemplateDoc,
  deleteExercise as deleteExerciseDoc,
  deleteSession as deleteSessionDoc,
  deleteTemplate as deleteTemplateDoc,
  editExercise as editExerciseDoc,
  mergeExercises as mergeExercisesDoc,
  readActiveSession,
  startSession,
  subscribeExercises,
  subscribeRecentSessions,
  subscribeTemplates,
  updateSession,
  updateTemplate as updateTemplateDoc,
} from '@/lib/ledger';
import {
  type SessionAction,
  applySessionAction,
  findDuplicateExercise,
  dayBoundaryOf,
  exerciseHistory,
  moveExercise,
  newCardioBlock,
  newLedgerId,
  newWorkoutSet,
  recommend,
  recommendOptionsFor,
  toRecommendationSnapshot,
} from '@macrolog/core';
import {
  type Exercise,
  type ExerciseDraft,
  type ExercisePatch,
  type LogStyle,
  type SessionExercise,
  type SessionDraft,
  type SetKind,
  type TemplateDraft,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutTemplate,
  dropEmptySets,
  templateToSessionCardio,
  templateToSessionExercises,
} from '@/lib/workout';
import type { CardioModality } from '@macrolog/core/cardio';
import {
  type SeedExercise,
  type SeedTemplate,
  fillMissingClusterLoads,
  findSeedExercise,
  findSeedExerciseByName,
  seedExerciseCues,
  seedExerciseName,
  seedTemplateExerciseCues,
  seedTemplateName,
  seedTemplateNotes,
} from '@macrolog/core';
import { publishActiveWorkout } from '@/lib/active-workout-signal';
import { useLocale } from '@/i18n';

/** Which half of the hook failed. `load` is the Firestore feed (the screen
 *  cannot show data it never received — `train.loadErr`); `save` is one of the
 *  write verbs (the data on screen is fine, the last change did not land —
 *  `train.saveErr`). */
export type TrainErrorKind = 'load' | 'save';

export interface TrainState {
  loading: boolean;
  error: Error | null;
  /** Set alongside `error`; null when `error` is null. */
  errorKind: TrainErrorKind | null;
  /** Exercise catalog (alphabetical). */
  catalog: Exercise[];
  /** Reusable workout templates, most-recently-updated first. */
  templates: WorkoutTemplate[];
  /** Completed sessions, newest first. */
  recentSessions: WorkoutSession[];
  /** The in-progress session held in local state, or null. */
  active: WorkoutSession | null;
  saving: boolean;
  /** Dismiss the current error (the screen's Retry/close on a save error). */
  clearError: () => void;
  /** Begin a new empty active session. LOCAL-FIRST since 2026-10-04: the id
   *  is minted on the device, the session is on screen and journaled at once,
   *  and the create runs behind it — it no longer waits on the network, and a
   *  second tap while one is starting is a no-op (Train review bug 1). No-op
   *  if one is already active. */
  startWorkout: () => Promise<void>;
  /** Begin a session seeded from a template (snapshots its exercises +
   *  planned sets + prescribed cardio, stamps templateId/templateName).
   *  No-op if one is active. */
  startFromTemplate: (template: WorkoutTemplate) => Promise<void>;
  /** Begin a cardio-only session — one block, no exercises (ADR-0025). */
  startCardioWorkout: (modality: CardioModality) => Promise<void>;
  /** Create (id omitted) or overwrite (id given) a workout template. */
  saveTemplate: (draft: TemplateDraft, id?: string) => Promise<void>;
  /** Clone a shipped starter template: ensure its library exercises exist in
   *  the catalog (create the missing ones), then add the template. */
  cloneStarterTemplate: (seed: SeedTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  /** Create a catalog exercise, returning its id (used by the template
   *  editor when adding a free-typed exercise).
   *
   *  A typed name that EXACTLY matches a shipped library movement inherits its
   *  muscles, cues and `seedKey`. Before this, every hand-created exercise was
   *  written with `muscles: []` and no screen could ever set them, so the
   *  weekly cluster audit's `unattributed` list was unfixable by the user. */
  addCatalogExercise: (name: string, logStyle: LogStyle) => Promise<string>;
  /** Ensure a shipped library movement exists in the catalog and return its
   *  id and canonical (localized) name. Idempotent: an entry already cloned —
   *  by a starter template or by an earlier pick — is reused, so history and
   *  e1RM never split across a duplicate. */
  addLibraryExercise: (seed: SeedExercise) => Promise<{ id: string; name: string; logStyle: LogStyle }>;
  /** Add a shipped library movement straight to the active session — or, with
   *  `replaceIndex`, put it in place of the exercise there. */
  addLibraryExerciseToActive: (seed: SeedExercise, replaceIndex?: number) => Promise<void>;
  /** Move one exercise of the live session (the ⋯ menu's Move up / Move down). */
  moveExerciseInActive: (from: number, to: number) => void;
  /** Edit a catalog exercise's fields (name / logStyle / muscles / cues /
   *  effort standard / band override — `targetRepBand: null` clears it). */
  editCatalogExercise: (id: string, patch: ExercisePatch) => Promise<void>;
  /** Delete a catalog exercise (sessions/templates keep their name snapshot). */
  deleteCatalogExercise: (id: string) => Promise<void>;
  /** Merge `fromId` into `toId`, rewriting every referencing session/template. */
  mergeCatalogExercises: (fromId: string, toId: string) => Promise<void>;
  /** Add an exercise to the active session, creating a catalog entry first
   *  if `exerciseId` is null (free-typed name). Not a `SessionAction` because
   *  it resolves against the catalog with a ledger WRITE before the pure
   *  append; it dispatches `addExercise` once it has an id. */
  addExerciseToActive: (
    name: string, logStyle: LogStyle, exerciseId?: string, kind?: SetKind,
    /** Replace the exercise at this index instead of appending ("Replace
     *  exercise" in the live ⋯ menu). Its set count is kept, unlogged. */
    replaceIndex?: number,
  ) => Promise<void>;
  /**
   * Apply one structural edit to the active session and persist it.
   *
   * Replaces the seven callbacks this interface used to carry
   * (`removeExercise`, `addSet`, `addCluster`, `editSet`, `applySetPatch`,
   * `setSetKind`, `removeSet`), three of which were indistinguishable at the
   * call site while their doc comments described different write behaviour.
   * The edit itself is `applySessionAction` in `@macrolog/core` — pure, and
   * unit-tested there rather than through a renderer.
   *
   * `defer: true` updates local state WITHOUT writing, for a per-keystroke
   * edit that `commitActive` flushes on blur. Everything else persists
   * immediately. That is the only axis the old callbacks actually varied on.
   *
   * Reads the session from a ref rather than a closed-over value, so the
   * stale-closure hazard the old `applySetPatch` warned about in prose is gone
   * structurally — and `dispatch` keeps a stable identity across renders.
   */
  dispatch: (action: SessionAction, opts?: { defer?: boolean }) => Promise<void>;
  /** Flush the local active session to Firestore (call on input blur, after
   *  any `dispatch(..., { defer: true })`). */
  commitActive: () => Promise<void>;
  /** Complete the workout: drop empty sets, flip to completed, mirror
   *  bodyweight → dailyWeights + sleep → dailySleep, mark the day exercised.
   *
   *  LOCAL-FIRST since 2026-10-04 (Train review bug 2): the session is moved
   *  to the device's pending-finish list and cleared from the screen at once;
   *  the writes run behind it and are replayed after a restart until they
   *  land. A write the server REFUSES puts the session back as active with
   *  the error set, so nothing is lost. Resolves `true` once the finish is
   *  recorded on the device, `false` when there was no active session or the
   *  device could not record it AND the network write failed — so the screen
   *  keeps the Finish sheet open and does not fire the review prompt on a
   *  failure. Never rejects. */
  finishWorkout: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<boolean>;
  /** Abandon the active session (delete the doc). */
  discardWorkout: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  /** True while a COMPLETED session is loaded into `active` for editing (not a
   *  fresh in-progress workout) — drives the edit-specific chrome so "Discard"
   *  (delete) and the finish/bodyweight prompt don't apply to history edits. */
  editingExisting: boolean;
  /** Load a completed session into `active` as a working copy for editing. No
   *  status change (mirrors the web session-sheet: edits live-write via the
   *  same set callbacks). No-op if a workout is already active. */
  reopenSession: (session: WorkoutSession) => void;
  /** Finish editing a reopened session: flush the last edit and close, leaving
   *  it completed as it was — no bodyweight prompt, no re-mark-exercised. */
  finishEdit: () => Promise<void>;
  /** Cancel a reopened-session edit: since set edits live-write, this restores
   *  the session's pre-edit exercises to Firestore and closes the editor. */
  cancelEdit: () => Promise<void>;
}

/**
 * Finishes whose writes are out right now, by session id — shared by every
 * mount of the hook, because the replay on a remount must not start a second
 * copy of a finish the previous mount is still waiting on.
 */
const finishesInFlight = new Set<string>();

/** Test seam — a runtime restart forgets what was in flight. */
export function __resetFinishesInFlight(): void {
  finishesInFlight.clear();
}

export function useTrain(): TrainState {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const locale = useLocale();
  // Cached to disk on the way in, same as Today's slices. The setters are the
  // ones `onSnapshot` already calls, so the write-through is invisible here.
  const [catalog, setCatalog] = useCachedState<Exercise[]>(uid, 'exercises', []);
  const [templates, setTemplates] = useCachedState<WorkoutTemplate[]>(uid, 'templates', []);
  const [recentSessions, setRecentSessions, sessionsFromCache] = useCachedState<WorkoutSession[]>(
    uid,
    'workoutSessions',
    [],
  );
  const [active, setActiveState] = useState<WorkoutSession | null>(null);
  /**
   * Mirror of `active`, read by every mutation instead of a closed-over value.
   *
   * The old callbacks each computed their next state from `active` captured in
   * a `useCallback([active, persist])`, which is why one of them carried a "no
   * stale close-over" warning in its doc comment: any of the eight could
   * capture a stale session if it fired from a handler React had not yet
   * re-rendered. A ref cannot be stale, so the hazard is gone by construction
   * rather than by comment — and `dispatch` no longer depends on `active`, so
   * it keeps one identity across a whole workout instead of churning on every
   * keystroke.
   *
   * Every write to `active` goes through `setActive` below; nothing sets the
   * state directly, or the ref would drift from it.
   */
  const activeRef = useRef<WorkoutSession | null>(null);
  /** One debounced journal writer for the hook's life (lazy, so it is built
   *  once rather than on every render). See `createJournalWriter`. */
  const [journal] = useState(createJournalWriter);
  /**
   * Ids of sessions started on THIS device whose create has not been
   * acknowledged. Journaled as `created: false`, which is what lets a cold
   * start tell "never reached the server" from "finished elsewhere"
   * (`reconcileActiveSession`).
   */
  const uncreated = useRef(new Set<string>());
  const setActive = useCallback(
    (next: WorkoutSession | null) => {
      activeRef.current = next;
      setActiveState(next);
      // On the device BEFORE Firestore hears of it: the SDK's write queue is
      // memory-only on RN and dies with the runtime (`active-session-journal.ts`).
      // Debounced — one AsyncStorage write per burst of keystrokes, flushed on
      // blur, background and every start/finish (Train review item 30).
      if (uid && next) journal.write(uid, next, uncreated.current.has(next.id ?? '') ? false : undefined);
      // Every write to `active` goes through here, which is what makes this
      // the one honest place to tell the rest of the app a workout is open.
      // Not a shared subscription (ADR-0016) — one boolean and a name, no
      // listener, one producer. See `active-workout-signal.ts`.
      publishActiveWorkout(uid, next);
    },
    [uid, journal],
  );
  /**
   * The session the journal put on screen before the server answered, if it
   * is still the one showing. The server's answer may replace THAT; it never
   * replaces a session the user started or edited in the meantime.
   */
  const provisional = useRef<WorkoutSession | null>(null);
  // The profile through a ref: the finish replay runs from `onOpen`, whose
  // closure is captured once per focus, and must read today's day boundary.
  const profileRef = useRef(profile);
  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  // Flush the journal whenever the app leaves the foreground or the tab
  // blurs — the two moments a debounced write could otherwise be lost.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') void journal.flush();
    });
    return () => {
      sub.remove();
      void journal.flush();
    };
  }, [journal]);
  useFocusEffect(
    useCallback(() => () => void journal.flush(), [journal]),
  );
  const [editingExisting, setEditingExisting] = useState(false);
  // Pristine snapshot of a reopened completed session, captured before any
  // edit, so Cancel can restore it (set edits live-write, so they're already
  // in Firestore by the time the user changes their mind).
  const editOriginal = useRef<WorkoutSession | null>(null);
  const [saving, setSaving] = useState(false);
  // ONE error slot for both halves of the hook: the eight write verbs record
  // theirs here, and the feed is told to route a listener failure into the same
  // one rather than a second slot the screen would have to merge. The KIND
  // rides along so the screen can say "could not load" vs "did not save" —
  // until 2026-09-28 every failure rendered as the load message.
  const [errorState, setErrorState] = useState<{ error: Error; kind: TrainErrorKind } | null>(null);
  const error = errorState?.error ?? null;
  const errorKind = errorState?.kind ?? null;
  /** The write verbs' setter. */
  const setError = useCallback(
    (e: Error | null) => setErrorState(e ? { error: e, kind: 'save' } : null),
    [],
  );
  /** The feed's setter. */
  const setLoadError = useCallback(
    (e: Error | null) => setErrorState(e ? { error: e, kind: 'load' } : null),
    [],
  );

  // Focus-gated so the Train tab drops its live listeners when it blurs
  // (battery/network). Re-subscribes + reloads the active session on refocus.
  // See useToday. The three `subscribe*` calls stay this hook's own (ADR-0016).
  const feed = useLedgerFeed({
    uid,
    label: 'Train',
    gate: 'focus',
    onError: setLoadError,
    // One-shot load of any in-progress session so set edits aren't clobbered
    // by a live subscription mid-typing. `alive()` is the feed's — a resolve
    // that lands after the tab blurred must not revive a torn-down screen.
    onOpen: ({ uid: u, alive }) => {
      // Finishes recorded on the device and not yet heard by the server — a
      // restart since, or still in flight. Replayed until each lands.
      const finishes = readPendingFinishes(u);
      void finishes.then((list) => list.forEach((entry) => runFinish(u, entry)));
      const journalRead = readActiveSessionJournal(u);
      // The DEVICE first. A cold start offline waited on a server read that
      // the memory-only SDK cannot answer for seconds, and showed Start the
      // whole time — long enough to start a second workout over the one still
      // open (Train review bug 4). The journal is on the phone; show it now,
      // and let the server's answer correct it below.
      void Promise.all([journalRead, finishes]).then(([journal, list]) => {
        if (!alive() || editOriginal.current || activeRef.current || !journal) return;
        if (list.some((f) => f.session.id === journal.session.id)) return;
        // Carried forward, or the next journal write would forget that the
        // server never got this session's create.
        if (journal.created === false && journal.session.id) uncreated.current.add(journal.session.id);
        provisional.current = journal.session;
        setActive(journal.session);
      });
      Promise.all([
        // A failed read is an unreachable server, not an empty one.
        readActiveSession(u).catch(() => ({ session: null, fromCache: true })),
        journalRead,
        finishes,
      ])
        .then(([read, journal, list]) => {
          // Not while a COMPLETED session is open for editing. `reopenSession`
          // loads it into `active` without changing its status, so this query
          // answers `null` on every refocus — and writing that through closed
          // the editor while `editingExisting` and the Cancel snapshot stayed
          // set, leaving the NEXT workout started wearing the edit chrome:
          // "Done" then never marked it completed.
          if (!alive() || editOriginal.current) return;
          const local = activeRef.current;
          const fromJournal = local != null && local === provisional.current;
          provisional.current = null;
          // A session started, resumed or edited in THIS runtime wins. Every
          // write to it came from here, so the server's copy can only be equal
          // or behind — behind by any deferred edit not yet committed, or by
          // writes still queued on a slow connection. Replacing it threw those
          // away, and the next whole-array write made it permanent. (Until
          // 2026-10-04 this held only for the same id; a start tapped while
          // this read was in flight was then replaced by the read's `null`.)
          if (local && !fromJournal) return;
          // A fresh mount (cold start, OTA reload): the device journal wins
          // when it is newer than the server's last write — or when the server
          // could not be asked — and is written back so Firestore gets the
          // edits a dead runtime never sent.
          const { session, resync, recreate } = reconcileActiveSession(read.session, journal, {
            serverKnown: !read.fromCache,
            finishing: new Set(list.map((f) => f.session.id ?? '')),
          });
          if (session?.id) {
            if (recreate) uncreated.current.add(session.id);
            else uncreated.current.delete(session.id);
          }
          if (session !== local) setActive(session);
          if (session && resync) void (recreate ? writeWhole(session) : persist(session));
        })
        // Nothing to report: the read's own failure is handled above, and a
        // storage failure only costs the journal's head start.
        .catch(() => {});
    },
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'exercises',
              settles: 'none',
              open: (deliver) => subscribeExercises(uid, deliver),
              apply: setCatalog,
            }),
            feedChannel({
              key: 'templates',
              settles: 'none',
              open: (deliver) => subscribeTemplates(uid, deliver),
              apply: setTemplates,
            }),
            feedChannel<WorkoutSession[], 'sessions'>({
              key: 'sessions',
              // Only a SERVER answer ends the spinner on its own. An offline
              // listener's immediate empty cache hit is not an answer — the
              // disk cache (`sessionsFromCache`) or an error releases it.
              settles: 'server',
              open: (deliver, fail) => subscribeRecentSessions(uid, 50, deliver, fail),
              // Recent list shows completed sessions; the active one (if any)
              // is surfaced separately via `onOpen` above.
              apply: (sessions: WorkoutSession[], provenance) =>
                setRecentSessions(
                  sessions.filter((x) => x.status === 'completed'),
                  provenance,
                ),
            }),
          ]
        : [],
    deps: [uid],
  });

  // A workout in progress is not a moment to restart the runtime: an OTA
  // `reloadAsync` drops every set edit still queued in the SDK's memory-only
  // write queue (2026-10-02, `active-session-journal.ts`). Deferred, not
  // cancelled — it applies on the next foreground after Finish or Discard.
  useOtaHold(active?.status === 'active');

  // `feed.answered.sessions` replaces a plain `loading` flag, and the
  // distinction is the bug it fixes. The old flag started true and was cleared
  // in exactly ONE place — the sessions success callback — so an errored
  // listener (offline, a dropped connection) left it true forever. train.tsx
  // checks `loading` BEFORE it renders anything, and the `train.loadErr` string
  // it already has lives inside StartView, i.e. the else branch, so the one
  // screen that could explain the failure was unreachable exactly when it was
  // needed. The spinner now ends at whichever comes first — a server snapshot,
  // a cache hit, or an error — mirroring useToday.
  const loading = !feed.answered.sessions && !sessionsFromCache && !feed.failed;

  /** The whole document for a session, for a create that has to be (re)sent.
   *  The id names the doc; the timestamps are the writer's. */
  const writeWhole = useCallback(
    async (session: WorkoutSession) => {
      if (!uid || !session.id) return;
      const { id, createdAt: _createdAt, updatedAt: _updatedAt, ...draft } = session;
      try {
        await startSession(uid, draft as SessionDraft, id);
        uncreated.current.delete(id);
      } catch (e) {
        setError(asError(e, 'Save failed'));
      }
    },
    [uid, setError],
  );

  /**
   * How many session writes are waiting on the server. A counter, not a
   * boolean: two overlapping writes used to clear `saving` when the FIRST one
   * landed, while the second was still out.
   */
  const inFlight = useRef(0);

  /** Persist the current local active session. */
  const persist = useCallback(
    async (session: WorkoutSession) => {
      if (!uid || !session.id) return;
      inFlight.current += 1;
      setSaving(true);
      try {
        await updateSession(uid, session.id, {
          exercises: session.exercises,
          // Absent stays ABSENT. `toSessionPatch` writes the key only when it
          // is present, so a strength-only session never gains an empty array
          // — but a session that HAS cardio must carry it, and omitting it
          // here is a silent data loss rather than a rejected write: the block
          // renders, the summary updates, and Firestore never hears about it.
          // Measured on the LG G6 on 2026-08-24, by Maestro flow 21.
          ...(session.cardio !== undefined ? { cardio: session.cardio } : {}),
        });
      } catch (e) {
        // `not-found` on the session still on screen means its create never
        // reached the server (started offline, then a restart) — not that it
        // was deleted: a discard or finish clears `activeRef` before it
        // writes. So send the whole document instead of losing the workout.
        const code = (e as { code?: string } | null)?.code;
        if (code === 'not-found' && session.status === 'active' && activeRef.current?.id === session.id) {
          await writeWhole(activeRef.current);
        } else {
          setError(asError(e, 'Save failed'));
        }
      } finally {
        inFlight.current -= 1;
        if (inFlight.current === 0) setSaving(false);
      }
    },
    [uid, setError, writeWhole],
  );

  // One in-flight guard for every starter. `activeRef` alone is not one: it
  // was set only AFTER the create's round trip, so each tap on a slow or dead
  // connection queued another `status: 'active'` document (Train review
  // bug 1). The session is now on screen before any network, which closes
  // that window by itself; this keeps a re-entrant double tap out of it too.
  const starting = useRef(false);

  /**
   * Begin a live session from a draft: id minted HERE, session on screen and
   * journaled at once, create sent behind it. The create's failure surfaces as
   * a save error on the session itself (Train review bug 3), and a later edit
   * re-sends the whole document if the create never landed (`persist`).
   *
   * Both starters route their failure into `error` rather than letting the
   * promise reject. An uncaught reject here is not silent — it reaches Sentry
   * as an `onunhandledrejection` with no stack frames and no screen name, which
   * is exactly how IGNIA-MOBILE-6 arrived: unreadable, and invisible to the
   * user, who just saw the button do nothing.
   */
  const begin = useCallback(
    (draft: SessionDraft) => {
      if (!uid || activeRef.current || starting.current) return;
      starting.current = true;
      try {
        // A Firestore-shaped id (20 chars of [A-Za-z0-9]) from core, the same
        // minting the durable food queue uses — no SDK call, so no network.
        const id = newLedgerId(Math.random);
        const now = new Date();
        uncreated.current.add(id);
        setActive({ ...draft, id, createdAt: now, updatedAt: now });
        // The session's birth is not a keystroke: written now, not debounced.
        void journal.flush();
        startSession(uid, draft, id)
          .then(() => {
            uncreated.current.delete(id);
            const current = activeRef.current;
            if (current?.id === id) journal.write(uid, current);
          })
          .catch((e) => setError(asError(e, 'Start failed')));
      } finally {
        starting.current = false;
      }
    },
    [uid, setActive, journal, setError],
  );

  const startWorkout = useCallback(async () => {
    begin({ status: 'active', date: new Date(), exercises: [] });
  }, [begin]);

  /**
   * Start a session that is cardio only — a run with no lifting.
   *
   * Not a variant of {@link startWorkout} with a follow-up dispatch, because
   * that would write the doc twice and leave a window where an empty session
   * exists. It is the same session shape either way: `exercises: []` plus one
   * block, which is what keeps a run inside Train's single history rather than
   * in a second one (ADR-0025).
   */
  const startCardioWorkout = useCallback(
    async (modality: CardioModality) => {
      begin({
        status: 'active',
        date: new Date(),
        exercises: [],
        cardio: [newCardioBlock(modality)],
      });
    },
    [begin],
  );

  const startFromTemplate = useCallback(
    async (template: WorkoutTemplate) => {
      if (!uid || activeRef.current) return;
      // The engine's call for each lift is FROZEN onto the session at start
      // (progression engine: "every override must be logged"). It is computed
      // from the same completed history the card reads, so what the session
      // stores is exactly what the lifter was shown. A straight-set lift gets
      // no snapshot: the engine has nothing to say about it.
      const completed = recentSessions.filter((s) => s.status === 'completed');
      const exercises = templateToSessionExercises(template).map((se) => {
        const history = exerciseHistory(completed, se.exerciseId);
        const rec = recommend(
          history,
          recommendOptionsFor(
            template.exercises.find((e) => e.exerciseId === se.exerciseId) ?? null,
            catalog.find((e) => e.id === se.exerciseId) ?? null,
          ),
        );
        if (rec.action === 'none') return se;
        const basedOn = completed.find((s) => s.exercises.includes(history[0]))?.date;
        return { ...se, recommendation: toRecommendationSnapshot(rec, basedOn) };
      });
      begin({
        status: 'active',
        date: new Date(),
        templateId: template.id,
        templateName: template.name,
        exercises,
        cardio: templateToSessionCardio(template),
      });
    },
    [uid, begin, recentSessions, catalog],
  );

  /**
   * Run (or replay) one recorded finish against the server, and forget it
   * once it lands. Idempotent across the two callers — the finish itself and
   * the replay on the next mount — through `finishesInFlight`.
   *
   * A REFUSED write (the SDK retries network failures on its own, so a
   * rejection here is permanent: rules, a deleted account) does not lose the
   * workout: it is put back on screen as active, with the error, where Finish
   * can be tried again or the session discarded on purpose.
   */
  const runFinish = useCallback(
    (u: string, entry: PendingFinish) => {
      const id = entry.session.id;
      if (!id || finishesInFlight.has(id)) return;
      finishesInFlight.add(id);
      // ADR-0030: the boundary is derived here, from the profile the auth
      // context already holds, and passed down rather than re-read.
      finishWorkoutOp(u, entry.session, dayBoundaryOf(profileRef.current), entry.extras)
        .then(() => removePendingFinish(u, id))
        .catch((e) => {
          void removePendingFinish(u, id);
          setError(asError(e, 'Finish failed'));
          if (!activeRef.current && u === uid) setActive({ ...entry.session, status: 'active' });
        })
        .finally(() => finishesInFlight.delete(id));
    },
    [uid, setActive, setError],
  );

  const saveTemplate = useCallback(
    async (draft: TemplateDraft, id?: string) => {
      if (!uid) return;
      if (id) await updateTemplateDoc(uid, id, draft);
      else await addTemplateDoc(uid, draft);
    },
    [uid],
  );

  const deleteTemplate = useCallback(
    async (id: string) => {
      if (uid) await deleteTemplateDoc(uid, id);
    },
    [uid],
  );

  /**
   * The catalog id for a shipped library movement, creating the entry if it is
   * missing.
   *
   * Lifted out of `cloneStarterTemplate`, which was the ONLY path that ever
   * wrote muscles and cues onto a catalog doc. Every other door — the
   * template editor's adder, the in-session add sheet — wrote
   * `muscles: []`, so a movement acquired its muscle group purely by accident
   * of how it was first added. Dedupe is by `seedKey` first (stable across a
   * locale switch) and by case-insensitive name second (pre-`seedKey` clones).
   */
  const ensureLibraryExercise = useCallback(
    async (seed: SeedExercise) => {
      if (!uid) throw new Error('Not signed in');
      const name = seedExerciseName(seed, locale);
      const logStyle: LogStyle = seed.logStyle ?? 'weight-reps';
      const existing = catalog.find(
        (c) =>
          (c.seedKey && c.seedKey === seed.key) ||
          c.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing?.id) return { id: existing.id, name: existing.name, logStyle: existing.logStyle ?? logStyle };
      const id = await addExerciseDoc(uid, {
        name,
        muscles: seed.muscles,
        defaultCues: seedExerciseCues(seed, locale),
        logStyle,
        seedKey: seed.key,
      });
      return { id, name, logStyle };
    },
    [uid, catalog, locale],
  );

  const cloneStarterTemplate = useCallback(
    async (seed: SeedTemplate) => {
      if (!uid) return;
      const exercises: TemplateExercise[] = [];
      const made = new Map<string, { id: string; name: string; logStyle: LogStyle }>();
      for (const se of seed.exercises) {
        const lib = findSeedExercise(se.key);
        // Resolve display name/cues for the active locale, then store as the
        // user's own data. Dedupe by the stable seedKey (falling back to the
        // resolved name for pre-seedKey clones) so re-cloning — even in another
        // locale — reuses the existing catalog entry instead of splitting
        // history/e1RM across a duplicate.
        // Both of these were hardcoded `'weight-reps'` before ADR-0028, which
        // is right for every lift in the library and wrong for a mobility
        // movement: a timed hold logged as load x reps has no field to put the
        // hold in.
        let name = lib ? seedExerciseName(lib, locale) : se.key;
        let logStyle: LogStyle = lib?.logStyle ?? 'weight-reps';
        let id: string;
        // `ensureLibraryExercise` reads `catalog` from the closure, which does
        // not update between iterations of this loop — so a template naming
        // the same movement twice would mint it twice. The memo is that
        // within-call dedupe, and it is why this loop cannot just call the
        // helper blind.
        const madeHere = made.get(se.key);
        if (madeHere) {
          ({ id, name, logStyle } = madeHere);
        } else if (lib) {
          const entry = await ensureLibraryExercise(lib);
          made.set(se.key, entry);
          ({ id, name, logStyle } = entry);
        } else {
          // A template referencing a key the library does not carry. Nothing
          // to inherit; keep the pre-existing behaviour of minting by key.
          const existing = catalog.find((c) => c.seedKey === se.key || c.name.toLowerCase() === name.toLowerCase());
          id = existing?.id ?? (await addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle, seedKey: se.key }));
          made.set(se.key, { id, name, logStyle });
        }
        exercises.push({
          exerciseId: id,
          name,
          targetLoad: se.targetLoad,
          cues: seedTemplateExerciseCues(seed.key, se, lib, locale),
          logStyle: logStyle,
          progression: se.progression,
          plannedSets: se.plannedSets,
        });
      }
      await addTemplateDoc(uid, {
        name: seedTemplateName(seed, locale),
        notes: seedTemplateNotes(seed, locale),
        restMiniSec: seed.restMiniSec,
        restClusterSec: seed.restClusterSec,
        exercises,
        seedKey: seed.key,
      });
    },
    [uid, catalog, locale, ensureLibraryExercise],
  );

  /**
   * Apply one pure {@link SessionAction} and persist, unless deferred.
   *
   * The whole body of what used to be seven callbacks: read the current session
   * from the ref, run the reducer, store the result, write it. `applySessionAction`
   * returns the SAME reference when an action changes nothing (an out-of-range
   * index), so that case costs no render and no write.
   */
  const dispatch = useCallback(
    async (action: SessionAction, opts?: { defer?: boolean }) => {
      const prev = activeRef.current;
      if (!prev) return;
      const next = applySessionAction(prev, action);
      if (next === prev) return;
      setActive(next);
      // Not awaited: the session is already on screen and journaled, and the
      // RN SDK resolves a write only on the server's ack — offline, awaiting
      // here held every caller (an add sheet, a Finish) until the signal came
      // back (Train review bugs 2, 3). A refusal still lands in `error`.
      if (!opts?.defer) void persist(next);
    },
    [persist, setActive],
  );

  const commitActive = useCallback(async () => {
    const current = activeRef.current;
    if (current) await persist(current);
  }, [persist]);

  const addLibraryExercise = useCallback(
    (seed: SeedExercise) => ensureLibraryExercise(seed),
    [ensureLibraryExercise],
  );

  const addCatalogExercise = useCallback(
    async (name: string, logStyle: LogStyle) => {
      if (!uid) throw new Error('Not signed in');
      // An exact name match against the library carries real metadata the
      // free-type path would otherwise throw away. Exact only: a fuzzy match
      // would silently attach the wrong muscle group to a movement the user
      // named deliberately (`findSeedExerciseByName`).
      const seed = findSeedExerciseByName(name, locale);
      if (seed) return (await ensureLibraryExercise(seed)).id;
      return addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle });
    },
    [uid, locale, ensureLibraryExercise],
  );

  const editCatalogExercise = useCallback(
    async (id: string, patch: ExercisePatch) => {
      if (uid) await editExerciseDoc(uid, id, patch);
    },
    [uid],
  );

  const deleteCatalogExercise = useCallback(
    async (id: string) => {
      if (uid) await deleteExerciseDoc(uid, id);
    },
    [uid],
  );

  const mergeCatalogExercises = useCallback(
    async (fromId: string, toId: string) => {
      if (uid) await mergeExercisesDoc(uid, fromId, toId);
    },
    [uid],
  );

  /**
   * Put a freshly built exercise into the live session — appended, or in place
   * of the one at `replaceIndex`. A replacement keeps the slot's SET COUNT
   * (the plan was "four sets of something") but none of its numbers: they
   * belonged to the other lift.
   */
  const placeExercise = useCallback(
    async (exercise: SessionExercise, replaceIndex?: number) => {
      const prev = activeRef.current;
      if (!prev) return;
      const old = replaceIndex != null ? prev.exercises[replaceIndex] : undefined;
      if (!old) {
        await dispatch({ type: 'addExercise', exercise });
        return;
      }
      const kind = exercise.sets[0]?.kind ?? 'working';
      const placed: SessionExercise = {
        ...exercise,
        sets: old.sets.map(() => newWorkoutSet(kind)),
      };
      const next = {
        ...prev,
        exercises: prev.exercises.map((e, i) => (i === replaceIndex ? placed : e)),
      };
      setActive(next);
      void persist(next);
    },
    [dispatch, setActive, persist],
  );

  const moveExerciseInActive = useCallback(
    (from: number, to: number) => {
      const prev = activeRef.current;
      if (!prev) return;
      const exercises = moveExercise(prev.exercises, from, to);
      if (exercises === prev.exercises) return;
      const next = { ...prev, exercises };
      setActive(next);
      void persist(next);
    },
    [setActive, persist],
  );

  const addExerciseToActive = useCallback(
    async (
      name: string,
      logStyle: LogStyle,
      exerciseId?: string,
      kind: SetKind = 'working',
      replaceIndex?: number,
    ) => {
      // The ref, not a closed-over `active` — this callback's deps no longer
      // track the session, so a captured value would be pinned at null forever.
      if (!uid || !activeRef.current) return;
      let id = exerciseId;
      // Snapshot the CANONICAL catalog name, not what was typed. Sessions
      // store a name snapshot for display, so reusing an entry while keeping
      // the typed casing would show "bench press" in history next to
      // "Bench Press" everywhere else — the cosmetic half of the very
      // fragmentation this dedupe exists to prevent.
      let canonical = name;
      if (!id) {
        // Reuse an existing catalog entry whose name differs only by case or
        // spacing. Without this, typing "bench press" when "Bench Press"
        // already exists mints a second doc id — and progression history is
        // keyed by exerciseId, so the two never join up again.
        const dupe = findDuplicateExercise(name, catalog);
        if (dupe?.id) {
          id = dupe.id;
          canonical = dupe.name;
        }
      }
      if (!id) {
        // Same rule as `addCatalogExercise`: an exact library name brings its
        // muscles and cues with it rather than minting an unattributable doc.
        const seed = findSeedExerciseByName(name, locale);
        if (seed) {
          const made = await ensureLibraryExercise(seed);
          id = made.id;
          canonical = made.name;
        } else {
          id = await addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle });
        }
      }
      const exercise: SessionExercise = {
        exerciseId: id,
        name: canonical,
        cues: [],
        logStyle,
        // `kind` so a stretch added mid-session is a mobility set, not a
        // working one that can take a duration PR (ADR-0028). The template
        // editor's creation chip fixed the same defect on the other door.
        sets: [newWorkoutSet(kind)],
      };
      await placeExercise(exercise, replaceIndex);
    },
    [uid, catalog, placeExercise, locale, ensureLibraryExercise],
  );

  /**
   * Add a shipped library movement to the live session.
   *
   * Not `addExerciseToActive(seed.name, ...)`: that would round-trip the
   * movement through a name lookup it does not need, and a locale whose
   * translation of the name happens to collide with a user-created exercise
   * would resolve to the wrong doc. The seed key is the identity here.
   */
  const addLibraryExerciseToActive = useCallback(
    async (seed: SeedExercise, replaceIndex?: number) => {
      if (!uid || !activeRef.current) return;
      const { id, name, logStyle } = await ensureLibraryExercise(seed);
      const exercise: SessionExercise = {
        exerciseId: id,
        name,
        cues: seedExerciseCues(seed, locale),
        logStyle,
        // A seeded mobility movement stays mobility, so a stretch added
        // mid-session cannot take a duration PR (ADR-0028).
        sets: [newWorkoutSet(logStyle === 'time' ? 'mobility' : 'working')],
      };
      await placeExercise(exercise, replaceIndex);
    },
    [uid, locale, ensureLibraryExercise, placeExercise],
  );


  // A second Complete tap while the first is recording is a no-op.
  const finishing = useRef(false);

  const finishWorkout = useCallback(
    async (extras: { bodyweight?: number; sleepHours?: number }): Promise<boolean> => {
      const active = activeRef.current;
      if (!uid || !active?.id || finishing.current) return false;
      finishing.current = true;
      setSaving(true);
      try {
        const entry: PendingFinish = { savedAt: Date.now(), session: active, extras };
        try {
          // On the device FIRST — this is what the screen moving on rests on.
          await recordPendingFinish(uid, entry);
        } catch {
          // No durable copy (storage full or unavailable): fall back to the
          // old contract and wait on the network, so a failure keeps the
          // sheet open with the typed values instead of losing the workout.
          try {
            await finishWorkoutOp(uid, active, dayBoundaryOf(profileRef.current), extras);
          } catch (e) {
            // `false`, not a rethrow: the screen used to `await` this inside a
            // handler that then closed the Finish sheet and fired the review
            // prompt regardless. A boolean makes "did it land" a value the
            // handler has to look at; the error itself still surfaces.
            setError(asError(e, 'Finish failed'));
            return false;
          }
          journal.cancel();
          void clearActiveSessionJournal(uid);
          setActive(null);
          return true;
        }
        // The pending finish IS the durable copy now: drop any queued journal
        // write (it would bring the active session back) and the journal.
        journal.cancel();
        void clearActiveSessionJournal(uid);
        setActive(null);
        // The six-step sequence itself lives in `ledger-ops.ts`, where it is
        // reachable without a renderer — the pruning order, the weight
        // backstop and which half is fire-and-forget are asserted there.
        runFinish(uid, entry);
        return true;
      } finally {
        finishing.current = false;
        setSaving(inFlight.current > 0);
      }
    },
    [uid, setActive, setError, journal, runFinish],
  );

  const discardWorkout = useCallback(async () => {
    const active = activeRef.current;
    if (!uid || !active?.id) return;
    // Clear the ref BEFORE the delete round-trip, not after. Discard has no
    // confirmation, so the tap can land while a set input still has focus;
    // its blur-commit (and any deferred dispatch) reads `activeRef` and would
    // write to the doc the delete is in the middle of removing. With the ref
    // already null, `dispatch`/`commitActive` see no session and write nothing.
    setActive(null);
    // The user asked for it gone; a journal must not bring it back — not the
    // stored one, and not a debounced write still waiting to land.
    journal.cancel();
    void clearActiveSessionJournal(uid);
    try {
      await deleteSessionDoc(uid, active.id);
    } catch (e) {
      // Same reasoning as the starters: an uncaught reject here reaches Sentry
      // with no stack and no screen. Surface it on the tab instead.
      setError(asError(e, 'Discard failed'));
    }
  }, [uid, setActive, journal, setError]);

  const deleteSession = useCallback(
    async (id: string) => {
      if (!uid) return;
      try {
        await deleteSessionDoc(uid, id);
      } catch (e) {
        // The screen fires this from a confirm sheet as `void deleteSession(id)`;
        // an uncaught reject there reaches Sentry with no stack and no screen,
        // the same as every other verb here. Surface it on the tab instead.
        setError(asError(e, 'Delete failed'));
      }
    },
    [uid, setError],
  );

  const reopenSession = useCallback(
    (session: WorkoutSession) => {
      // Single-active invariant: don't clobber a live in-progress workout.
      if (activeRef.current || !session.id) return;
      // Snapshot the pristine session for Cancel. The edit callbacks replace
      // (map/spread) rather than mutate, so this reference stays untouched.
      editOriginal.current = session;
      setEditingExisting(true);
      setActive(session);
    },
    [setActive],
  );

  const finishEdit = useCallback(async () => {
    // Edits already live-write through dispatch; flush the final state (an
    // input may still hold focus) and drop any empty sets, exactly like
    // finishWorkout — but leave status/date/bodyweight/sleep untouched.
    //
    // The editor closes FIRST and the write runs behind it: offline, the
    // update resolves only when the signal returns, and "Done" used to sit
    // there until it did. A refusal still surfaces on the tab.
    const active = activeRef.current;
    editOriginal.current = null;
    setActive(null);
    setEditingExisting(false);
    if (uid && active?.id) {
      try {
        await updateSession(uid, active.id, { exercises: dropEmptySets(fillMissingClusterLoads(active.exercises)) });
      } catch (e) {
        setError(asError(e, 'Save failed'));
      }
    }
  }, [uid, setActive, setError]);

  const cancelEdit = useCallback(async () => {
    // Set edits live-write, so cancelling means restoring the pre-edit
    // exercises snapshotted at reopen — otherwise partial edits would stick.
    // Closed first, written behind, for the same reason as `finishEdit`.
    const original = editOriginal.current;
    editOriginal.current = null;
    setActive(null);
    setEditingExisting(false);
    if (uid && original?.id) {
      try {
        await updateSession(uid, original.id, { exercises: original.exercises });
      } catch (e) {
        setError(asError(e, 'Restore failed'));
      }
    }
  }, [uid, setActive, setError]);

  const clearError = useCallback(() => setErrorState(null), []);

  // ONE object per change, not per render. Every screen component used to
  // receive a fresh `train` on each render of the tab, so nothing below it
  // could memoize — `TemplateNextSession`'s `useMemo([train, template])` never
  // hit once (Train review bug 12). The verbs are stable callbacks; only the
  // data fields move this.
  return useMemo(
    () => ({
      loading,
      error,
      errorKind,
      clearError,
      catalog,
      templates,
      recentSessions,
      active,
      saving,
      startWorkout,
      startFromTemplate,
      startCardioWorkout,
      saveTemplate,
      deleteTemplate,
      cloneStarterTemplate,
      addCatalogExercise,
      addLibraryExercise,
      addLibraryExerciseToActive,
      editCatalogExercise,
      deleteCatalogExercise,
      mergeCatalogExercises,
      addExerciseToActive,
      moveExerciseInActive,
      dispatch,
      commitActive,
      finishWorkout,
      discardWorkout,
      deleteSession,
      editingExisting,
      reopenSession,
      finishEdit,
      cancelEdit,
    }),
    [
      loading, error, errorKind, clearError, catalog, templates, recentSessions, active, saving,
      startWorkout, startFromTemplate, startCardioWorkout, saveTemplate, deleteTemplate,
      cloneStarterTemplate, addCatalogExercise, addLibraryExercise, addLibraryExerciseToActive,
      editCatalogExercise, deleteCatalogExercise, mergeCatalogExercises, addExerciseToActive,
      moveExerciseInActive, dispatch, commitActive, finishWorkout, discardWorkout, deleteSession,
      editingExisting, reopenSession, finishEdit, cancelEdit,
    ],
  );
}
