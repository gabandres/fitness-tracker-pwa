import { useCallback, useRef, useState } from 'react';
import { useCachedState } from '@/hooks/useCachedState';
import { asError, feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { finishWorkout as finishWorkoutOp } from '@/lib/ledger-ops';
import { useAuth } from '@/lib/auth';
import {
  addExercise as addExerciseDoc,
  addTemplate as addTemplateDoc,
  deleteExercise as deleteExerciseDoc,
  deleteSession as deleteSessionDoc,
  deleteTemplate as deleteTemplateDoc,
  editExercise as editExerciseDoc,
  getActiveSession,
  mergeExercises as mergeExercisesDoc,
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
  newCardioBlock,
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

export interface TrainState {
  loading: boolean;
  error: Error | null;
  /** Exercise catalog (alphabetical). */
  catalog: Exercise[];
  /** Reusable workout templates, most-recently-updated first. */
  templates: WorkoutTemplate[];
  /** Completed sessions, newest first. */
  recentSessions: WorkoutSession[];
  /** The in-progress session held in local state, or null. */
  active: WorkoutSession | null;
  saving: boolean;
  /** Begin a new empty active session (persisted immediately so it survives
   *  a reload). No-op if one is already active. */
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
  /** Add a shipped library movement straight to the active session. */
  addLibraryExerciseToActive: (seed: SeedExercise) => Promise<void>;
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
   *  bodyweight → dailyWeights + sleep → dailySleep, mark the day exercised. */
  finishWorkout: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<void>;
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
  const setActive = useCallback(
    (next: WorkoutSession | null) => {
      activeRef.current = next;
      setActiveState(next);
      // Every write to `active` goes through here, which is what makes this
      // the one honest place to tell the rest of the app a workout is open.
      // Not a shared subscription (ADR-0016) — one boolean and a name, no
      // listener, one producer. See `active-workout-signal.ts`.
      publishActiveWorkout(uid, next);
    },
    [uid],
  );
  const [editingExisting, setEditingExisting] = useState(false);
  // Pristine snapshot of a reopened completed session, captured before any
  // edit, so Cancel can restore it (set edits live-write, so they're already
  // in Firestore by the time the user changes their mind).
  const editOriginal = useRef<WorkoutSession | null>(null);
  const [saving, setSaving] = useState(false);
  // ONE error slot for both halves of the hook: the eight write verbs record
  // theirs here, and the feed is told to route a listener failure into the same
  // one rather than a second slot the screen would have to merge.
  const [error, setError] = useState<Error | null>(null);

  // Focus-gated so the Train tab drops its live listeners when it blurs
  // (battery/network). Re-subscribes + reloads the active session on refocus.
  // See useToday. The three `subscribe*` calls stay this hook's own (ADR-0016).
  const feed = useLedgerFeed({
    uid,
    label: 'Train',
    gate: 'focus',
    onError: setError,
    // One-shot load of any in-progress session so set edits aren't clobbered
    // by a live subscription mid-typing. `alive()` is the feed's — a resolve
    // that lands after the tab blurred must not revive a torn-down screen.
    onOpen: ({ uid: u, alive, fail }) => {
      getActiveSession(u)
        .then((session) => {
          if (alive()) setActive(session);
        })
        .catch(fail);
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

  /** Persist the current local active session. */
  const persist = useCallback(
    async (session: WorkoutSession) => {
      if (!uid || !session.id) return;
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
        setError(asError(e, 'Save failed'));
      } finally {
        setSaving(false);
      }
    },
    [uid],
  );

  // Both starters route their failure into `error` rather than letting the
  // promise reject. An uncaught reject here is not silent — it reaches Sentry
  // as an `onunhandledrejection` with no stack frames and no screen name, which
  // is exactly how IGNIA-MOBILE-6 arrived: unreadable, and invisible to the
  // user, who just saw the button do nothing.
  const startWorkout = useCallback(async () => {
    if (!uid || activeRef.current) return;
    const draft = { status: 'active' as const, date: new Date(), exercises: [] };
    try {
      const id = await startSession(uid, draft);
      setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
    } catch (e) {
      setError(asError(e, 'Start failed'));
    }
  }, [uid, setActive]);

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
      if (!uid || activeRef.current) return;
      const draft = {
        status: 'active' as const,
        date: new Date(),
        exercises: [],
        cardio: [newCardioBlock(modality)],
      };
      try {
        const id = await startSession(uid, draft);
        setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
      } catch (e) {
        setError(asError(e, 'Start failed'));
      }
    },
    [uid, setActive],
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
      const draft = {
        status: 'active' as const,
        date: new Date(),
        templateId: template.id,
        templateName: template.name,
        exercises,
        cardio: templateToSessionCardio(template),
      };
      try {
        const id = await startSession(uid, draft);
        setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
      } catch (e) {
        setError(asError(e, 'Start failed'));
      }
    },
    [uid, setActive, recentSessions, catalog],
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
      if (!opts?.defer) await persist(next);
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

  const addExerciseToActive = useCallback(
    async (name: string, logStyle: LogStyle, exerciseId?: string, kind: SetKind = 'working') => {
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
      await dispatch({ type: 'addExercise', exercise });
    },
    [uid, catalog, dispatch, locale, ensureLibraryExercise],
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
    async (seed: SeedExercise) => {
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
      await dispatch({ type: 'addExercise', exercise });
    },
    [uid, locale, ensureLibraryExercise, dispatch],
  );


  const finishWorkout = useCallback(
    async (extras: { bodyweight?: number; sleepHours?: number }) => {
      const active = activeRef.current;
      if (!uid || !active?.id) return;
      setSaving(true);
      try {
        // The six-step sequence itself lives in `ledger-ops.ts`, where it is
        // reachable without a renderer — the pruning order, the weight
        // backstop and which half is fire-and-forget are asserted there. This
        // hook keeps only what is React's: the saving flag, clearing the
        // active session, and turning a rejection into a visible error.
        // ADR-0030: the boundary is derived here, from the profile the auth
        // context already holds, and passed down rather than re-read.
        await finishWorkoutOp(uid, active, dayBoundaryOf(profile), extras);
        setActive(null);
      } catch (e) {
        setError(asError(e, 'Finish failed'));
      } finally {
        setSaving(false);
      }
    },
    [uid, setActive],
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
    try {
      await deleteSessionDoc(uid, active.id);
    } catch (e) {
      // Same reasoning as the starters: an uncaught reject here reaches Sentry
      // with no stack and no screen. Surface it on the tab instead.
      setError(asError(e, 'Discard failed'));
    }
  }, [uid, setActive]);

  const deleteSession = useCallback(
    async (id: string) => {
      if (uid) await deleteSessionDoc(uid, id);
    },
    [uid],
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
    const active = activeRef.current;
    if (uid && active?.id) {
      setSaving(true);
      try {
        await updateSession(uid, active.id, { exercises: dropEmptySets(fillMissingClusterLoads(active.exercises)) });
      } catch (e) {
        setError(asError(e, 'Save failed'));
      } finally {
        setSaving(false);
      }
    }
    editOriginal.current = null;
    setActive(null);
    setEditingExisting(false);
  }, [uid, setActive]);

  const cancelEdit = useCallback(async () => {
    // Set edits live-write, so cancelling means restoring the pre-edit
    // exercises snapshotted at reopen — otherwise partial edits would stick.
    const original = editOriginal.current;
    if (uid && original?.id) {
      setSaving(true);
      try {
        await updateSession(uid, original.id, { exercises: original.exercises });
      } catch (e) {
        setError(asError(e, 'Restore failed'));
      } finally {
        setSaving(false);
      }
    }
    editOriginal.current = null;
    setActive(null);
    setEditingExisting(false);
  }, [uid, setActive]);

  return {
    loading,
    error,
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
    dispatch,
    commitActive,
    finishWorkout,
    discardWorkout,
    deleteSession,
    editingExisting,
    reopenSession,
    finishEdit,
    cancelEdit,
  };
}
