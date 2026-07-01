// ─── Workout domain types ───────────────────────────────────────
//
// Three entities back the Train tab (see ADR-0007):
//   - Exercise         — per-user catalog; the stable identity a
//                        progression chart aggregates over.
//   - WorkoutTemplate  — an editable blueprint (exercise list + cues +
//                        target loads + progression rules).
//   - WorkoutSession   — one logged instance. Starting a session
//                        SNAPSHOTS the template's exercises into the
//                        session doc, so later template edits never
//                        rewrite history.
//
// Date-at-the-seam convention: every `Date` here is a JS `Date` on the
// domain side. The Firestore adapter converts to/from `Timestamp` at the
// `*Doc` boundary (see firebase.service.ts) — app code never sees a
// `Timestamp`. The `*Doc` shapes live in firebase.service.ts alongside
// the other stored shapes.

import { normalizeClusterGroups } from '../utils/cluster-groups';

export type MuscleGroup =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'quads'
  | 'hamstrings'
  | 'glutes'
  | 'calves'
  | 'core'
  | 'forearms';

/** How a set counts. `working` is the default straight set; `activation`
 *  + `mini` model cluster training (activation set then short-rest mini
 *  sets); `warmup` is excluded from PR/progression math; `drop` is a
 *  back-off set appended to another. */
export type SetKind = 'warmup' | 'activation' | 'working' | 'mini' | 'drop';

export type SessionStatus = 'active' | 'completed';

/** How an exercise is logged. `weight-reps` (default) is the classic
 *  load×reps set. `bodyweight` logs reps only (with an optional added
 *  load). `time` logs a duration in seconds (with an optional added
 *  load) — for planks, hangs, carries. An exercise's logStyle is an
 *  intrinsic property of the movement: set once on the catalog Exercise
 *  and snapshotted into templates/sessions like `name`/`cues`. */
export type LogStyle = 'weight-reps' | 'bodyweight' | 'time';

/** Treat a missing logStyle as the classic load×reps set, so every
 *  pre-existing exercise/template/session stays valid without migration. */
export const DEFAULT_LOG_STYLE: LogStyle = 'weight-reps';

// ─── Exercise catalog ───────────────────────────────────────────
export interface Exercise {
  id?: string;
  name: string;
  muscles: MuscleGroup[];
  /** Form cues shown by default when this exercise is added to a
   *  template (a template may override them per-exercise). */
  defaultCues: string[];
  /** Logging style; omitted means {@link DEFAULT_LOG_STYLE}. */
  logStyle?: LogStyle;
  /** Stable slug of the shipped library entry this was cloned from, if any.
   *  Lets re-cloning (even in another locale) reuse this doc instead of
   *  creating a locale-named duplicate that would split history/e1RM. */
  seedKey?: string;
  createdAt: Date;
}

// ─── Progression ────────────────────────────────────────────────
/** Deterministic double-progression rule. When the first working/
 *  activation set hits `targetReps` for `holdSessions` consecutive
 *  sessions, the engine suggests bumping the load by `incrementLb`. */
export interface ProgressionRule {
  targetReps: number;
  holdSessions: number;
  incrementLb: number;
}

// ─── Template ───────────────────────────────────────────────────
/** Planned scaffold for one set the session pre-fills (the empty
 *  `__ / __ / __` slots on the paper sheet). `group` clusters sets
 *  (C1/C2); omit it for plain straight sets. */
export interface PlannedSet {
  kind: SetKind;
  group?: number;
}

export interface TemplateExercise {
  exerciseId: string;
  /** Snapshot of the catalog name so the template renders without a
   *  catalog join; refreshed when the template is edited. */
  name: string;
  targetLoad?: number;
  /** Per-template cue override; falls back to the exercise's
   *  `defaultCues` when omitted. */
  cues?: string[];
  /** Snapshot of the catalog exercise's {@link LogStyle}; omitted means
   *  {@link DEFAULT_LOG_STYLE}. */
  logStyle?: LogStyle;
  progression?: ProgressionRule;
  plannedSets: PlannedSet[];
}

