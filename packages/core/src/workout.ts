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

/** Minimal completed-session shape the shared CSV export reads. Both apps'
 *  richer WorkoutSession (with ids/status/timestamps) satisfy it structurally. */
export interface WorkoutSession {
  date: Date;
  templateName?: string;
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  exercises: SessionExercise[];
}

/** True when a set carries a logged value for its style: a duration for
 *  `time` exercises, otherwise a rep count. Filters unfilled scaffold sets. */
export function isLoggedSet(s: WorkoutSet, logStyle: LogStyle = DEFAULT_LOG_STYLE): boolean {
  return logStyle === 'time' ? s.durationSec != null : s.reps != null;
}

/**
 * Auto-default missing loads at the finish boundary. For each `weight-reps`
 * exercise, any LOGGED set (reps entered) with no positive weight inherits the
 * heaviest weight among its sibling sets — the correct load for cluster
 * training, where the activation + mini rows share one weight, and the common
 * data-entry gap where a row gets reps + RIR but the weight is left blank.
 *
 * Exercises with no loaded set are left untouched, so a genuine bodyweight /
 * isometric move (pull-up, plank — often mis-catalogued as `weight-reps`) keeps
 * its legitimate 0, and `time`/`bodyweight` styles are skipped entirely. Pure;
 * apply alongside {@link isLoggedSet}-based pruning so a reps-but-no-weight row
 * can't persist into a completed session (ADR-0012: both apps call this).
 */
export function fillMissingClusterLoads<
  S extends WorkoutSet,
  E extends { logStyle?: LogStyle; sets: S[] },
>(exercises: E[]): E[] {
  return exercises.map((ex) => {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    if (style !== 'weight-reps') return ex;
    const maxWeight = ex.sets.reduce((m, s) => Math.max(m, s.weight ?? 0), 0);
    if (maxWeight <= 0) return ex; // no loaded sibling → bodyweight/isometric; 0 is correct
    let changed = false;
    const sets = ex.sets.map((s): S => {
      if (isLoggedSet(s, style) && (s.weight == null || s.weight <= 0)) {
        changed = true;
        return { ...s, weight: maxWeight };
      }
      return s;
    });
    return changed ? { ...ex, sets } : ex;
  });
}
