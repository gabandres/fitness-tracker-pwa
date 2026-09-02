/**
 * Workout domain types shared by the Train tab in both apps (ADR-0007,
 * ADR-0012). Framework-free; the canonical home for the structural shapes
 * the pure progression/PR math operates on. The Angular PWA
 * (src/app/models/workout.ts) and the Expo app (apps/mobile/src/lib/workout.ts)
 * keep their own richer copies (drafts, Firestore-facing helpers); these are
 * the minimal shapes @macrolog/core needs and is the dedup target.
 */

import type { CardioBlock, PlannedCardioBlock } from './cardio';

/** How a set counts. `working` is the default straight set; `activation`
 *  + `mini` model cluster training; `warmup` is excluded from PR/progression
 *  math; `drop` is a back-off set; `mobility` is a timed hold or joint-prep
 *  movement, also excluded (ADR-0028).
 *
 *  This union is hand-mirrored in FOUR places, not three — `src/app/models/
 *  workout.ts`, `apps/mobile/src/lib/workout.ts`, and the web template
 *  editor's `SET_KINDS` array, which populates the kind `<select>`. Missing
 *  the last one compiles cleanly and silently never offers the kind. */
export type SetKind = 'warmup' | 'activation' | 'working' | 'mini' | 'drop' | 'mobility';

/** Muscle groups a catalog exercise can target. */
export type MuscleGroup =
  | 'chest' | 'back' | 'shoulders' | 'biceps' | 'triceps' | 'quads'
  | 'hamstrings' | 'glutes' | 'calves' | 'core' | 'forearms';

/** Planned scaffold for one set the session pre-fills. `group` clusters sets
 *  (C1/C2); omit it for plain straight sets.
 *
 *  `reps`/`repsMax`/`weight`/`durationSec` are the PRESCRIPTION — what the
 *  template tells you to do on this set. They are what makes a template say
 *  "3 × 8 @ 135" instead of just "three sets", and they are what
 *  `templateToSessionExercises` pre-fills the logger with, so a lifter
 *  confirms a number instead of typing it. All optional: every template
 *  written before they existed stays valid and simply prescribes nothing.
 *
 *  Not to be confused with {@link ProgressionRule.targetReps}, which is a
 *  *trigger* ("bump the load once you hit this for N sessions"), not a target
 *  for a given set. */
export interface PlannedSet {
  kind: SetKind;
  group?: number;
  /** Prescribed reps. With `repsMax`, the lower bound of a range. */
  reps?: number;
  /** Upper bound of a rep RANGE, e.g. `reps: 8, repsMax: 10` → "8-10". */
  repsMax?: number;
  /** Prescribed load for this set. Overrides the exercise-level
   *  `targetLoad`, which stays the fallback for sets that omit it. */
  weight?: number;
  /** Prescribed hold in seconds — `time` logStyle only. */
  durationSec?: number;
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

/**
 * Reps-in-reserve is a 0–5 integer scale: 0 is to failure, 5 is the practical
 * ceiling (anything easier is logged as 5). Nothing enforced this before — the
 * field was a bare `number` written straight from a numeric text input on both
 * clients, and `firestore.rules` cannot help, because rules have no way to
 * iterate a list and therefore never validate individual sets at all. A set
 * was found stored with `rir: 8`.
 */
export const RIR_MIN = 0;
export const RIR_MAX = 5;

/**
 * Coerce user input to a storable RIR, or `undefined` to leave it unset.
 * Non-numeric, negative and non-integer input becomes `undefined` rather than
 * a silently rounded value — a half-rep-in-reserve is not a thing the user
 * meant, and guessing which whole number they intended is worse than asking
 * again. Values above the ceiling clamp to it, since "very easy" is the one
 * intent that IS unambiguous.
 */
export function clampRir(value: unknown): number | undefined {
  // Guard emptiness BEFORE coercion: Number('') and Number(null) are both 0,
  // and 0 is a legitimate RIR meaning "to failure". Without this, clearing the
  // field would silently record the most aggressive value on the scale.
  if (value == null || value === '') return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < RIR_MIN) return undefined;
  return Math.min(RIR_MAX, n);
}

export interface WorkoutSet {
  kind: SetKind;
  group?: number;
  weight?: number;
  reps?: number;
  /** Hold duration in seconds — for `time` logStyle exercises. */
  durationSec?: number;
  /** Reps in reserve (0 = to failure), 0–5. Write through {@link clampRir}. */
  rir?: number;
  done?: boolean;
  /** The template's PRESCRIPTION for this set, snapshotted at start.
   *
   *  Deliberately NOT written into `reps`/`durationSec`: {@link isLoggedSet}
   *  treats those as proof the set was performed, so pre-filling them would
   *  make finishing a session record every prescribed set as done — training
   *  history the lifter never did. These render as the input's placeholder
   *  instead, and are committed to the real fields only when the set is
   *  ticked `done`. */
  targetReps?: number;
  targetDurationSec?: number;
}