export interface WorkoutTemplate {
  id?: string;
  name: string;
  /** Protocol notes (e.g. "60-min cap. Cluster format…"). */
  notes?: string;
  /** Rest between mini-sets / straight sets, seconds. */
  restMiniSec?: number;
  /** Rest between clusters / exercises, seconds. */
  restClusterSec?: number;
  exercises: TemplateExercise[];
  /** Stable slug of the shipped starter this was cloned from, if any. Lets
   *  the chooser hide an already-cloned starter across locales. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Session ────────────────────────────────────────────────────
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

/** A set counts as logged only if it carries the rep/duration count its
 *  log style requires: a duration for `time` exercises, otherwise reps.
 *  Weight alone is NOT enough — a half-filled row with a (often seeded)
 *  load but no reps is exactly the blank-reps / phantom-cluster artifact
 *  the exports surfaced, so it's treated as unlogged scaffold and dropped.
 *  Cluster scaffolding (activation + mini rows pre-created from the
 *  template's `plannedSets`) likewise has no count. `rir`/`done`/`weight`
 *  alone don't count as data. */
export function isLoggedSet(s: WorkoutSet, logStyle: LogStyle = DEFAULT_LOG_STYLE): boolean {
  return logStyle === 'time' ? s.durationSec != null : s.reps != null;
}

/** Drop unfilled scaffold sets from every exercise and re-derive cluster
 *  `group` numbers on what remains, so the persisted/exported sets are both
 *  free of blank rows and consistently numbered (no phantom-cluster gaps,
 *  no cluster set missing its group). Used at the finish/export boundary. */
export function dropEmptySets(exercises: SessionExercise[]): SessionExercise[] {
  return exercises.map((ex) => {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    return { ...ex, sets: normalizeClusterGroups(ex.sets.filter((s) => isLoggedSet(s, style))) };
  });
}

export interface SessionExercise {
  exerciseId: string;
  name: string; // snapshot
  targetLoad?: number;
  cues: string[]; // snapshot
  /** Snapshot of the catalog exercise's {@link LogStyle}; omitted means
   *  {@link DEFAULT_LOG_STYLE}. Drives how the logger renders each set. */
  logStyle?: LogStyle;
  progression?: ProgressionRule; // snapshot
  sets: WorkoutSet[];
}

export interface WorkoutSession {
  id?: string;
  status: SessionStatus;
  templateId?: string;
  templateName?: string; // snapshot, for reference after template edits
  date: Date;
  /** Logged bodyweight. The store mirrors this into `dailyWeights` on
   *  finish so it is one source of truth with the Body tab. */
  bodyweight?: number;
  sleepHours?: number;
  durationMin?: number;
  exercises: SessionExercise[];
  /** "Next session notes" carried forward to the next session of the
   *  same template. */
  nextNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Drafts (what the user submits; ids + stamps are server-assigned) ─
export type ExerciseDraft = Omit<Exercise, 'id' | 'createdAt'>;
export type TemplateDraft = Omit<WorkoutTemplate, 'id' | 'createdAt' | 'updatedAt'>;
export type SessionDraft = Omit<WorkoutSession, 'id' | 'createdAt' | 'updatedAt'>;

// ─── Free / Pro caps ──────────────────────────────────────────────
// Numbers live in models/tier-limits.ts with the other free-tier
// thresholds; re-exported here so workout call sites keep one import.
export { CUSTOM_TEMPLATE_LIMIT_FREE, WORKOUT_HISTORY_DAYS_FREE } from './tier-limits';

/** Thrown by WorkoutStore.addTemplate when a free-tier user is at cap.
 *  Mirrors PresetLimitError so the UI can show a specific upsell. */
export class TemplateLimitError extends Error {
  constructor(readonly limit: number) {
    super(`Custom template limit of ${limit} reached.`);
    this.name = 'TemplateLimitError';
  }
}
