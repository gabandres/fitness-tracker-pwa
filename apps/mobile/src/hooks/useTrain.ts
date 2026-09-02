import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { trackSubs } from '@/lib/sub-debug';
import { useCachedState } from '@/hooks/useCachedState';
import { track } from '@/lib/analytics';
import { exportDaily, exportWorkout } from '@/lib/health-sync';
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
  markExercised,
  setDailySleep,
  setDailyWeight,
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
  dayKeyAt,
  newCardioBlock,
  newWorkoutSet,
} from '@macrolog/core';
import {
  type Exercise,
  type ExerciseDraft,
  type LogStyle,
  type SessionExercise,
  type SetKind,
  type TemplateDraft,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutTemplate,
  dropEmptyCardio,
  dropEmptySets,
  templateToSessionCardio,
  templateToSessionExercises,
} from '@/lib/workout';
import type { CardioModality } from '@macrolog/core/cardio';
import {
  type SeedTemplate,
  fillMissingClusterLoads,
  findSeedExercise,
  isStorableWeight,
  seedExerciseCues,
  seedExerciseName,
  seedTemplateExerciseCues,
  seedTemplateName,
  seedTemplateNotes,
} from '@macrolog/core';
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
   *  editor when adding a free-typed exercise). */
  addCatalogExercise: (name: string, logStyle: LogStyle) => Promise<string>;
  /** Edit a catalog exercise's fields (name / logStyle / muscles / cues). */
  editCatalogExercise: (id: string, patch: Partial<ExerciseDraft>) => Promise<void>;
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
  const setActive = useCallback((next: WorkoutSession | null) => {
    activeRef.current = next;
    setActiveState(next);
  }, []);
  const [editingExisting, setEditingExisting] = useState(false);
  // Pristine snapshot of a reopened completed session, captured before any
  // edit, so Cancel can restore it (set edits live-write, so they're already
  // in Firestore by the time the user changes their mind).
  const editOriginal = useRef<WorkoutSession | null>(null);
  // `snapshotArrived` replaces a plain `loading` flag, and the distinction is
  // the bug it fixes. The old flag started true and was cleared in exactly ONE
  // place — the sessions success callback — so an errored listener (offline, a
  // dropped connection) left it true forever. train.tsx checks `loading` BEFORE
  // it renders anything, and the `train.loadErr` string it already has lives
  // inside StartView, i.e. the else branch, so the one screen that could
  // explain the failure was unreachable exactly when it was needed. Now the
  // spinner ends at whichever comes first — a snapshot, a cache hit, or an
  // error — mirroring useToday.
  const [snapshotArrived, setSnapshotArrived] = useState(false);
  const [errored, setErrored] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  /** Record the error AND release the spinner, so the failure can be shown. */
  const failWith = useCallback((e: Error) => {
    setError(e);
    setErrored(true);
  }, []);
  const loading = !snapshotArrived && !sessionsFromCache && !errored;

  // Focus-gated so the Train tab drops its live listeners when it blurs
  // (battery/network). Re-subscribes + reloads the active session on refocus.
  // See useToday.
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      let alive = true;
      const unsubs = [
        subscribeExercises(uid, (rows, meta) =>
          setCatalog(rows, { authoritative: !meta?.fromCache }),
        ),
        subscribeTemplates(uid, (rows, meta) =>
          setTemplates(rows, { authoritative: !meta?.fromCache }),
        ),
        subscribeRecentSessions(
          uid,
          50,
          (s, meta) => {
            // Recent list shows completed sessions; the active one (if any) is
            // surfaced separately via getActiveSession below.
            const authoritative = !meta?.fromCache;
            setRecentSessions(s.filter((x) => x.status === 'completed'), { authoritative });
            // Only a SERVER answer ends the spinner on its own. An offline
            // listener's immediate empty cache hit is not an answer — the disk
            // cache (`sessionsFromCache`) or an error releases it instead.
            if (authoritative) setSnapshotArrived(true);
          },
          failWith,
        ),
      ];
      // One-shot load of any in-progress session so set edits aren't clobbered
      // by a live subscription mid-typing.
      getActiveSession(uid)
        .then((s) => {
          if (alive) setActive(s);
        })
        .catch(failWith);
      const stop = trackSubs('Train', unsubs);
      return () => {
        alive = false;
        stop();
      };
    }, [uid]),
  );

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
        setError(e instanceof Error ? e : new Error('Save failed'));
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
      setError(e instanceof Error ? e : new Error('Start failed'));
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
        setError(e instanceof Error ? e : new Error('Start failed'));
      }
    },
    [uid, setActive],
  );

  const startFromTemplate = useCallback(
    async (template: WorkoutTemplate) => {
      if (!uid || activeRef.current) return;
      const draft = {
        status: 'active' as const,
        date: new Date(),
        templateId: template.id,
        templateName: template.name,
        exercises: templateToSessionExercises(template),
        cardio: templateToSessionCardio(template),
      };
      try {
        const id = await startSession(uid, draft);
        setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Start failed'));
      }
    },
    [uid, setActive],
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

  const cloneStarterTemplate = useCallback(
    async (seed: SeedTemplate) => {
      if (!uid) return;
      const exercises: TemplateExercise[] = [];
      for (const se of seed.exercises) {
        const lib = findSeedExercise(se.key);
        // Resolve display name/cues for the active locale, then store as the
        // user's own data. Dedupe by the stable seedKey (falling back to the
        // resolved name for pre-seedKey clones) so re-cloning — even in another
        // locale — reuses the existing catalog entry instead of splitting
        // history/e1RM across a duplicate.
        const name = lib ? seedExerciseName(lib, locale) : se.key;
        // Both of these were hardcoded `'weight-reps'` before ADR-0028, which
        // is right for every lift in the library and wrong for a mobility
        // movement: a timed hold logged as load x reps has no field to put the
        // hold in.
        const logStyle: LogStyle = lib?.logStyle ?? 'weight-reps';
        const existing = catalog.find(
          (c) =>
            (c.seedKey && c.seedKey === se.key) ||
            c.name.toLowerCase() === name.toLowerCase(),
        );
        const id =
          existing?.id ??
          (await addExerciseDoc(uid, {
            name,
            muscles: lib?.muscles ?? [],
            defaultCues: lib ? seedExerciseCues(lib, locale) : [],
            logStyle: logStyle,
            seedKey: se.key,
          }));
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
    [uid, catalog, locale],
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

  const addCatalogExercise = useCallback(
    async (name: string, logStyle: LogStyle) => {
      if (!uid) throw new Error('Not signed in');
      return addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle });
    },
    [uid],
  );

  const editCatalogExercise = useCallback(
    async (id: string, patch: Partial<ExerciseDraft>) => {
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
        id = await addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle });
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
    [uid, catalog, dispatch],
  );


  const finishWorkout = useCallback(
    async (extras: { bodyweight?: number; sleepHours?: number }) => {
      const active = activeRef.current;
      if (!uid || !active?.id) return;
      setSaving(true);
      try {
        const date = active.date;
        // Heal logged-but-loadless sets from their siblings before pruning, so
        // a blank-weight cluster/activation row can't persist (see core).
        const exercises = dropEmptySets(fillMissingClusterLoads(active.exercises));
        // A prescribed block the user never performed must not enter history —
        // the cardio twin of dropEmptySets.
        const cardio = dropEmptyCardio(active.cardio);
        await updateSession(uid, active.id, {
          status: 'completed',
          exercises,
          ...(cardio !== undefined ? { cardio } : {}),
          bodyweight: extras.bodyweight,
          sleepHours: extras.sleepHours,
        });
        const dateKey = dayKeyAt(date, dayBoundaryOf(profile));
        // `> 0` let an 11 lb session bodyweight reach `dailyWeights`; the
        // store backstop applies here like on every other weight write.
        if (extras.bodyweight != null && isStorableWeight(extras.bodyweight)) {
          await setDailyWeight(uid, dateKey, extras.bodyweight);
          void exportDaily('weight', dateKey, extras.bodyweight);
        }
        if (extras.sleepHours != null && extras.sleepHours > 0) {
          await setDailySleep(uid, dateKey, extras.sleepHours);
          void exportDaily('sleep', dateKey, extras.sleepHours);
        }
        await markExercised(uid, date, dayBoundaryOf(profile));
        // Mirror the finished session to Health (ends now; strength training).
        track('workout_finished');
        void exportWorkout({ start: date, end: new Date() });
        setActive(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Finish failed'));
      } finally {
        setSaving(false);
      }
    },
    [uid, setActive],
  );

  const discardWorkout = useCallback(async () => {
    const active = activeRef.current;
    if (!uid || !active?.id) return;
    await deleteSessionDoc(uid, active.id);
    setActive(null);
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
        setError(e instanceof Error ? e : new Error('Save failed'));
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
        setError(e instanceof Error ? e : new Error('Restore failed'));
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
