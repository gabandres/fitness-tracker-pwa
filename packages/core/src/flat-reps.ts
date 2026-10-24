/**
 * The flat-reps warning (S-v2 training, 2026-10-24).
 *
 * A straight-set lift logged 12, 12, 12 with no RIR, two sessions running, is
 * the signature of sets typed (or ticked through) rather than measured — or
 * of sets stopped well short of the target effort. Either way the engine's
 * read is fiction: a blank RIR reads as 0, so "12 × 3 at RIR 0" holds a
 * 12-rep target on a `rir2` lift only by luck. The warning asks the question
 * at the top of the card, before the next set: "Same reps on every set, no
 * RIR, 2 sessions running — are these sets close to RIR 2?". Pure.
 */
import type { SetStructure, WorkoutSession } from './workout';

/** Completed sessions running that must show the pattern. */
export const FLAT_REPS_SESSIONS = 2;
/** Working sets a session must have logged for "every set" to mean anything. */
export const FLAT_REPS_MIN_SETS = 2;

export interface FlatRepsWarning {
  /** Sessions read, newest first. */
  sessions: number;
  /** The one rep count of each of those sessions, newest first. */
  reps: number[];
}

/**
 * The warning for one lift, or null. Reads the last {@link FLAT_REPS_SESSIONS}
 * COMPLETED, non-deload sessions that carry the lift (newest first, whatever
 * order they arrive in). Fires when each logged ≥ {@link FLAT_REPS_MIN_SETS}
 * working sets, every one at the same rep count, and not one with an RIR.
 * Straight lifts only — a cluster's minis are meant to differ.
 */
export function flatRepsWarning(
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'exercises' | 'deload'>[],
  exerciseId: string,
  structure: SetStructure | undefined,
): FlatRepsWarning | null {
  if (structure !== 'straight') return null;
  const recent = sessions
    .filter((s) => s.status === 'completed' && !s.deload && s.exercises.some((e) => e.exerciseId === exerciseId))
    .slice()
    .sort((a, b) => b.date.getTime() - a.date.getTime())
    .slice(0, FLAT_REPS_SESSIONS);
  if (recent.length < FLAT_REPS_SESSIONS) return null;
  const reps: number[] = [];
  for (const s of recent) {
    const ex = s.exercises.find((e) => e.exerciseId === exerciseId);
    const working = (ex?.sets ?? []).filter((x) => (x.kind ?? 'working') === 'working' && x.reps != null);
    if (working.length < FLAT_REPS_MIN_SETS) return null;
    if (working.some((x) => x.rir != null)) return null;
    const first = working[0].reps as number;
    if (working.some((x) => x.reps !== first)) return null;
    reps.push(first);
  }
  return { sessions: recent.length, reps };
}
