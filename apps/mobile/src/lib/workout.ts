// Workout domain types for the Train tab. Mirrors src/app/models/workout.ts
// in the PWA — both apps write the same users/{uid}/{exercises,
// workoutSessions} docs, so these shapes MUST match (see firestore.rules
// isValidExercise / isValidWorkoutSession). Mobile-local copy (same
// documented dup pattern as body-fat / weight-projection); cluster-set and
// template/progression machinery is intentionally omitted from v1.

export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads'
  | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'forearms';

/** How a set counts. v1 only creates `working`; the others exist so docs
 *  written by the PWA round-trip cleanly. */
export type SetKind = 'warmup' | 'activation' | 'working' | 'mini' | 'drop';

export type SessionStatus = 'active' | 'completed';

/** How an exercise is logged. `weight-reps` (default) is load×reps;
 *  `bodyweight` logs reps only; `time` logs a hold duration in seconds. */
export type LogStyle = 'weight-reps' | 'bodyweight' | 'time';

/** A missing logStyle is the classic load×reps set. */
export const DEFAULT_LOG_STYLE: LogStyle = 'weight-reps';

export interface Exercise {
  id?: string;
  name: string;
  muscles: MuscleGroup[];
  defaultCues: string[];
  logStyle?: LogStyle;
  createdAt: Date;
}

export interface WorkoutSet {
  kind: SetKind;
  group?: number;
  weight?: number;
  reps?: number;
  /** Hold duration in seconds — for `time` logStyle exercises. */
  durationSec?: number;
  /** Reps in reserve (0 = to failure). */
  rir?: number;
  done?: boolean;
}

export interface SessionExercise {
  exerciseId: string;
  name: string; // snapshot
  targetLoad?: number;
  cues: string[]; // snapshot
  logStyle?: LogStyle;
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id?: string;
  status: SessionStatus;
  templateId?: string;
  templateName?: string;
  date: Date;
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  exercises: SessionExercise[];
  nextNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ExerciseDraft = Omit<Exercise, 'id' | 'createdAt'>;
export type SessionDraft = Omit<WorkoutSession, 'id' | 'createdAt' | 'updatedAt'>;

/** A set counts as logged only if it carries the count its log style needs:
 *  a duration for `time`, otherwise reps. Weight alone is scaffold. */
export function isLoggedSet(s: WorkoutSet, logStyle: LogStyle = DEFAULT_LOG_STYLE): boolean {
  return logStyle === 'time' ? s.durationSec != null : s.reps != null;
}

/** Drop unfilled scaffold sets from every exercise before a session is
 *  frozen as `completed`. v1 has no cluster groups, so this is a plain
 *  filter (the PWA additionally re-derives cluster `group` numbers). */
export function dropEmptySets(exercises: SessionExercise[]): SessionExercise[] {
  return exercises.map((ex) => ({
    ...ex,
    sets: ex.sets.filter((s) => isLoggedSet(s, ex.logStyle ?? DEFAULT_LOG_STYLE)),
  }));
}

/** Total working volume (Σ weight×reps) of a session — for history rows. */
export function sessionVolume(session: WorkoutSession): number {
  let vol = 0;
  for (const ex of session.exercises) {
    for (const s of ex.sets) {
      if (s.weight != null && s.reps != null) vol += s.weight * s.reps;
    }
  }
  return Math.round(vol);
}