export interface SessionExercise {
  exerciseId: string;
  name: string; // snapshot
  targetLoad?: number;
  cues: string[]; // snapshot
  logStyle?: LogStyle;
  progression?: ProgressionRule; // snapshot
  sets: WorkoutSet[];
}

export type SessionStatus = 'active' | 'completed';

/**
 * A logged workout instance — the full read-model both frontends map to
 * (was a minimal CSV-only shape; promoted to the canonical domain type so the
 * shared `toWorkoutSession` mapper can return it). Starting a session snapshots
 * the template's exercises here so template edits never rewrite history.
 */
export interface WorkoutSession {
  id?: string;
  status: SessionStatus;
  templateId?: string;
  templateName?: string; // snapshot, for reference after template edits
  date: Date;
  /** Logged bodyweight; the store mirrors this into dailyWeights on finish. */
  bodyweight?: number;
  sleepHours?: number;
  /**
   * How long the whole SESSION took, in minutes.
   *
   * Not to be confused with `CardioBlock.durationSec`, which is how long one
   * run was. Different unit, different question, one careless autocomplete
   * apart (ADR-0025).
   */
  durationMin?: number;
  exercises: SessionExercise[];
  /**
   * Logged cardio (ADR-0025). A lifting day with a finisher has both arrays;
   * a run on its own is a session with `exercises: []` and one block here.
   *
   * **No strength derivation may read this.** `sessionVolume`,
   * `computeExercisePRs`, `bestE1RMByExercise`, `metricForSet`,
   * `suggestProgression` and `trainHeroStats` walk `exercises` only, and
   * `cardio-strength-independence.test.ts` fails if that stops being true.
   */
  cardio?: CardioBlock[];
  /** "Next session notes" carried forward to the next session of the template. */
  nextNotes?: string;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Exercise catalog ───────────────────────────────────────────

/**
 * Comparison key for an exercise name. Exercise identity is a per-user
 * Firestore doc id with a free-text `name`; nothing dedupes, so "Bench Press",
 * "bench press" and "Bench  Press" become three catalog rows and three
 * disjoint progression histories.
 *
 * This collapses only what is unambiguously the same string — case, surrounding
 * and repeated whitespace, and trailing punctuation. It deliberately does NOT
 * try to equate "DB Incline Chest Press" with "Incline Dumbbell Press": that
 * needs abbreviation expansion and fuzzy token matching, and a false positive
 * merges two real exercises and destroys the progression history of both.
 * Near-duplicates should be SUGGESTED to the user, never merged silently.
 */
export function exerciseNameKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=_`~()]/g, '')
    .replace(/\s+/g, ' ');
}

/** The existing catalog entry an incoming name would duplicate, if any. */
export function findDuplicateExercise<T extends { id?: string; name: string }>(
  name: string,
  catalog: readonly T[],
): T | undefined {
  const key = exerciseNameKey(name);
  if (!key) return undefined;
  return catalog.find((e) => exerciseNameKey(e.name) === key);
}

export interface Exercise {
  id?: string;
  name: string;
  muscles: MuscleGroup[];
  /** Form cues shown by default when this exercise is added to a template. */
  defaultCues: string[];
  logStyle?: LogStyle;
  /** Stable slug of the shipped library entry this was cloned from, if any. */
  seedKey?: string;
  createdAt: Date;
}

// ─── Template ───────────────────────────────────────────────────
export interface TemplateExercise {
  exerciseId: string;
  /** Snapshot of the catalog name so the template renders without a join. */
  name: string;
  targetLoad?: number;
  /** Per-template cue override; falls back to the exercise's defaultCues. */
  cues?: string[];
  logStyle?: LogStyle;
  progression?: ProgressionRule;
  plannedSets: PlannedSet[];
  /** Rest before this exercise's mini-sets / straight sets, seconds — an
   *  EXERCISE-level override of the template's `restMiniSec`. Exists because a
   *  bodyweight cluster cannot shed load between efforts: 15–20 s of rest
   *  yields 1-rep minis on a pull-up while it is right for every loaded lift on
   *  the same day, so the template default must not move. Read through
   *  `restAfterSet`'s callers; nothing else. Absent means "use the template's". */
  restMiniSec?: number;
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
  /** Prescribed cardio (ADR-0025) — the analogue of `plannedSets`. Starting a
   *  session snapshots these into `WorkoutSession.cardio` as TARGETS, which
   *  render as placeholders and are committed to the real fields only when the
   *  block is actually performed. A prescription is not a record of work. */
  cardioBlocks?: PlannedCardioBlock[];
  /** Stable slug of the shipped starter this was cloned from, if any. */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
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
