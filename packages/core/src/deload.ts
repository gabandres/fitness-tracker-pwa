/**
 * Deloads on a trigger, never on a schedule (Program v2.1, 2026-10-15).
 *
 * ## The trigger
 *
 * "Consider a deload week" is offered when at least
 * {@link DELOAD_TRIGGER_LIFTS} lifts have their activation reps down by
 * {@link DELOAD_REPS_DOWN} or more, at the SAME load, for two consecutive
 * sessions — against the session before those two. Only reads the
 * progression engine itself would compare count (`engineSessions`: nothing
 * before a row's baseline, nothing on an excluded day), so a lift that moved
 * position or into a superset is not "down" because its context changed. A
 * deload session never counts, and nothing before the last deload started
 * does either: the week that answered a slump does not re-open it.
 *
 * ## The deload
 *
 * One rotation — every template in the program once — at the same loads,
 * with each lift's clusters halved (never under one), activation stopping 3
 * reps short (RIR {@link DELOAD_RIR}). Zone 2 is unchanged. Each deload
 * session carries `deload: true`, which the engine skips, so the next
 * normal session is read against the one before the deload. Once every
 * template has a deload session the program resumes on its own.
 *
 * Pure; no I/O.
 */
import { calendarDateKey } from './date';
import { engineSessions } from './train-view';
import type { SessionExercise, TemplateExercise, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';

export const DELOAD_TRIGGER_LIFTS = 2;
export const DELOAD_REPS_DOWN = 2;
/** The RIR a deload activation stops at. */
export const DELOAD_RIR = 3;
/** A deload not finished in this many days lapses, so a skipped template can
 *  never leave the program stuck in one. */
export const DELOAD_MAX_DAYS = 14;

/** One lift that is down: its reference read and the two that followed. */
export interface DeloadLift {
  exerciseId: string;
  name: string;
  load: number;
  /** Lowest activation reps, oldest first: [reference, then, now]. */
  reps: [number, number, number];
}

export interface DeloadSignal {
  triggered: boolean;
  lifts: DeloadLift[];
}

/** A session's read of one lift for the trigger: its one load and its lowest
 *  activation reps. Undefined when there is no activation with reps, or the
 *  activations disagree on the load (that is not "the same load"). An L/R
 *  lift is read one side at a time (`side`): each side is its own track, at
 *  its own load (Program v2 side tracks). */
function activationRead(ex: SessionExercise, side?: 'L' | 'R'): { load: number; reps: number } | undefined {
  const acts = ex.sets.filter((s) => s.kind === 'activation' && s.reps != null && (side == null || s.label === side));
  if (acts.length === 0) return undefined;
  const loads = new Set(acts.map((s) => s.weight ?? 0));
  if (loads.size !== 1) return undefined;
  return { load: [...loads][0], reps: Math.min(...acts.map((s) => s.reps as number)) };
}

/**
 * Whether to offer a deload. `sessions` in any order; only completed,
 * non-deload sessions on or after `since` (the last deload's start) are read.
 */
export function deloadSignal(input: {
  templates: readonly Pick<WorkoutTemplate, 'exercises'>[];
  sessions: readonly WorkoutSession[];
  since?: Date;
}): DeloadSignal {
  const sinceKey = input.since ? calendarDateKey(input.since) : undefined;
  const pool = input.sessions
    .filter((s) => s.status === 'completed' && !s.deload && (!sinceKey || calendarDateKey(s.date) >= sinceKey))
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const seen = new Set<string>();
  const lifts: DeloadLift[] = [];
  for (const t of input.templates) {
    for (const row of t.exercises) {
      if (seen.has(row.exerciseId)) continue;
      seen.add(row.exerciseId);
      const down = liftDown(row, pool);
      if (down) lifts.push(down);
    }
  }
  return { triggered: lifts.length >= DELOAD_TRIGGER_LIFTS, lifts };
}

function liftDown(row: TemplateExercise, newestFirst: readonly WorkoutSession[]): DeloadLift | undefined {
  // The three newest sessions the engine would compare, CONSECUTIVE: an
  // unreadable one (mixed loads, no reps) breaks the run rather than being
  // stepped over — "two sessions running" means the two that happened.
  const recent: SessionExercise[] = [];
  for (const s of engineSessions(newestFirst, row)) {
    const ex = s.exercises.find((e) => e.exerciseId === row.exerciseId);
    if (ex && ex.sets.some((x) => x.kind === 'activation')) recent.push(ex);
    if (recent.length === 3) break;
  }
  if (recent.length < 3) return undefined;
  const sided = recent.some((ex) => ex.sets.some((x) => x.kind === 'activation' && (x.label === 'L' || x.label === 'R')));
  for (const side of sided ? (['L', 'R'] as const) : [undefined]) {
    const reads = recent.map((ex) => activationRead(ex, side));
    if (reads.some((r) => r == null)) continue;
    const [now, then, ref] = reads as { load: number; reps: number }[];
    if (now.load !== ref.load || then.load !== ref.load) continue;
    if (then.reps > ref.reps - DELOAD_REPS_DOWN || now.reps > ref.reps - DELOAD_REPS_DOWN) continue;
    return { exerciseId: row.exerciseId, name: side ? `${row.name} (${side})` : row.name, load: ref.load, reps: [ref.reps, then.reps, now.reps] };
  }
  return undefined;
}

// ─── The deload week ────────────────────────────────────────────

export interface DeloadProgress {
  active: boolean;
  /** Templates that still need their deload session, in program order. */
  remaining: string[];
  done: string[];
}

/**
 * Where an accepted deload stands. It is active from `startedAt` until every
 * template in `templateIds` has a completed deload session on or after it,
 * or {@link DELOAD_MAX_DAYS} pass.
 */
export function deloadProgress(input: {
  startedAt?: Date;
  templateIds: readonly string[];
  sessions: readonly Pick<WorkoutSession, 'status' | 'deload' | 'date' | 'templateId'>[];
  now: Date;
}): DeloadProgress {
  const { startedAt } = input;
  if (!startedAt || input.templateIds.length === 0) return { active: false, remaining: [], done: [] };
  const lapsed = input.now.getTime() - startedAt.getTime() > DELOAD_MAX_DAYS * 86_400_000;
  const startKey = calendarDateKey(startedAt);
  const doneSet = new Set(
    input.sessions
      .filter((s) => s.status === 'completed' && s.deload && s.templateId && calendarDateKey(s.date) >= startKey)
      .map((s) => s.templateId as string),
  );
  const done = input.templateIds.filter((id) => doneSet.has(id));
  const remaining = input.templateIds.filter((id) => !doneSet.has(id));
  return { active: !lapsed && remaining.length > 0, remaining, done };
}

/**
 * A template's session exercises as a deload runs them: the same loads, each
 * lift's clusters halved (rounded down, never under one), activation targets
 * 3 reps lower. An L/R pair is ONE cluster here, as it is for volume, so a
 * single-leg lift keeps both legs. A drop set goes with its cluster; warm-ups
 * and mobility stay. Straight working sets are halved the same way.
 */
export function deloadSessionExercises(exercises: readonly SessionExercise[]): SessionExercise[] {
  return exercises.map((ex) => ({ ...ex, sets: deloadSets(ex.sets) }));
}

function deloadSets(sets: readonly WorkoutSet[]): WorkoutSet[] {
  const isEffort = (s: WorkoutSet) => s.kind !== 'warmup' && s.kind !== 'mobility';
  const clustered = sets.some((s) => s.kind === 'activation');
  if (!clustered) {
    const working = sets.filter((s) => s.kind === 'working');
    const keepN = Math.max(1, Math.floor(working.length / 2));
    let seen = 0;
    return sets.filter((s) => {
      if (s.kind !== 'working') return s.kind !== 'drop' || seen <= keepN;
      seen += 1;
      return seen <= keepN;
    });
  }
  // Each effort set's cluster. A saved template strips `group` from a drop
  // or working set (the editor's `normalizeClusterGroups`), so an ungrouped
  // effort set belongs to the cluster before it — a drop on the last cluster
  // goes when that cluster goes.
  let current = 1;
  const groupOf = sets.map((s) => {
    if (!isEffort(s)) return undefined;
    if (s.group != null) current = s.group;
    return current;
  });
  const groups: number[] = [];
  groupOf.forEach((g) => {
    if (g != null && !groups.includes(g)) groups.push(g);
  });
  const sideOf = (g: number) => sets.find((s, i) => groupOf[i] === g && s.kind === 'activation')?.label;
  // Units: an L/R lift's i-th L cluster and i-th R cluster are ONE unit,
  // whatever order the sides run in (L R L R, or L L R R), so a halved
  // single-leg lift always keeps both legs.
  const ls = groups.filter((g) => sideOf(g) === 'L');
  const rs = groups.filter((g) => sideOf(g) === 'R');
  const units: number[][] = [];
  if (ls.length > 0 && ls.length === rs.length) {
    ls.forEach((g, i) => units.push([g, rs[i]]));
    groups.filter((g) => !ls.includes(g) && !rs.includes(g)).forEach((g) => units.push([g]));
  } else {
    groups.forEach((g) => units.push([g]));
  }
  const keep = new Set(units.slice(0, Math.max(1, Math.floor(units.length / 2))).flat());
  return sets
    .filter((s, i) => groupOf[i] == null || keep.has(groupOf[i] as number))
    .map((s) => (s.kind === 'activation' && s.targetReps != null ? { ...s, targetReps: Math.max(1, s.targetReps - DELOAD_RIR) } : s));
}
