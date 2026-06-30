// Workout domain types for the Train tab. Mirrors src/app/models/workout.ts
// in the PWA — both apps write the same users/{uid}/{exercises,
// workoutSessions} docs, so these shapes MUST match (see firestore.rules
// isValidExercise / isValidWorkoutSession). Mobile-local copy (same
// documented dup pattern as body-fat / weight-projection); cluster-set and
// template/progression machinery is intentionally omitted from v1.

import { normalizeClusterGroups } from '@macrolog/core';

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
  /** Double-progression rule snapshotted from the source template, so the
   *  logger can surface a deterministic +load bump (not just the ghost). */
  progression?: ProgressionRule;
  sets: WorkoutSet[];
}

// ─── Templates ──────────────────────────────────────────────────
// An editable blueprint (ADR-0007). Starting a session SNAPSHOTS the
// template's exercises into the session doc, so later template edits never
// rewrite history. Shapes mirror src/app/models/workout.ts +
// firestore.rules isValidWorkoutTemplate. Mobile v1 builds plain straight
// `working` plannedSets (no cluster groups); `progression`/cluster machinery
// is carried in the type for PWA round-trip but not yet authored here.

/** Deterministic double-progression rule (surfaced in a later slice). */
export interface ProgressionRule {
  targetReps: number;
  holdSessions: number;
  incrementLb: number;
}

/** Planned scaffold for one set the session pre-fills. `group` clusters sets
 *  (C1/C2); omit it for plain straight sets. */
export interface PlannedSet {
  kind: SetKind;
  group?: number;
}

export interface TemplateExercise {
  exerciseId: string;
  name: string; // snapshot of the catalog name
  targetLoad?: number;
  cues?: string[];
  logStyle?: LogStyle;
  progression?: ProgressionRule;
  plannedSets: PlannedSet[];
}

export interface WorkoutTemplate {
  id?: string;
  name: string;
  notes?: string;
  restMiniSec?: number;
  restClusterSec?: number;
  exercises: TemplateExercise[];
  createdAt: Date;
  updatedAt: Date;
}

export type TemplateDraft = Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>;

/** Snapshot a template's exercises into fresh session exercises: each
 *  planned set becomes a scaffold {@link WorkoutSet} (weight pre-filled from
 *  `targetLoad` for load×reps styles; counts left blank). Unfilled scaffold
 *  rows are dropped by {@link dropEmptySets} on finish. An exercise with no
 *  planned sets gets one empty working set so it's loggable. */
export function templateToSessionExercises(template: WorkoutTemplate): SessionExercise[] {
  return template.exercises.map((ex) => {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    const planned = ex.plannedSets.length ? ex.plannedSets : [{ kind: 'working' as SetKind }];
    return {
      exerciseId: ex.exerciseId,
      name: ex.name,
      targetLoad: ex.targetLoad,
      cues: ex.cues ?? [],
      logStyle: ex.logStyle,
      progression: ex.progression,
      sets: planned.map((ps) => ({
        kind: ps.kind,
        group: ps.group,
        weight: style === 'time' ? undefined : ex.targetLoad,
        done: false,
      })),
    };
  });
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
 *  frozen as `completed`, then re-derive cluster `group` numbers on what
 *  remains (so no phantom-cluster gaps survive). */
export function dropEmptySets(exercises: SessionExercise[]): SessionExercise[] {
  return exercises.map((ex) => ({
    ...ex,
    sets: normalizeClusterGroups(ex.sets.filter((s) => isLoggedSet(s, ex.logStyle ?? DEFAULT_LOG_STYLE))),
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
