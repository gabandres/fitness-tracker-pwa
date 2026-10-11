/**
 * Is the superset working? (2026-10-11)
 *
 * Compares an exercise's last three STRAIGHT-set sessions with its SUPERSET
 * sessions on four numbers: activation reps (average across the session's
 * clusters), first mini-set reps, validity rate (the engine's own gate), and
 * session duration (start to finish, `durationMin`). A session counts as a
 * superset session for an exercise when the exercise was logged with a
 * `supersetGroup` — the snapshot taken at start, so a template edited later
 * cannot reclassify history.
 *
 * The flag is deliberately narrow: activation reps down by
 * {@link SUPERSET_COST_REPS}+ against the straight-set sessions AT THE SAME
 * LOAD, in the {@link SUPERSET_COST_SESSIONS} most recent judgeable superset
 * sessions IN A ROW (Program v2, 2026-10-11 — it was "2 of the last 3" until
 * then). A drop at a new load is the load, not the superset, and such a
 * session is not judgeable; one bad day is one bad day; and a good session in
 * between breaks the run. It only ever suggests — nothing is changed
 * automatically.
 *
 * Pure; no I/O. Reads only what was logged; a metric with nothing to average
 * is `undefined`, never 0.
 */
import type { SessionExercise, WorkoutSession } from './workout';
import { readExercise } from './progression-engine';
import { supersetLabel } from './superset';

export const STRAIGHT_BASELINE_SESSIONS = 3;
export const SUPERSET_COST_REPS = 2;
export const SUPERSET_COST_SESSIONS = 2;
/** The flag reads only this many most recent superset sessions: two bad days
 *  in week 1 must not keep warning after six good ones. */
export const SUPERSET_RECENT_SESSIONS = 3;

/** One exercise in one session, reduced to the four numbers. */
export interface ExerciseOccurrence {
  date: Date;
  sessionId?: string;
  superset: boolean;
  label?: string;
  /** The activation load, when every activation used one load. */
  load?: number;
  activationRepsAvg?: number;
  firstMiniRepsAvg?: number;
  /** The engine's validity gate on this read; undefined when there is no
   *  cluster to read (straight sets, a timed hold). */
  valid?: boolean;
  durationMin?: number;
}

const avg = (xs: readonly number[]): number | undefined =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
const round1 = (x: number | undefined): number | undefined => (x == null ? undefined : Math.round(x * 10) / 10);

export function occurrenceOf(session: Pick<WorkoutSession, 'id' | 'date' | 'durationMin'>, ex: SessionExercise): ExerciseOccurrence {
  const acts = ex.sets.filter((s) => s.kind === 'activation' && s.reps != null);
  const read = readExercise(ex, { expectsCluster: true });
  const loads = [...new Set(acts.map((s) => s.weight).filter((w): w is number => w != null))];
  const label = supersetLabel(ex);
  return {
    date: session.date,
    ...(session.id ? { sessionId: session.id } : {}),
    superset: ex.supersetGroup != null,
    ...(label ? { label } : {}),
    ...(loads.length === 1 ? { load: loads[0] } : {}),
    activationRepsAvg: avg(acts.map((s) => s.reps as number)),
    firstMiniRepsAvg: avg(read.clusters.map((c) => c.minis[0]).filter((m): m is number => m != null)),
    ...(read.clustered ? { valid: read.valid } : {}),
    ...(session.durationMin != null ? { durationMin: session.durationMin } : {}),
  };
}

export interface ReportSide {
  sessions: number;
  /** Sessions with a recorded duration — what `durationMinAvg` averages. */
  timedSessions: number;
  activationRepsAvg?: number;
  firstMiniRepsAvg?: number;
  /** 0–1. */
  validityRate?: number;
  durationMinAvg?: number;
}

function side(occ: readonly ExerciseOccurrence[]): ReportSide {
  const judged = occ.filter((o) => o.valid != null);
  return {
    sessions: occ.length,
    timedSessions: occ.filter((o) => o.durationMin != null).length,
    activationRepsAvg: round1(avg(occ.flatMap((o) => (o.activationRepsAvg != null ? [o.activationRepsAvg] : [])))),
    firstMiniRepsAvg: round1(avg(occ.flatMap((o) => (o.firstMiniRepsAvg != null ? [o.firstMiniRepsAvg] : [])))),
    validityRate: judged.length ? judged.filter((o) => o.valid).length / judged.length : undefined,
    durationMinAvg: round1(avg(occ.flatMap((o) => (o.durationMin != null ? [o.durationMin] : [])))),
  };
}

