// Pure progression + PR math for the Train tab. No Angular, no I/O —
// mirrors the day-summary.ts pure-module convention so the rules are
// unit-testable in isolation (see ADR-0003).

import type { ProgressionRule, SessionExercise, WorkoutSet } from '../models/workout';

/** Sets that count toward progression/PRs. Warmups are excluded; drops
 *  are back-off sets that shouldn't define a top-set PR either. */
export function isWorkingSet(set: WorkoutSet): boolean {
  return set.kind !== 'warmup' && set.kind !== 'drop';
}

/** The set a progression rule keys off: the first working/activation set
 *  with both a weight and reps recorded. Returns null if none logged. */
export function keySet(exercise: SessionExercise): WorkoutSet | null {
  return (
    exercise.sets.find(
      (s) => isWorkingSet(s) && s.weight != null && s.reps != null,
    ) ?? null
  );
}

/** Epley estimated one-rep max. Returns 0 when inputs are missing. */
export function estimateOneRepMax(weight?: number, reps?: number): number {
  if (weight == null || reps == null || weight <= 0 || reps <= 0) return 0;
  return +(weight * (1 + reps / 30)).toFixed(1);
}

export interface ProgressionSuggestion {
  /** Key-set weight/reps from the most recent session, for ghost
   *  placeholders ("last: 50×9"). Undefined when no history. */
  lastWeight?: number;
  lastReps?: number;
  /** What to attempt next. Equals lastWeight unless the threshold is
   *  met, in which case it's lastWeight + rule.incrementLb. */
  suggestedWeight?: number;
  /** True when the double-progression threshold was met this cycle. */
  bumped: boolean;
}

/**
 * Deterministic double-progression. `history` is the SAME exercise across
 * recent COMPLETED sessions, most-recent-first. Without a rule (or with
 * too little history) it just surfaces the last key set. With a rule, it
 * bumps the load when the key set hit `targetReps` for `holdSessions`
 * consecutive sessions at a non-decreasing weight.
 */
export function suggestProgression(
  history: SessionExercise[],
  rule?: ProgressionRule,
): ProgressionSuggestion {
  const last = history[0] ? keySet(history[0]) : null;
  const lastWeight = last?.weight;
  const lastReps = last?.reps;

  if (!rule || lastWeight == null || history.length < rule.holdSessions) {
    return { lastWeight, lastReps, suggestedWeight: lastWeight, bumped: false };
  }

  const recent = history.slice(0, rule.holdSessions).map(keySet);
  const heldThreshold = recent.every(
    (k) => k != null && k.reps != null && k.reps >= rule.targetReps && (k.weight ?? 0) >= lastWeight,
  );

  return {
    lastWeight,
    lastReps,
    suggestedWeight: heldThreshold ? +(lastWeight + rule.incrementLb).toFixed(2) : lastWeight,
    bumped: heldThreshold,
  };
}

export interface ExercisePRs {
  /** Heaviest weight lifted on any working set. */
  maxWeight: number;
  /** Best Epley estimated 1RM across all working sets. */
  bestE1RM: number;
}

/** Best-ever PRs for one exercise across the supplied sessions. Pass the
 *  SessionExercise rows for a single exerciseId; warmups/drops ignored. */
export function computeExercisePRs(rows: SessionExercise[]): ExercisePRs {
  let maxWeight = 0;
  let bestE1RM = 0;
  for (const ex of rows) {
    for (const s of ex.sets) {
      if (!isWorkingSet(s) || s.weight == null) continue;
      if (s.weight > maxWeight) maxWeight = s.weight;
      const e1rm = estimateOneRepMax(s.weight, s.reps);
      if (e1rm > bestE1RM) bestE1RM = e1rm;
    }
  }
  return { maxWeight, bestE1RM };
}
