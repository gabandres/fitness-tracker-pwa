/**
 * Derivations the Train tab reads — the numbers behind the idle hero, the
 * per-exercise sparkline, the session/template summary lines, and the PR
 * celebration.
 *
 * ## Why these are here and not in the screen
 *
 * They lived inside `apps/mobile/src/app/(app)/train.tsx`, a 2,261-line file
 * whose other 20 declarations are React components — so nothing here could be
 * reached without mounting the screen, and none of it had a test. The Angular
 * Train tab then grew its own hand-written copies of the same two numbers, and
 * they had already diverged: the web's "top set" scanned every set by weight,
 * including warm-ups, where mobile scanned working sets only. Two apps
 * disagreeing about a user's heaviest lift is the kind of thing a shared module
 * makes impossible rather than merely unlikely.
 *
 * ## What is NOT here
 *
 * Anything that needs a translator. `sessionCounts` returns `{exercises, sets}`
 * and each frontend renders "3 exercises · 12 sets" in its own i18n; a core
 * module that took a `TFn` would be a view in disguise.
 *
 * The set-level PR/progression math it builds on (`computeExercisePRs`,
 * `metricForSet`, `isWorkingSet`, `suggestProgression`) is in
 * `./workout-progression`; this module is the session- and screen-level layer
 * over it.
 */
