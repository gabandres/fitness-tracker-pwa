/**
 * "Gym busy" (owner, 2026-11-10): when the machines a superset needs are
 * taken, the lifter does what is free, in any order. The 11/10 Haven 1 ran its
 * blocks out of order and every block was still completed.
 *
 * Nothing about out-of-order work needs crediting here: a superset block is
 * complete when its members' sets are logged, whatever the order (volume,
 * the engine and the superset report read the sets, not the sequence). This
 * module only builds the list the toggle shows — every lift with sets left,
 * and how long its muscle has rested.
 *
 * The rest hint: the same muscle's next cluster wants at least
 * {@link GYM_BUSY_MUSCLE_REST_SEC} since that muscle last worked — read from
 * `WorkoutSet.loggedAt` across every lift whose PRIMARY muscle tag is the same
 * (a pec deck right after a flat press waits; a leg curl does not).
 */
import { DEFAULT_LOG_STYLE, isLoggedSet, type MuscleGroup, type SessionExercise } from './workout';
import { supersetLabel } from './superset';

export const GYM_BUSY_MUSCLE_REST_SEC = 90;

export interface GymBusyRow {
  exerciseIndex: number;
  name: string;
  /** "B2" inside a superset. */
  tag?: string;
  done: number;
  total: number;
  /** The primary muscle tag, when the catalog has one. */
  muscle?: MuscleGroup;
  /** Seconds since that muscle last worked, when it has this session. */
  restedSec?: number;
  /** Seconds still to wait for {@link GYM_BUSY_MUSCLE_REST_SEC}; 0 = ready. */
  waitSec: number;
}

const loggedAtMs = (v: unknown): number | undefined => {
  if (v == null) return undefined;
  const ms = new Date(v as string).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

/** Every lift with a set left, in session order, with its muscle's rest. */
export function gymBusyRows(
  exercises: readonly SessionExercise[],
  musclesOf: (exerciseId: string) => readonly MuscleGroup[] | undefined,
  now: Date,
): GymBusyRow[] {
  const primary = exercises.map((ex) => musclesOf(ex.exerciseId)?.[0]);
  // The last time each primary muscle worked.
  const lastWorked = new Map<MuscleGroup, number>();
  exercises.forEach((ex, i) => {
    const m = primary[i];
    if (!m) return;
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    for (const s of ex.sets) {
      const ms = isLoggedSet(s, style) ? loggedAtMs(s.loggedAt) : undefined;
      if (ms != null && ms > (lastWorked.get(m) ?? -Infinity)) lastWorked.set(m, ms);
    }
  });
  const rows: GymBusyRow[] = [];
  exercises.forEach((ex, exerciseIndex) => {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    const total = ex.sets.length;
    const done = ex.sets.filter((s) => isLoggedSet(s, style)).length;
    if (total === 0 || done >= total) return;
    const muscle = primary[exerciseIndex];
    const last = muscle ? lastWorked.get(muscle) : undefined;
    const restedSec = last != null ? Math.max(0, Math.floor((now.getTime() - last) / 1000)) : undefined;
    const tag = supersetLabel(ex);
    rows.push({
      exerciseIndex,
      name: ex.name,
      ...(tag ? { tag } : {}),
      done,
      total,
      ...(muscle ? { muscle } : {}),
      ...(restedSec != null ? { restedSec } : {}),
      waitSec: restedSec != null ? Math.max(0, GYM_BUSY_MUSCLE_REST_SEC - restedSec) : 0,
    });
  });
  return rows;
}
