/**
 * Workout domain types shared by the Train tab in both apps (ADR-0007,
 * ADR-0012). Framework-free; the canonical home for the structural shapes
 * the pure progression/PR math operates on. The Angular PWA
 * (src/app/models/workout.ts) and the Expo app (apps/mobile/src/lib/workout.ts)
 * keep their own richer copies (drafts, Firestore-facing helpers); these are
 * the minimal shapes @macrolog/core needs and is the dedup target.
 */

/** How a set counts. `working` is the default straight set; `activation`
 *  + `mini` model cluster training; `warmup` is excluded from PR/progression
 *  math; `drop` is a back-off set. */
export type SetKind = 'warmup' | 'activation' | 'working' | 'mini' | 'drop';

/** Muscle groups a catalog exercise can target. */
export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads'
  | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'forearms';

/** Planned scaffold for one set the session pre-fills. `group` clusters sets
 *  (C1/C2); omit it for plain straight sets. */
export interface PlannedSet {
  kind: SetKind;
  group?: number;
}

/** How an exercise is logged. `weight-reps` (default) is load×reps;
 *  `bodyweight` logs reps only; `time` logs a hold duration in seconds. */
export type LogStyle = 'weight-reps' | 'bodyweight' | 'time';

/** Treat a missing logStyle as the classic load×reps set. */
export const DEFAULT_LOG_STYLE: LogStyle = 'weight-reps';

/** Deterministic double-progression rule. When the key set hits `targetReps`
 *  for `holdSessions` consecutive sessions, suggest bumping by `incrementLb`. */
export interface ProgressionRule {
  targetReps: number;
  holdSessions: number;
  incrementLb: number;
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
  name: string;
  targetLoad?: number;
  cues: string[];
  logStyle?: LogStyle;
  sets: WorkoutSet[];
}