import type {
  LogStyle,
  SessionExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from './workout';
import { DEFAULT_LOG_STYLE, isLoggedSet } from './workout';
import type { ProgressionSuggestion } from './workout-progression';
import { computeExercisePRs, isWorkingSet, metricForSet } from './workout-progression';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Session tonnage ────────────────────────────────────────────

/** Total volume (Σ weight×reps) over a session's logged sets, rounded. Both
 *  Train tabs' history rows show this number. */
export function sessionVolume(session: Pick<WorkoutSession, 'exercises'>): number {
  let vol = 0;
  for (const ex of session.exercises) {
    for (const s of ex.sets) {
      if (s.weight != null && s.reps != null) vol += s.weight * s.reps;
    }
  }
  return Math.round(vol);
}

// ─── Idle hero ──────────────────────────────────────────────────

export interface TrainHeroStats {
  /** Sessions in the trailing 7 days. */
  count: number;
  /** Σ volume over those sessions. */
  volume: number;
  /** Heaviest WORKING set ever logged, across every session given. Warm-ups
   *  are excluded — a heavy warm-up is not a top set. */
  topSet: number;
}

/**
 * The three idle-hero numbers. `now` is passed in rather than read so the
 * seven-day window is testable and so a screen that already knows the render
 * time does not disagree with itself mid-frame.
 *
 * Pass only the sessions that should count — both frontends pass completed
 * ones.
 */
export function trainHeroStats(sessions: readonly WorkoutSession[], now: number): TrainHeroStats {
  const weekAgo = now - WEEK_MS;
  let count = 0;
  let volume = 0;
  let topSet = 0;
  for (const s of sessions) {
    if (s.date.getTime() >= weekAgo) {
      count += 1;
      volume += sessionVolume(s);
    }
    for (const ex of s.exercises) {
      const pr = computeExercisePRs([ex]);
      if (pr.maxWeight > topSet) topSet = pr.maxWeight;
    }
  }
  return { count, volume, topSet };
}

// ─── PR celebration ─────────────────────────────────────────────

/** Best estimated-1RM per exercise id across every session given — the
 *  signature the PR celebration diffs against. */
export function bestE1RMByExercise(sessions: readonly WorkoutSession[]): Record<string, number> {
  const rows = new Map<string, SessionExercise[]>();
  for (const s of sessions) {
    for (const ex of s.exercises) {
      const arr = rows.get(ex.exerciseId);
      if (arr) arr.push(ex);
      else rows.set(ex.exerciseId, [ex]);
    }
  }
  const out: Record<string, number> = {};
  for (const [id, exRows] of rows) out[id] = computeExercisePRs(exRows).bestE1RM;
  return out;
}

/**
 * Exercise ids whose best e1RM improved from `prev` to `next`.
 *
 * Crossing-only by construction: an exercise absent from `prev` compares
 * against 0, so the FIRST snapshot after load must not be treated as a
 * crossing — callers hold a null-first ref and skip the comparison until they
 * have a real previous snapshot. Otherwise every app launch celebrates.
 */
export function improvedExercises(
  prev: Record<string, number>,
  next: Record<string, number>,
): string[] {
  return Object.keys(next).filter((id) => next[id] > (prev[id] ?? 0));
}

// ─── Per-exercise history ───────────────────────────────────────

/** Rows for one exercise across the given sessions, in the order the sessions
 *  are given (both apps pass newest-first). */
export function exerciseHistory(
  sessions: readonly WorkoutSession[],
  exerciseId: string,
): SessionExercise[] {
  const out: SessionExercise[] = [];
  for (const s of sessions) {
    const match = s.exercises.find((e) => e.exerciseId === exerciseId);
    if (match) out.push(match);
  }
  return out;
}

/**
 * One metric point per session for the sparkline, OLDEST-FIRST.
 *
 * The metric follows the log style (e1RM / max reps / max hold — see
 * `metricForSet`). Sessions with no qualifying working set drop out entirely
 * rather than plotting a zero, which would read as a session where the user
 * got weaker.
 *
 * Input is newest-first (what `exerciseHistory` returns); the result is
 * reversed for the chart.
 */
export function exerciseSeries(history: readonly SessionExercise[], style: LogStyle): number[] {
  const pts: number[] = [];
  for (const ex of history) {
    let metric = 0;
    for (const s of ex.sets) {
      if (!isWorkingSet(s)) continue;
      metric = Math.max(metric, metricForSet(s, style));
    }
    if (metric > 0) pts.push(Math.round(metric));
  }
  return pts.reverse();
}

/** One cell per working set for the summary line — `"135×8"`, `"12"`, `"45s"`
 *  by log style. Sets missing the numbers their style needs are dropped. The
 *  caller joins them; the separator is a per-frontend style choice. */
export function workingSetCells(
  ex: Pick<SessionExercise, 'sets'>,
  style: LogStyle,
): string[] {
  const cells: string[] = [];
  for (const s of ex.sets) {
    if (!isWorkingSet(s)) continue;
    if (style === 'time') {
      if (s.durationSec != null) cells.push(`${s.durationSec}s`);
    } else if (style === 'bodyweight') {
      if (s.reps != null) cells.push(`${s.reps}`);
    } else if (s.weight != null && s.reps != null) {
      cells.push(`${s.weight}×${s.reps}`);
    }
  }
  return cells;
}

/** What the user last did on this exercise, or null when there is no
 *  comparable record. Shaped by log style so the caller formats rather than
 *  re-deciding which fields matter. */
export type LastPerformed =
  | { style: 'time'; durationSec: number }
  | { style: 'bodyweight'; reps: number }
  | { style: 'weight-reps'; weight: number; reps: number };

export function lastPerformed(
  sug: Pick<ProgressionSuggestion, 'lastWeight' | 'lastReps' | 'lastDurationSec'>,
  style: LogStyle,
): LastPerformed | null {
  if (style === 'time') {
    return sug.lastDurationSec != null ? { style, durationSec: sug.lastDurationSec } : null;
  }
  if (style === 'bodyweight') {
    return sug.lastReps != null ? { style, reps: sug.lastReps } : null;
  }
  return sug.lastWeight != null && sug.lastReps != null
    ? { style: 'weight-reps', weight: sug.lastWeight, reps: sug.lastReps }
    : null;
}

// ─── Done-ness and summary counts ───────────────────────────────

/** Every set in the exercise carries the count its log style needs — drives
 *  the collapsed check badge and the "N of M done" progress. An exercise with
 *  no sets is not done. */
export function exerciseIsFullyDone(ex: Pick<SessionExercise, 'logStyle' | 'sets'>): boolean {
  const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
  return ex.sets.length > 0 && ex.sets.every((s: WorkoutSet) => isLoggedSet(s, style));
}

export interface WorkCounts {
  exercises: number;
  sets: number;
}

/** Exercise + LOGGED-set counts for a session's summary line. */
export function sessionCounts(session: Pick<WorkoutSession, 'exercises'>): WorkCounts {
  let sets = 0;
  for (const ex of session.exercises) {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    for (const s of ex.sets) if (isLoggedSet(s, style)) sets += 1;
  }
  return { exercises: session.exercises.length, sets };
}

/** Exercise + PLANNED-set counts for a template's summary line. A template has
 *  no logged sets — its sets are the scaffold it will pre-fill. */
export function templateCounts(template: Pick<WorkoutTemplate, 'exercises'>): WorkCounts {
  let sets = 0;
  for (const ex of template.exercises) sets += ex.plannedSets.length;
  return { exercises: template.exercises.length, sets };
}
