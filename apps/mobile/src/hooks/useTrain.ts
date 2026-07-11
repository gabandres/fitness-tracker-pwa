import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { trackSubs } from '@/lib/sub-debug';
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
import { localDateKey, normalizeClusterGroups } from '@macrolog/core';
import {
  type Exercise,
  type ExerciseDraft,
  type LogStyle,
  type SessionExercise,
  type SetKind,
  type TemplateDraft,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutTemplate,
  dropEmptySets,
  templateToSessionExercises,
} from '@/lib/workout';
import {
  type SeedTemplate,
  fillMissingClusterLoads,
  findSeedExercise,
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
   *  planned sets, stamps templateId/templateName). No-op if one is active. */
  startFromTemplate: (template: WorkoutTemplate) => Promise<void>;
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
   *  if `exerciseId` is null (free-typed name). */
  addExerciseToActive: (name: string, logStyle: LogStyle, exerciseId?: string) => Promise<void>;
  removeExercise: (index: number) => Promise<void>;
  addSet: (exerciseIndex: number) => Promise<void>;
  /** Append a cluster (one activation + two mini sets) and renumber groups. */
  addCluster: (exerciseIndex: number) => Promise<void>;
  /** Edit a set field locally (no write); call commitActive to persist. */
  editSet: (exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSet>) => void;
  /** Patch a set AND persist atomically (no stale close-over). Use for
   *  one-shot taps like the +load bump chip or the set-done toggle. */
  applySetPatch: (exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSet>) => Promise<void>;
  /** Change a set's `kind`, re-derive cluster groups for the exercise, and
   *  persist (kind changes can form/dissolve a cluster). */
  setSetKind: (exerciseIndex: number, setIndex: number, kind: SetKind) => Promise<void>;
  removeSet: (exerciseIndex: number, setIndex: number) => Promise<void>;
  /** Flush the local active session to Firestore (call on input blur). */
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

function newSet(): WorkoutSet {
  return { kind: 'working', done: false };
}

