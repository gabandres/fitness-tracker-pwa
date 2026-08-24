// Workout domain types for the Train tab. Mirrors src/app/models/workout.ts
// in the PWA — both apps write the same users/{uid}/{exercises,
// workoutSessions} docs, so these shapes MUST match (see firestore.rules
// isValidExercise / isValidWorkoutSession). Mobile-local copy (same
// documented dup pattern as body-fat / weight-projection).

import { normalizeClusterGroups } from '@macrolog/core';
import { isLoggedSet as isLoggedSetCore } from '@macrolog/core/workout';
import { isLoggedCardioBlock } from '@macrolog/core/cardio';

/**
 * Cardio types are RE-EXPORTED from core rather than re-declared here, unlike
 * every strength type below.
 *
 * The duplication above is historical: those shapes existed in this file and
 * in the PWA's `models/workout.ts` before `packages/core` did, and core
 * deliberately does not barrel them because the PWA's `export *` shims would
 * clash. None of that applies to a type introduced after core existed — there
 * is no second copy to be compatible with, and the web app is frozen
 * (ADR-0022) so one will never appear. One definition is strictly better than
 * two kept in step by comment.
 */
export type {
  CardioBlock,
  CardioModality,
  CardioProvider,
  CardioSource,
  PlannedCardioBlock,
} from '@macrolog/core/cardio';
import type { CardioBlock, PlannedCardioBlock } from '@macrolog/core/cardio';

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
  /** Stable slug of the shipped library entry this was cloned from, if any.
   *  Lets re-cloning (even in another locale) reuse this doc instead of
   *  creating a locale-named duplicate that would split history/e1RM. */
  seedKey?: string;
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
  /** The template's PRESCRIPTION for this set, snapshotted at start.
   *  NOT written into `reps`/`durationSec`, because `isLoggedSet` reads those
   *  as proof the set was performed — pre-filling them would record every
   *  prescribed set as done. Rendered as the input placeholder, and committed
   *  to the real fields only when the set is ticked `done`. */
  targetReps?: number;
  targetDurationSec?: number;
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
// firestore.rules isValidWorkoutTemplate. The mobile template editor authors
// every field below — clusters, cues and progression included. It writes
// `exercises` as a full overwrite, so a field the editor cannot see is a
// field the next mobile save deletes; keep the editor and this type in step.

/** Deterministic double-progression rule. */
export interface ProgressionRule {
  targetReps: number;
  holdSessions: number;
  incrementLb: number;
}

/** Planned scaffold for one set the session pre-fills. `group` clusters sets
 *  (C1/C2); omit it for plain straight sets.
 *
 *  The four target fields are the PRESCRIPTION — what makes a template say
 *  "3 × 8 @ 135" rather than just "three sets" — and are what
 *  {@link templateToSessionExercises} pre-fills the logger with. All optional,
 *  so templates written before they existed stay valid. Mirrors
 *  `PlannedSet` in `packages/core` and `src/app/models/workout.ts`. */
