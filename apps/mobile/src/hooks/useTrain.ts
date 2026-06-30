import { useCallback, useEffect, useState } from 'react';
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
  type TemplateDraft,
  type TemplateExercise,
  type WorkoutSession,
  type WorkoutSet,
  type WorkoutTemplate,
  dropEmptySets,
  templateToSessionExercises,
} from '@/lib/workout';
import { type SeedTemplate, findSeedExercise } from '@/lib/workout-seed';

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
  removeSet: (exerciseIndex: number, setIndex: number) => Promise<void>;
  /** Flush the local active session to Firestore (call on input blur). */
  commitActive: () => Promise<void>;
  /** Complete the workout: drop empty sets, flip to completed, mirror
   *  bodyweight → dailyWeights + sleep → dailySleep, mark the day exercised. */
  finishWorkout: (extras: { bodyweight?: number; sleepHours?: number }) => Promise<void>;
  /** Abandon the active session (delete the doc). */
  discardWorkout: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
}

function newSet(): WorkoutSet {
  return { kind: 'working', done: false };
}

export function useTrain(): TrainState {
  const { user } = useAuth();
  const uid = user?.uid;
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [recentSessions, setRecentSessions] = useState<WorkoutSession[]>([]);
  const [active, setActive] = useState<WorkoutSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
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
    return () => {
      alive = false;
      unsubs.forEach((u) => u());
    };
  }, [uid]);

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
        const name = lib?.name ?? se.key;
        const existing = catalog.find((c) => c.name.toLowerCase() === name.toLowerCase());
        const id =
          existing?.id ??
          (await addExerciseDoc(uid, {
            name,
            muscles: lib?.muscles ?? [],
            defaultCues: lib?.defaultCues ?? [],
            logStyle: 'weight-reps',
          }));
        exercises.push({
          exerciseId: id,
          name,
          targetLoad: se.targetLoad,
          cues: se.cues ?? lib?.defaultCues,
          logStyle: 'weight-reps',
          progression: se.progression,
          plannedSets: se.plannedSets,
        });
      }
      await addTemplateDoc(uid, {
        name: seed.name,
        notes: seed.notes,
        restMiniSec: seed.restMiniSec,
        restClusterSec: seed.restClusterSec,
        exercises,
      });
    },
    [uid, catalog],
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
        const exercises = dropEmptySets(active.exercises);
        await updateSession(uid, active.id, {
          status: 'completed',
          exercises,
          bodyweight: extras.bodyweight,
          sleepHours: extras.sleepHours,
        });
        if (extras.bodyweight != null && extras.bodyweight > 0) {
          await setDailyWeight(uid, localDateKey(date), extras.bodyweight);
        }
        if (extras.sleepHours != null && extras.sleepHours > 0) {
          await setDailySleep(uid, localDateKey(date), extras.sleepHours);
        }
        await markExercised(uid, date);
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
    removeSet,
    commitActive,
    finishWorkout,
    discardWorkout,
    deleteSession,
  };
}
