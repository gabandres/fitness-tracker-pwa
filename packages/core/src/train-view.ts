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
  Side,
  TemplateExercise,
  WorkoutSession,
  WorkoutSet,
  WorkoutTemplate,
} from './workout';
import { toDisplayLoad } from './load-units';
import type { UnitSystem } from './unit-system';
import { DEFAULT_LOG_STYLE, isLoggedSet } from './workout';
import type { ProgressionSuggestion } from './workout-progression';
import { computeExercisePRs, isWorkingSet, metricForSet } from './workout-progression';
import { isLoggedCardioBlock, workoutMarkerEntry } from './cardio';
import { normalizeClusterGroups } from './cluster-groups';
import { calendarDateKey } from './date';
import { readableHistory } from './side-tracks';

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

/** The heaviest working set of the hero's week, with the lift it belongs to. */
export interface HeroTopSet {
  exerciseId: string;
  name: string;
  /** Pounds, as stored. The screen converts. */
  weight: number;
}

export interface TrainHeroStats {
  /** Sessions in the trailing 7 days. */
  count: number;
  /** Σ volume over those sessions. */
  volume: number;
  /** Heaviest WORKING set in those same 7 days, and whose it was; null when
   *  the week logged no load. Warm-ups are excluded — a heavy warm-up is not
   *  a top set.
   *
   *  It was the heaviest set EVER, as a bare number, printed inside the panel
   *  headed "Last 7 days": a 40-day-old deadlift read as this week's, under
   *  no lift name at all (train-ux H-N4, 2026-10-12). */
  topSet: HeroTopSet | null;
}

/**
 * The three idle-hero numbers, all over ONE window. `now` is passed in rather
 * than read so the seven-day window is testable and so a screen that already
 * knows the render time does not disagree with itself mid-frame.
 *
 * Pass only the sessions that should count — both frontends pass completed
 * ones, newest first; of two equal tops the first one seen wins.
 */