const diff = (a?: number, b?: number) => (a == null || b == null ? undefined : round1(a - b));

export interface ExerciseSupersetReport {
  exerciseId: string;
  /** The last {@link STRAIGHT_BASELINE_SESSIONS} straight-set sessions. */
  straight: ReportSide;
  superset: ReportSide;
  /** superset − straight, per metric. */
  delta: { activationReps?: number; firstMiniReps?: number; validityRate?: number; durationMin?: number };
  /** Of the last {@link SUPERSET_RECENT_SESSIONS} superset sessions, those
   *  whose activation average fell {@link SUPERSET_COST_REPS}+ under the
   *  straight-set average at the same load. */
  costlySessions: Date[];
  /** Activation reps at ONE load — the latest superset session's — on both
   *  sides, so the comparison never mixes loads. Absent when no straight
   *  session in the baseline used that load. */
  sameLoad?: { load: number; straight: number; superset: number; delta: number };
  /** "Consider unpairing …: activation reps down vs straight-set baseline" —
   *  the latest {@link SUPERSET_COST_SESSIONS} superset sessions were BOTH
   *  costly. */
  flag: boolean;
  /** How many superset sessions the flag looked at (≤ {@link SUPERSET_RECENT_SESSIONS}) —
   *  the "of your last N" the warning states. */
  recentSessions: number;
  /** Every compared session used one load: the same-load line would only
   *  repeat the averages, so it is not shown. */
  oneLoad: boolean;
}

/**
 * The report for one exercise, from completed sessions in any order. Null when
 * the exercise has no superset session yet: there is nothing to compare.
 */
export function exerciseSupersetReport(
  sessions: readonly WorkoutSession[],
  exerciseId: string,
): ExerciseSupersetReport | null {
  const occ = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .flatMap((s) => s.exercises.filter((e) => e.exerciseId === exerciseId).map((e) => occurrenceOf(s, e)));
  const sup = occ.filter((o) => o.superset);
  if (sup.length === 0) return null;
  const straight = occ.filter((o) => !o.superset).slice(0, STRAIGHT_BASELINE_SESSIONS);

  // A superset session is JUDGEABLE when a straight session in the baseline
  // used its load; only those can be costly or not.
  const baseAt = (o: ExerciseOccurrence): number | undefined => {
    if (o.load == null || o.activationRepsAvg == null) return undefined;
    const atLoad = straight.filter((b) => b.load != null && Math.abs(b.load - (o.load as number)) < 0.01 && b.activationRepsAvg != null);
    return avg(atLoad.map((b) => b.activationRepsAvg as number));
  };
  const isCostly = (o: ExerciseOccurrence) => {
    const base = baseAt(o);
    return base != null && base - (o.activationRepsAvg as number) >= SUPERSET_COST_REPS;
  };
  const costlySessions = sup.slice(0, SUPERSET_RECENT_SESSIONS).filter(isCostly).map((o) => o.date);
  const judged = sup.filter((o) => baseAt(o) != null);

  const s = side(straight);
  const p = side(sup);
  const latestLoad = sup.find((o) => o.load != null)?.load;
  const at = (xs: readonly ExerciseOccurrence[]) => avg(xs
    .filter((o) => latestLoad != null && o.load != null && Math.abs(o.load - latestLoad) < 0.01 && o.activationRepsAvg != null)
    .map((o) => o.activationRepsAvg as number));
  const sl = { straight: at(straight), superset: at(sup) };
  return {
    exerciseId,
    straight: s,
    superset: p,
    ...(latestLoad != null && sl.straight != null && sl.superset != null
      ? { sameLoad: { load: latestLoad, straight: round1(sl.straight)!, superset: round1(sl.superset)!, delta: round1(sl.superset - sl.straight)! } }
      : {}),
    delta: {
      activationReps: diff(p.activationRepsAvg, s.activationRepsAvg),
      firstMiniReps: diff(p.firstMiniRepsAvg, s.firstMiniRepsAvg),
      validityRate: p.validityRate == null || s.validityRate == null ? undefined : p.validityRate - s.validityRate,
      durationMin: diff(p.durationMinAvg, s.durationMinAvg),
    },
    costlySessions,
    // Consecutive: the newest N JUDGEABLE superset sessions, every one costly.
    // A session at a load no straight session used says nothing either way,
    // so it neither breaks the run nor extends it; a good one breaks it.
    flag: judged.length >= SUPERSET_COST_SESSIONS && judged.slice(0, SUPERSET_COST_SESSIONS).every(isCostly),
    recentSessions: Math.min(sup.length, SUPERSET_RECENT_SESSIONS),
    oneLoad: new Set([...straight, ...sup].map((o) => o.load ?? -1)).size <= 1,
  };
}