export interface PlannedSet {
  kind: SetKind;
  group?: number;
  /** Prescribed reps. With `repsMax`, the lower bound of a range. */
  reps?: number;
  /** Upper bound of a rep RANGE, e.g. `reps: 8, repsMax: 10` → "8-10". */
  repsMax?: number;
  /** Prescribed load; overrides the exercise-level `targetLoad`. */
  weight?: number;
  /** Prescribed hold in seconds — `time` logStyle only. */
  durationSec?: number;
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
  /** Prescribed cardio (ADR-0025) — the analogue of `plannedSets`. Like
   *  `exercises`, the editor writes this as a full overwrite, so a field the
   *  editor cannot see is a field the next save deletes. */
  cardioBlocks?: PlannedCardioBlock[];
  /** Stable slug of the shipped starter this was cloned from, if any. Lets
   *  the chooser hide an already-cloned starter across locales. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type TemplateDraft = Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>;

/** Snapshot a template's exercises into fresh session exercises: each planned
 *  set becomes a scaffold {@link WorkoutSet} pre-filled with whatever the
 *  template prescribes, so the lifter confirms numbers instead of typing them.
 *
 *  Precedence for load is per-set `weight` → exercise `targetLoad`, because
 *  `targetLoad` is the one-number fallback that predates per-set targets and
 *  must keep working for every template written before them. Reps come only
 *  from the set: there has never been an exercise-level rep target, and
 *  `progression.targetReps` is a bump *trigger*, not a prescription — reading
 *  it here would silently pre-fill every set with a number the user never
 *  wrote as a target.
 *
 *  A rep RANGE prescribes its lower bound, which is the number you must beat;
 *  `repsMax` stays on the template as the goal to reach.
 *
 *  Reps/duration land in `targetReps`/`targetDurationSec`, NOT in
 *  `reps`/`durationSec` — {@link isLoggedSet} reads the latter as proof the
 *  set was performed, so writing them here would make finishing a session
 *  record every prescribed set as done. Weight is different and IS pre-filled
 *  outright: a load with no reps has never counted as a logged set, which is
 *  why `targetLoad` could always be seeded this way.
 *
 *  Unfilled scaffold rows are dropped by {@link dropEmptySets} on finish. An
 *  exercise with no planned sets gets one empty working set so it's loggable. */
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
        weight: style === 'time' ? undefined : (ps.weight ?? ex.targetLoad),
        targetReps: style === 'time' ? undefined : ps.reps,
        targetDurationSec: style === 'time' ? ps.durationSec : undefined,
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
  /** How long the whole SESSION took, in minutes. Not `CardioBlock.durationSec`,
   *  which is how long one run was — different unit, different question. */
  durationMin?: number;
  exercises: SessionExercise[];
  /** Logged cardio (ADR-0025). A run on its own is a session with
   *  `exercises: []` and one block here. No strength derivation reads it. */
  cardio?: CardioBlock[];
  nextNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type ExerciseDraft = Omit<Exercise, 'id' | 'createdAt'>;
export type SessionDraft = Omit<WorkoutSession, 'id' | 'createdAt' | 'updatedAt'>;

// The types above stay local (the PWA's `models/workout.ts` holds a
// structurally identical copy — `@macrolog/core/workout` deliberately does not
// barrel its types, or the PWA's `export *` shims would clash). The FUNCTIONS
// are shared: they were duplicated here, in the PWA model, and in core, which
// is three places for one rule.

/** A set counts as logged only if it carries the count its log style needs:
 *  a duration for `time`, otherwise reps. Weight alone is scaffold. */
export { isLoggedSet } from '@macrolog/core/workout';

/** Total working volume (Σ weight×reps) of a session — for history rows. */
export { sessionVolume } from '@macrolog/core';

/** Drop unfilled scaffold sets from every exercise before a session is
 *  frozen as `completed`, then re-derive cluster `group` numbers on what
 *  remains (so no phantom-cluster gaps survive). */
export function dropEmptySets(exercises: SessionExercise[]): SessionExercise[] {
  return exercises.map((ex) => ({
    ...ex,
    sets: normalizeClusterGroups(ex.sets.filter((s) => isLoggedSetCore(s, ex.logStyle ?? DEFAULT_LOG_STYLE))),
  }));
}

// ─── Cardio (ADR-0025) ──────────────────────────────────────────

/**
 * Snapshot a template's prescribed cardio into scaffold blocks, the way
 * {@link templateToSessionExercises} does for sets.
 *
 * The prescription lands in `targetDurationSec` / `targetDistanceM` and
 * **never** in `durationSec` / `distanceM`: `isLoggedCardioBlock` reads the
 * latter as proof the work happened, so pre-filling them would record every
 * prescribed block as performed. `durationSec` starts at 0, which is exactly
 * what makes the block invisible to every roll-up until the user fills it in.
 *
 * This is the same footgun ADR-0007 already paid for once with `targetReps`.
 */
export function templateToSessionCardio(template: WorkoutTemplate): CardioBlock[] {
  return (template.cardioBlocks ?? []).map((pb) => ({
    modality: pb.modality,
    ...(pb.label !== undefined ? { label: pb.label } : {}),
    durationSec: 0,
    ...(pb.notes !== undefined ? { notes: pb.notes } : {}),
    ...(pb.targetDurationSec !== undefined ? { targetDurationSec: pb.targetDurationSec } : {}),
    ...(pb.targetDistanceM !== undefined ? { targetDistanceM: pb.targetDistanceM } : {}),
    source: 'manual' as const,
  }));
}

/** Drop unperformed scaffold blocks before a session is frozen as `completed`
 *  — the cardio twin of {@link dropEmptySets}. A prescription the user never
 *  did must not enter their training history. */
export function dropEmptyCardio(cardio: CardioBlock[] | undefined): CardioBlock[] | undefined {
  if (cardio === undefined) return undefined;
  return cardio.filter(isLoggedCardioBlock);
}

/** The zero-calorie marker a finished session writes, however much energy an
 *  imported block reported (ADR-0026 decision 5 / ADR-0024 decision 4). */
export { workoutMarkerEntry } from '@macrolog/core';