export function trainHeroStats(sessions: readonly WorkoutSession[], now: number): TrainHeroStats {
  const weekAgo = now - WEEK_MS;
  let count = 0;
  let volume = 0;
  let topSet: HeroTopSet | null = null;
  for (const s of sessions) {
    if (s.date.getTime() < weekAgo) continue;
    count += 1;
    volume += sessionVolume(s);
    for (const ex of s.exercises) {
      const { maxWeight } = computeExercisePRs([ex]);
      if (maxWeight > (topSet?.weight ?? 0)) topSet = { exerciseId: ex.exerciseId, name: ex.name, weight: maxWeight };
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

/** The row fields that decide which sessions the engine may read. */
export type EngineReadRow = Pick<TemplateExercise, 'clusterCountChange'> & {
  baseline?: { since: string };
  excludedReads?: readonly { date: string }[];
};

/**
 * The sessions whose reads are evidence for a row: none before its baseline
 * marker (`TemplateExercise.baseline`), none on an excluded day
 * (`TemplateExercise.excludedReads`), and never a deload session. Compared by
 * calendar day, the unit both are written in. Order is kept.
 */
export function engineSessions<S extends Pick<WorkoutSession, 'date'> & { deload?: boolean }>(
  sessions: readonly S[],
  row?: EngineReadRow | null,
): S[] {
  const since = row?.baseline?.since;
  const excluded = new Set((row?.excludedReads ?? []).map((x) => x.date));
  // A deload session is never evidence for the next load (`deload.ts`).
  const live = sessions.some((s) => s.deload) ? sessions.filter((s) => !s.deload) : sessions;
  if (!since && excluded.size === 0) return [...live];
  return live.filter((s) => {
    const day = calendarDateKey(s.date);
    return !(since && day < since) && !excluded.has(day);
  });
}

/**
 * The history the progression ENGINE reads for a template row: {@link
 * exerciseHistory} over {@link engineSessions}. Charts and PRs keep reading
 * the full history — a baseline or an excluded read says those reads are not
 * evidence for the NEXT load, not that they did not happen.
 */
export function engineHistory(
  sessions: readonly WorkoutSession[],
  exerciseId: string,
  row?: EngineReadRow | null,
  side?: Side,
): SessionExercise[] {
  const history = exerciseHistory(engineSessions(sessions, row), exerciseId);
  // Program v2: a cluster-count change reads cluster 1 only; an L/R lift
  // reads one side at a time (`side-tracks.ts`).
  return readableHistory(history, row, side);
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

/** A logged set {@link workingSetCells} leaves out, with its kind for the
 *  label ("Warm-up 95×8"). */
export interface OtherSetCell {
  kind: 'warmup' | 'drop' | 'mobility';
  cell: string;
}

/**
 * The LOGGED warm-up, drop and mobility sets of one exercise, in order — the
 * other half of {@link workingSetCells}. A session's set count
 * (`sessionCounts`) counts every logged set, so a detail view that listed only
 * the working ones said "12 sets" over nine (train-ux review H3, 2026-10-11).
 * A weight-reps set with no weight still shows its reps; the caller labels
 * each cell by `kind`.
 */
export function otherSetCells(
  ex: Pick<SessionExercise, 'sets'>,
  style: LogStyle,
  unitSystem?: UnitSystem,
): OtherSetCell[] {
  const out: OtherSetCell[] = [];
  for (const s of ex.sets) {
    if (isWorkingSet(s) || !isLoggedSet(s, style)) continue;
    const kind = s.kind as OtherSetCell['kind'];
    if (style === 'time') out.push({ kind, cell: `${s.durationSec}s` });
    else if (style === 'bodyweight' || s.weight == null) out.push({ kind, cell: `${s.reps}` });
    else out.push({ kind, cell: `${toDisplayLoad(s.weight, unitSystem)}×${s.reps}` });
  }
  return out;
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
 * A finished workout as a day of training, for the streak and History's
 * "trained" — in memory, never stored (owner, 2026-10-15, bug C).
 *
 * Finishing a workout used to WRITE this row into `dailyLogs`: a 0-kcal,
 * unlabeled `exerciseCompleted` marker, so the day counted toward the streak
 * (ADR-0007). It read as an empty meal in every export and the owner deleted
 * all 33 of them on 10/13; new ones kept arriving with every finish. The
 * session itself already says the day was trained, so the marker is now
 * derived from it at read time and handed to the same consumers in the same
 * shape — `computeStreak` and `summarizeDays` cannot tell the difference.
 * Markers already stored keep counting; nothing removes them.
 *
 * Only completed sessions with logged work: an abandoned or empty session was
 * never a day of training (`sessionHasLoggedWork`). The 0 kcal is the same
 * `workoutMarkerEntry` zero, so energy balance is untouched (ADR-0026 d5).
 */
/** One lift's ticked effort sets with no RIR, by index into the session. */
export interface MissingRir {
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  /** Indices into that exercise's `sets`. */
  setIndexes: number[];
  /** The lift's target RIR (`targetRirOf` its effort standard) — what Finish
   *  offers to fill an activation or working set with (Program v2.1). Set by
   *  the caller, which has the catalog; absent reads as 0. */
  targetRir?: number;
}

/**
 * Saved effort sets (working, activation, mini, continuation — the kinds the
 * RIR picker offers; ticked, or unticked with reps, which the save keeps too)
 * with no RIR, per lift.
 *
 * ## Why Finish has to ask (owner, 2026-10-15)
 *
 * Nothing on the way to a saved set requires an RIR. A tick accepts reps and
 * load but never an RIR — in the app, and on the Lock Screen's "Done set",
 * which has no RIR control at all. The 10/13 fix made the engine read a blank
 * as 0 and put a "RIR missing — enter it?" line under the row, but that line
 * is per row, non-blocking and gone once the session is saved. So whole lifts
 * saved blank on 10/14 (Incline DB Curl 45°, all three rows) and 10/15
 * (Deficit Push-up, all three), with every other lift complete. Finish is the
 * one point every path passes, with the whole session in view.
 */
export function setsMissingRir(
  exercises: readonly Pick<SessionExercise, 'exerciseId' | 'name' | 'sets'>[],
  /** Whether this lifter logged an RIR on the lift before (last session's
   *  rows) — the third half of the app's `liftUsesRir`. */
  loggedBefore: (exerciseId: string) => boolean = () => false,
): MissingRir[] {
  const effort = new Set(['working', 'activation', 'mini', 'continuation']);
  const cluster = new Set(['activation', 'mini', 'continuation']);
  const out: MissingRir[] = [];
  exercises.forEach((ex, exerciseIndex) => {
    // Only a lift that USES RIR — the rule the RIR column follows (S23-5): a
    // clustered lift (the engine gates on its activation's RIR), one with an
    // RIR entered on some row, or one that carried RIR last time. A plain
    // straight-set lift never showed the column and is not asked about it.
    const usesRir = ex.sets.some((s) => s.rir != null || cluster.has(s.kind ?? 'working')) || loggedBefore(ex.exerciseId);
    if (!usesRir) return;
    // Ticked OR carrying reps: the save keeps any set with a count
    // (`isLoggedSet`, via `dropEmptySets`), ticked or not. Gating on `done`
    // alone let the 10/19 Leg Curls through — three rows typed, never ticked,
    // saved with no RIR and never asked about.
    const setIndexes = ex.sets.flatMap((s, i) => ((s.done || isLoggedSet(s)) && s.rir == null && effort.has(s.kind ?? 'working') ? [i] : []));
    if (setIndexes.length) out.push({ exerciseIndex, exerciseId: ex.exerciseId, name: ex.name, setIndexes });
  });
  return out;
}

/** How many recent sessions the streak hooks read for trained days. */
export const TRAINED_DAYS_SESSIONS = 60;

export function trainedDayRows(
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'exercises' | 'cardio'>[],
): { date: Date; calories: number; exerciseCompleted: true }[] {
  return sessions
    .filter((s) => s.status === 'completed' && sessionHasLoggedWork(s))
    .map((s) => ({ date: s.date, ...workoutMarkerEntry() }));
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

/** The longest session `durationMin` records (rules: 0–1440). */
const MAX_SESSION_MIN = 24 * 60;

/**
 * How long a session took, start to finish, in whole minutes — what Finish
 * writes to `WorkoutSession.durationMin` (2026-10-11; nothing wrote it from the
 * app before, so 41 of the owner's 48 sessions have none). Undefined when the
 * interval is not a plausible session — a start date edited to another day, a
 * clock that moved backwards — rather than a number that would poison every
 * average it enters.
 */
export function sessionDurationMin(start: Date, end: Date): number | undefined {
  const min = Math.round((end.getTime() - start.getTime()) / 60_000);
  return Number.isFinite(min) && min > 0 && min <= MAX_SESSION_MIN ? min : undefined;
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
   *  there is none to compare with (ad-hoc, or the first time) — summed over
   *  only the lifts THIS session logged (train-ux F4, 2026-10-11): a session
   *  with two lifts not started read "−67% volume vs last time" under its own
   *  record, which compared one lift with three. */
  previousVolume: number | null;
  /** The last session had lifts this one did not log, so `previousVolume`
   *  leaves them out and the sheet says "on the same lifts". */
  previousSameLiftsOnly: boolean;
  /** Names of the lifts with no logged set, in session order. Finishing drops
   *  them (`dropEmptyExercises`), so the sheet says so BEFORE the save rather
   *  than letting a forgotten lift vanish from the record unannounced. */
  unstarted: string[];
  /** The session's heaviest working set by estimated 1RM, `weight-reps` only;
   *  null when nothing loaded was logged. The line the sheet leads with when
   *  there is no record to celebrate. */
  topSet: SessionPr | null;
  /** Sets not logged inside a lift that WAS started — the save drops them
   *  (`dropEmptySets`). Lifts not started at all are `unstarted` instead. */
  skippedSets: number;
  /** Sets with their numbers typed but never ticked done. The save keeps
   *  them as performed (`isLoggedSet` reads the count, not the tick), so
   *  the sheet says so while it can still be fixed (train-ux F9). */
  untickedSets: number;
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
  const loggedIds = new Set<string>();
  let skippedSets = 0;
  let untickedSets = 0;
  let topSet: SessionPr | null = null;
  let topMetric = 0;
  for (const ex of session.exercises) {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    const logged = ex.sets.filter((s) => isLoggedSet(s, style));
    if (logged.length === 0) unstarted.push(ex.name);
    else {
      loggedIds.add(ex.exerciseId);
      skippedSets += ex.sets.length - logged.length;
      untickedSets += logged.filter((s) => !s.done).length;
    }
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
  const lastSame = last ? last.exercises.filter((e) => loggedIds.has(e.exerciseId)) : [];
  return {
    durationMin: Math.max(0, Math.round((now - started) / 60_000)),
    volume: sessionVolume(session),
    sets: sessionCounts(session).sets,
    prs,
    previousVolume: last ? sessionVolume({ exercises: lastSame }) : null,
    previousSameLiftsOnly: last != null && lastSame.length < last.exercises.length,
    unstarted,
    topSet,
    skippedSets,
    untickedSets,
  };
}