/** A session is a superset session when any exercise in it was supersetted. */
export function isSupersetSession(s: Pick<WorkoutSession, 'exercises'>): boolean {
  return s.exercises.some((e) => e.supersetGroup != null);
}

export interface SessionSupersetReport {
  durationMin?: number;
  /** The last three straight sessions of the same template. */
  straightDurationMinAvg?: number;
  straightSessions: number;
  /** Of `straightSessions`, how many have a recorded duration. */
  straightTimedSessions: number;
  durationDeltaMin?: number;
  /** One line per supersetted exercise in the session. */
  exercises: {
    exerciseId: string;
    name: string;
    label?: string;
    load?: number;
    activationRepsAvg?: number;
    firstMiniRepsAvg?: number;
    valid?: boolean;
    straightActivationRepsAvg?: number;
    /** session − straight average AT THE SAME LOAD; undefined when no
     *  straight session was at this load. */
    deltaAtLoad?: number;
    /** The exercise's report flag, as of this session. */
    flag: boolean;
  }[];
}

/**
 * The report for one superset session: its duration against the last three
 * straight sessions of the same template, and each supersetted exercise's
 * activation reps against its straight sessions at the same load. Null for a
 * session with no superset in it.
 */
export function sessionSupersetReport(
  sessions: readonly WorkoutSession[],
  session: WorkoutSession,
): SessionSupersetReport | null {
  if (!isSupersetSession(session)) return null;
  const before = sessions
    .filter((s) => s.status === 'completed' && s.date.getTime() < session.date.getTime())
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const straightSessions = before
    .filter((s) => s.templateId != null && s.templateId === session.templateId && !isSupersetSession(s))
    .slice(0, STRAIGHT_BASELINE_SESSIONS);
  const straightDur = avg(straightSessions.flatMap((s) => (s.durationMin != null ? [s.durationMin] : [])));

  const exercises = session.exercises.filter((e) => e.supersetGroup != null).map((e) => {
    const o = occurrenceOf(session, e);
    const base = before
      .flatMap((s) => s.exercises.filter((x) => x.exerciseId === e.exerciseId && x.supersetGroup == null).map((x) => occurrenceOf(s, x)))
      .slice(0, STRAIGHT_BASELINE_SESSIONS);
    const atLoad = base.filter((b) => o.load != null && b.load != null && Math.abs(b.load - o.load) < 0.01 && b.activationRepsAvg != null);
    const baseAvg = avg(atLoad.map((b) => b.activationRepsAvg as number));
    const upTo = sessions.filter((s) => s.date.getTime() <= session.date.getTime());
    return {
      exerciseId: e.exerciseId,
      name: e.name,
      ...(o.label ? { label: o.label } : {}),
      ...(o.load != null ? { load: o.load } : {}),
      activationRepsAvg: round1(o.activationRepsAvg),
      firstMiniRepsAvg: round1(o.firstMiniRepsAvg),
      ...(o.valid != null ? { valid: o.valid } : {}),
      straightActivationRepsAvg: round1(baseAvg),
      deltaAtLoad: diff(o.activationRepsAvg, baseAvg),
      flag: exerciseSupersetReport(upTo, e.exerciseId)?.flag ?? false,
    };
  });

  return {
    ...(session.durationMin != null ? { durationMin: session.durationMin } : {}),
    straightDurationMinAvg: round1(straightDur),
    straightSessions: straightSessions.length,
    straightTimedSessions: straightSessions.filter((s) => s.durationMin != null).length,
    durationDeltaMin: diff(session.durationMin, straightDur),
    exercises,
  };
}
