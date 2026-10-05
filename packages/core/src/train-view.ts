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
import { toDisplayLoad } from './load-units';
import type { UnitSystem } from './unit-system';
import { DEFAULT_LOG_STYLE, isLoggedSet } from './workout';
import type { ProgressionSuggestion } from './workout-progression';
import { computeExercisePRs, isWorkingSet, metricForSet } from './workout-progression';
import { isLoggedCardioBlock } from './cardio';
import { normalizeClusterGroups } from './cluster-groups';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Session tonnage ────────────────────────────────────────────

/** Total volume (Σ weight×reps) over a session's logged sets, rounded. Both
 *  Train tabs' history rows show this number. */
export function sessionVolume(session: Pick<WorkoutSession, 'exercises'>): number {
  let vol = 0;
  for (const ex of session.exercises) {
    for (const s of ex.sets) {
      // Mobility is not lifting volume (ADR-0028). ADR-0028 reasoned this was
      // already safe "because a hold carries neither weight nor reps" — true
      // of a bodyweight stretch and NOT of a loaded one, which is a real thing
      // a user can type. Nothing else about this sum changes: warm-ups and
      // drops still count toward tonnage exactly as they always have, because
      // the weight really was moved.
      if (s.kind === 'mobility') continue;
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
    const metric = sessionMetric(ex, style);
    if (metric > 0) pts.push(metric);
  }
  return pts.reverse();
}

/** The best working-set metric of one session's sets, rounded; 0 = none. */
function sessionMetric(ex: Pick<SessionExercise, 'sets'>, style: LogStyle): number {
  let metric = 0;
  for (const s of ex.sets) {
    if (!isWorkingSet(s)) continue;
    metric = Math.max(metric, metricForSet(s, style));
  }
  return Math.round(metric);
}

/**
 * {@link exerciseSeries} with each point's date kept beside it — the x axis of
 * the chart's audio graph and the session count its spoken summary names.
 *
 * Same drop rule, same OLDEST-FIRST order, so `points.map((p) => p.value)` is
 * exactly `exerciseSeries`. It exists because the bare series cannot be lined
 * back up with dates once a session has dropped out: index 3 of the series is
 * not row 3 of the history.
 */
export function exerciseSeriesPoints<D>(
  rows: readonly { date: D; ex: Pick<SessionExercise, 'sets'> }[],
  style: LogStyle,
): { date: D; value: number }[] {
  const pts: { date: D; value: number }[] = [];
  for (const r of rows) {
    const value = sessionMetric(r.ex, style);
    if (value > 0) pts.push({ date: r.date, value });
  }
  return pts.reverse();
}

/** One cell per working set for the summary line — `"135×8"`, `"12"`, `"45s"`
 *  by log style. Sets missing the numbers their style needs are dropped. The
 *  caller joins them; the separator is a per-frontend style choice. */
export function workingSetCells(
  ex: Pick<SessionExercise, 'sets'>,
  style: LogStyle,
  /** Training unit for the weight cells. Weights are STORED in pounds; this
   *  only decides what the cell says. Omitted keeps pounds, which is every
   *  existing caller and every account that never chose (UX_AUDIT F3). */
  unitSystem?: UnitSystem,
): string[] {
  const cells: string[] = [];
  for (const s of ex.sets) {
    if (!isWorkingSet(s)) continue;
    if (style === 'time') {
      if (s.durationSec != null) cells.push(`${s.durationSec}s`);
    } else if (style === 'bodyweight') {
      if (s.reps != null) cells.push(`${s.reps}`);
    } else if (s.weight != null && s.reps != null) {
      cells.push(`${toDisplayLoad(s.weight, unitSystem)}×${s.reps}`);
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

// ─── Finishing a session ────────────────────────────────────────

/**
 * Whether a session holds anything that actually happened: one logged set, or
 * one performed cardio block.
 *
 * The Finish button used to complete a session with nothing in it — a
 * template started and abandoned before the first set — and that still wrote
 * a completed workout and stamped the day's streak marker. "Nothing logged" is
 * the condition the screen turns into "discard instead?", and the finish
 * operation's own guard against marking an empty day as exercised.
 *
 * Reads `cardio` only to answer "is there anything here"; no strength number
 * is derived from it (ADR-0025).
 */
export function sessionHasLoggedWork(
  session: Pick<WorkoutSession, 'exercises' | 'cardio'>,
): boolean {
  for (const ex of session.exercises) {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    if (ex.sets.some((s) => isLoggedSet(s, style))) return true;
  }
  return (session.cardio ?? []).some(isLoggedCardioBlock);
}

/**
 * Drop exercises that are left with no sets once the unlogged ones have been
 * pruned. A lift that was on the template and never touched is not part of
 * the workout that happened — keeping it put a name with nothing under it in
 * history and counted it in "3 exercises".
 */
export function dropEmptyExercises<E extends { sets: readonly unknown[] }>(exercises: E[]): E[] {
  return exercises.some((e) => e.sets.length === 0)
    ? exercises.filter((e) => e.sets.length > 0)
    : exercises;
}

/**
 * Move one exercise from `from` to `to` — the live session's "Move up / Move
 * down". A MOVE, not a swap, so the same function serves a drag later. Out of
 * range (or no move) returns the input unchanged, so a caller can skip the
 * write by identity.
 */
export function moveExercise<E>(exercises: E[], from: number, to: number): E[] {
  if (from === to || from < 0 || to < 0 || from >= exercises.length || to >= exercises.length) {
    return exercises;
  }
  const next = [...exercises];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/**
 * The exercise to open after `from` is finished — the live session's
 * auto-advance, which Strong and Hevy do and which used to cost a collapse and
 * a tap here.
 *
 * The first unfinished exercise AFTER `from`, else the first one before it (a
 * lift skipped earlier is still owed), else `null` when every exercise is done.
 * "Unfinished" is {@link exerciseIsFullyDone}'s negation, so an exercise with no
 * sets yet counts as unfinished — it is the next thing to fill in.
 */
export function nextUnfinishedExercise(
  exercises: readonly Pick<SessionExercise, 'logStyle' | 'sets'>[],
  from: number,
): number | null {
  for (let i = from + 1; i < exercises.length; i++) {
    if (!exerciseIsFullyDone(exercises[i])) return i;
  }
  for (let i = 0; i < Math.min(from, exercises.length); i++) {
    if (!exerciseIsFullyDone(exercises[i])) return i;
  }
  return null;
}

/**
 * One removal from a live session, kept so it can be undone — the Undo on the
 * "Set removed" / "Exercise removed" toast.
 *
 * The SET form carries the exercise's id beside its index: an exercise can be
 * moved between the delete and the Undo, and a restore by index alone would
 * then put a bench set into a row.
 */
export type SessionRemoval =
  | { kind: 'exercise'; index: number; exercise: SessionExercise }
  | { kind: 'set'; exerciseIndex: number; exerciseId: string; setIndex: number; set: WorkoutSet };

/**
 * Put back what {@link SessionRemoval} took out, purely.
 *
 * An exercise goes back at its old index (clamped, so a list that shrank in the
 * meantime takes it at the end). A set goes back at its old position in the
 * exercise with the same id — the one at its old index if it still matches,
 * else the first with that id — and cluster groups are re-derived, because a
 * restored mini or activation can re-form the cluster it was cut from. When the
 * exercise is gone altogether there is nowhere to put the set, and the session
 * comes back unchanged (same reference, so a caller skips the write).
 */
export function undoRemoval(session: WorkoutSession, removal: SessionRemoval): WorkoutSession {
  const list = session.exercises;
  if (removal.kind === 'exercise') {
    const at = Math.max(0, Math.min(removal.index, list.length));
    return { ...session, exercises: [...list.slice(0, at), removal.exercise, ...list.slice(at)] };
  }
  const target = list[removal.exerciseIndex]?.exerciseId === removal.exerciseId
    ? removal.exerciseIndex
    : list.findIndex((e) => e.exerciseId === removal.exerciseId);
  if (target < 0) return session;
  return {
    ...session,
    exercises: list.map((e, i) => {
      if (i !== target) return e;
      const at = Math.max(0, Math.min(removal.setIndex, e.sets.length));
      return { ...e, sets: normalizeClusterGroups([...e.sets.slice(0, at), removal.set, ...e.sets.slice(at)]) };
    }),
  };
}

/**
 * Whether one set beats the best estimated-1RM on record for its lift — the
 * "PR" badge that appears the moment a set is ticked.
 *
 * Strict, working sets only, `weight-reps` only (the same metric
 * `bestE1RMByExercise` keeps), and never on a FIRST record: with no prior best
 * every set of a new lift would be a "PR", which is noise rather than news.
 */
export function setBeatsBest(set: WorkoutSet, style: LogStyle, best: number | undefined): boolean {
  if (style !== 'weight-reps' || !isWorkingSet(set) || !best || best <= 0) return false;
  if (!isLoggedSet(set, style) || set.weight == null || set.weight <= 0) return false;
  return metricForSet(set, style) > best;
}

/** One record set beaten in a session, for the finish summary. */
export interface SessionPr {
  exerciseId: string;
  name: string;
  /** Pounds, as stored. The screen converts. */
  weight: number;
  reps: number;
}

export interface FinishSummary {
  /** Whole minutes from the session's start to `now`; never negative. */
  durationMin: number;
  /** {@link sessionVolume} of what is logged so far. */
  volume: number;
  /** Logged sets ({@link sessionCounts}). */
  sets: number;
  /** Lifts whose best set this session beats every prior session. */
  prs: SessionPr[];
  /** Volume of the last completed session of the SAME template, or null when
   *  there is none to compare with (ad-hoc, or the first time). */
  previousVolume: number | null;
  /** Names of the lifts with no logged set, in session order. Finishing drops
   *  them (`dropEmptyExercises`), so the sheet says so BEFORE the save rather
   *  than letting a forgotten lift vanish from the record unannounced. */
  unstarted: string[];
  /** The session's heaviest working set by estimated 1RM, `weight-reps` only;
   *  null when nothing loaded was logged. The line the sheet leads with when
   *  there is no record to celebrate. */
  topSet: SessionPr | null;
}

/**
 * What the Finish sheet says about the workout before it is saved: how long,
 * how much, any records, and how it compares with last time.
 *
 * `completed` is the history the tab already holds, newest first (both apps
 * pass it that way). The session itself is excluded by id, so a reopened
 * session is not compared with its own earlier copy. The comparison is
 * against the same template only — "more volume than your leg day" is not a
 * comparison anyone asked for.
 */
export function finishSummary(
  session: Pick<WorkoutSession, 'id' | 'date' | 'exercises' | 'templateId'>,
  completed: readonly WorkoutSession[],
  now: number,
): FinishSummary {
  const prior = completed.filter((s) => s.status === 'completed' && (!session.id || s.id !== session.id));
  const best = bestE1RMByExercise(prior);
  const prs: SessionPr[] = [];
  const unstarted: string[] = [];
  let topSet: SessionPr | null = null;
  let topMetric = 0;
  for (const ex of session.exercises) {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    if (!ex.sets.some((s) => isLoggedSet(s, style))) unstarted.push(ex.name);
    if (style === 'weight-reps') {
      for (const s of ex.sets) {
        if (!isWorkingSet(s) || !isLoggedSet(s, style) || s.weight == null || s.weight <= 0 || s.reps == null) continue;
        const m = metricForSet(s, style);
        if (m > topMetric) {
          topMetric = m;
          topSet = { exerciseId: ex.exerciseId, name: ex.name, weight: s.weight, reps: s.reps };
        }
      }
    }
    let top: WorkoutSet | null = null;
    for (const s of ex.sets) {
      if (!setBeatsBest(s, style, best[ex.exerciseId])) continue;
      if (!top || metricForSet(s, style) > metricForSet(top, style)) top = s;
    }
    if (top && top.weight != null && top.reps != null) {
      prs.push({ exerciseId: ex.exerciseId, name: ex.name, weight: top.weight, reps: top.reps });
    }
  }
  const last = session.templateId
    ? prior.find((s) => s.templateId === session.templateId)
    : undefined;
  const started = session.date instanceof Date ? session.date.getTime() : now;
  return {
    durationMin: Math.max(0, Math.round((now - started) / 60_000)),
    volume: sessionVolume(session),
    sets: sessionCounts(session).sets,
    prs,
    previousVolume: last ? sessionVolume(last) : null,
    unstarted,
    topSet,
  };
}