export function useTrain(): TrainState {
  const { user } = useAuth();
  const uid = user?.uid;
  const es = useLocale() === 'es-PR';
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [active, setActive] = useState<WorkoutSession | null>(null);
  const [editingExisting, setEditingExisting] = useState(false);
  // Pristine snapshot of a reopened completed session, captured before any
  // edit, so Cancel can restore it (set edits live-write, so they're already
  // in Firestore by the time the user changes their mind).
  const editOriginal = useRef<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // Focus-gated so the Train tab drops its live listeners when it blurs
  // (battery/network). Re-subscribes + reloads the active session on refocus.
  // See useToday.
  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      let alive = true;
      const unsubs = [
        subscribeExercises(uid, setCatalog, setError),
        subscribeTemplates(uid, setTemplates, setError),
        subscribeRecentSessions(
          uid,
          50,
          (s) => {
            // Recent list shows completed sessions; the active one (if any) is
            // surfaced separately via getActiveSession below.
            setRecentSessions(s.filter((x) => x.status === 'completed'));
            setLoading(false);
          },
          setError,
        ),
      ];
      // One-shot load of any in-progress session so set edits aren't clobbered
      // by a live subscription mid-typing.
      getActiveSession(uid)
        .then((s) => {
          if (alive) setActive(s);
        })
        .catch(setError);
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
        await updateSession(uid, session.id, { exercises: session.exercises });
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Save failed'));
      } finally {
        setSaving(false);
      }
    },
    [uid],
  );

  const startWorkout = useCallback(async () => {
    if (!uid || active) return;
    const draft = { status: 'active' as const, date: new Date(), exercises: [] };
    const id = await startSession(uid, draft);
    setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
  }, [uid, active]);

  const startFromTemplate = useCallback(
    async (template: WorkoutTemplate) => {
      if (!uid || active) return;
      const draft = {
        status: 'active' as const,
        date: new Date(),
        templateId: template.id,
        templateName: template.name,
        exercises: templateToSessionExercises(template),
      };
      const id = await startSession(uid, draft);
      setActive({ ...draft, id, createdAt: new Date(), updatedAt: new Date() });
    },
    [uid, active],
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
        const name = lib ? seedExerciseName(lib, es) : se.key;
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
            defaultCues: lib ? seedExerciseCues(lib, es) : [],
            logStyle: 'weight-reps',
            seedKey: se.key,
          }));
        exercises.push({
          exerciseId: id,
          name,
          targetLoad: se.targetLoad,
          cues: seedTemplateExerciseCues(seed.key, se, lib, es),
          logStyle: 'weight-reps',
          progression: se.progression,
          plannedSets: se.plannedSets,
        });
      }
      await addTemplateDoc(uid, {
        name: seedTemplateName(seed, es),
        notes: seedTemplateNotes(seed, es),
        restMiniSec: seed.restMiniSec,
        restClusterSec: seed.restClusterSec,
        exercises,
        seedKey: seed.key,
      });
    },
    [uid, catalog, es],
  );

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
    async (name: string, logStyle: LogStyle, exerciseId?: string) => {
      if (!uid || !active) return;
      let id = exerciseId;
      if (!id) {
        id = await addExerciseDoc(uid, { name, muscles: [], defaultCues: [], logStyle });
      }
      const ex: SessionExercise = { exerciseId: id, name, cues: [], logStyle, sets: [newSet()] };
      const next = { ...active, exercises: [...active.exercises, ex] };
      setActive(next);
      await persist(next);
    },
    [uid, active, persist],
  );

  const removeExercise = useCallback(
    async (index: number) => {
      if (!active) return;
      const next = { ...active, exercises: active.exercises.filter((_, i) => i !== index) };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const addSet = useCallback(
    async (exerciseIndex: number) => {
      if (!active) return;
      const exercises = active.exercises.map((ex, i) =>
        i === exerciseIndex ? { ...ex, sets: [...ex.sets, newSet()] } : ex,
      );
      const next = { ...active, exercises };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const addCluster = useCallback(
    async (exerciseIndex: number) => {
      if (!active) return;
      const cluster: WorkoutSet[] = [
        { kind: 'activation', done: false },
        { kind: 'mini', done: false },
        { kind: 'mini', done: false },
      ];
      const exercises = active.exercises.map((ex, i) =>
        i === exerciseIndex ? { ...ex, sets: normalizeClusterGroups([...ex.sets, ...cluster]) } : ex,
      );
      const next = { ...active, exercises };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const editSet = useCallback((exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSet>) => {
    setActive((prev) => {
      if (!prev) return prev;
      const exercises = prev.exercises.map((ex, i) =>
        i === exerciseIndex
          ? { ...ex, sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
          : ex,
      );
      return { ...prev, exercises };
    });
  }, []);

  const applySetPatch = useCallback(
    async (exerciseIndex: number, setIndex: number, patch: Partial<WorkoutSet>) => {
      if (!active) return;
      const exercises = active.exercises.map((ex, i) =>
        i === exerciseIndex
          ? { ...ex, sets: ex.sets.map((s, j) => (j === setIndex ? { ...s, ...patch } : s)) }
          : ex,
      );
      const next = { ...active, exercises };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const setSetKind = useCallback(
    async (exerciseIndex: number, setIndex: number, kind: SetKind) => {
      if (!active) return;
      const exercises = active.exercises.map((ex, i) =>
        i === exerciseIndex
          ? {
              ...ex,
              sets: normalizeClusterGroups(
                ex.sets.map((s, j) => (j === setIndex ? { ...s, kind } : s)),
              ),
            }
          : ex,
      );
      const next = { ...active, exercises };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const removeSet = useCallback(
    async (exerciseIndex: number, setIndex: number) => {
      if (!active) return;
      const exercises = active.exercises.map((ex, i) =>
        i === exerciseIndex
          ? { ...ex, sets: normalizeClusterGroups(ex.sets.filter((_, j) => j !== setIndex)) }
          : ex,
      );
      const next = { ...active, exercises };
      setActive(next);
      await persist(next);
    },
    [active, persist],
  );

  const commitActive = useCallback(async () => {
    if (active) await persist(active);
  }, [active, persist]);

  const finishWorkout = useCallback(
    async (extras: { bodyweight?: number; sleepHours?: number }) => {
      if (!uid || !active?.id) return;
      setSaving(true);
      try {
        const date = active.date;
        // Heal logged-but-loadless sets from their siblings before pruning, so
        // a blank-weight cluster/activation row can't persist (see core).
        const exercises = dropEmptySets(fillMissingClusterLoads(active.exercises));
        await updateSession(uid, active.id, {
          status: 'completed',
          exercises,
          bodyweight: extras.bodyweight,
          sleepHours: extras.sleepHours,
        });
        const dateKey = localDateKey(date);
        if (extras.bodyweight != null && extras.bodyweight > 0) {
          await setDailyWeight(uid, dateKey, extras.bodyweight);
          void exportDaily('weight', dateKey, extras.bodyweight);
        }
        if (extras.sleepHours != null && extras.sleepHours > 0) {
          await setDailySleep(uid, dateKey, extras.sleepHours);
          void exportDaily('sleep', dateKey, extras.sleepHours);
        }
        await markExercised(uid, date);
        // Mirror the finished session to Health (ends now; strength training).
        void exportWorkout({ start: date, end: new Date() });
        setActive(null);
      } catch (e) {
        setError(e instanceof Error ? e : new Error('Finish failed'));
      } finally {
        setSaving(false);
      }
    },
    [uid, active],
  );

  const discardWorkout = useCallback(async () => {
    if (!uid || !active?.id) return;
    await deleteSessionDoc(uid, active.id);
    setActive(null);
  }, [uid, active]);

  const deleteSession = useCallback(
    async (id: string) => {
      if (uid) await deleteSessionDoc(uid, id);
    },
    [uid],
  );

  const reopenSession = useCallback(
    (session: WorkoutSession) => {
      // Single-active invariant: don't clobber a live in-progress workout.
      if (active || !session.id) return;
      // Snapshot the pristine session for Cancel. The edit callbacks replace
      // (map/spread) rather than mutate, so this reference stays untouched.
      editOriginal.current = session;
      setEditingExisting(true);
      setActive(session);
    },
    [active],
  );

  const finishEdit = useCallback(async () => {
    // Edits already live-write through the set callbacks; flush the final state
    // (an input may still hold focus) and drop any empty sets, exactly like
    // finishWorkout — but leave status/date/bodyweight/sleep untouched.
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
  }, [uid, active]);

  const cancelEdit = useCallback(async () => {
    // Set edits live-write, so cancelling means restoring the pre-edit
    // exercises we snapshotted at reopen — otherwise partial edits would stick.
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
  }, [uid]);

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
    saveTemplate,
    deleteTemplate,
    cloneStarterTemplate,
    addCatalogExercise,
    editCatalogExercise,
    deleteCatalogExercise,
    mergeCatalogExercises,
    addExerciseToActive,
    removeExercise,
    addSet,
    addCluster,
    editSet,
    applySetPatch,
    setSetKind,
    removeSet,
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
