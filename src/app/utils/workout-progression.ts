// Pure progression + PR math for the Train tab. No Angular, no I/O —
// mirrors the day-summary.ts pure-module convention so the rules are
// unit-testable in isolation (see ADR-0003).

import type { LogStyle, ProgressionRule, SessionExercise, WorkoutSet } from '../models/workout';
import { DEFAULT_LOG_STYLE } from '../models/workout';

/** Sets that count toward progression/PRs. Warmups are excluded; drops
 *  are back-off sets that shouldn't define a top-set PR either. */
export function isWorkingSet(set: WorkoutSet): boolean {
  return set.kind !== 'warmup' && set.kind !== 'drop';
}

/** Whether a set has the metric its logStyle measures: a duration for
 *  `time`, reps for `bodyweight`, both weight + reps for `weight-reps`. */
function hasMetric(s: WorkoutSet, style: LogStyle): boolean {
  if (style === 'time') return s.durationSec != null;
  if (style === 'bodyweight') return s.reps != null;
  return s.weight != null && s.reps != null;
}

/** The set a progression rule keys off: the first working/activation set
 *  with the logStyle's metric recorded. Returns null if none logged. */
export function keySet(
  exercise: SessionExercise,
  style: LogStyle = exercise.logStyle ?? DEFAULT_LOG_STYLE,
): WorkoutSet | null {
  return exercise.sets.find((s) => isWorkingSet(s) && hasMetric(s, style)) ?? null;
}

/** Epley estimated one-rep max. Returns 0 when inputs are missing. */
export function estimateOneRepMax(weight?: number, reps?: number): number {
  if (weight == null || reps == null || weight <= 0 || reps <= 0) return 0;
  return +(weight * (1 + reps / 30)).toFixed(1);
}

export interface ProgressionSuggestion {
  /** Key-set metrics from the most recent session, for ghost placeholders
   *  ("last: 50×9", "last: 9 reps", "last: 60s"). Undefined when no
   *  history / not applicable to the logStyle. */
  lastWeight?: number;
  lastReps?: number;
  lastDurationSec?: number;
  /** Key-set RIR from the most recent session, for ghost display. */
  lastRir?: number;
  /** What load to attempt next (weight-reps only). Equals lastWeight unless
   *  the threshold is met, in which case it's lastWeight + rule.incrementLb. */
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
  style: LogStyle = history[0]?.logStyle ?? DEFAULT_LOG_STYLE,
): ProgressionSuggestion {
  const last = history[0] ? keySet(history[0], style) : null;
  const lastWeight = last?.weight;
  const lastReps = last?.reps;
  const lastDurationSec = last?.durationSec;
  const lastRir = last?.rir;

  // Deterministic load-bump applies to weight-reps only; bodyweight/time
  // just surface the last result (no auto-bump).
  if (style !== 'weight-reps' || !rule || lastWeight == null || history.length < rule.holdSessions) {
    return { lastWeight, lastReps, lastDurationSec, lastRir, suggestedWeight: lastWeight, bumped: false };
  }

  const recent = history.slice(0, rule.holdSessions).map((h) => keySet(h, style));
  const heldThreshold = recent.every(
    (k) => k != null && k.reps != null && k.reps >= rule.targetReps && (k.weight ?? 0) >= lastWeight,
  );

  return {
    lastWeight,
    lastReps,
    lastDurationSec,
    lastRir,
    suggestedWeight: heldThreshold ? +(lastWeight + rule.incrementLb).toFixed(2) : lastWeight,
    bumped: heldThreshold,
  };
}

export interface ExercisePRs {
  /** Heaviest weight lifted on any working set. */
  maxWeight: number;
  /** Best Epley estimated 1RM across all working sets. */
  bestE1RM: number;
  /** Most reps in any working set (the PR metric for `bodyweight`). */
  maxReps: number;
  /** Longest hold in seconds (the PR metric for `time`). */
  maxDurationSec: number;
}

/** Best-ever PRs for one exercise across the supplied sessions. Pass the
 *  SessionExercise rows for a single exerciseId; warmups/drops ignored.
 *  Computes every metric; callers pick the one matching the logStyle. */
export function computeExercisePRs(rows: SessionExercise[]): ExercisePRs {
  let maxWeight = 0;
  let bestE1RM = 0;
  let maxReps = 0;
  let maxDurationSec = 0;
  for (const ex of rows) {
    for (const s of ex.sets) {
      if (!isWorkingSet(s)) continue;
      if (s.weight != null && s.weight > maxWeight) maxWeight = s.weight;
      if (s.weight != null) {
        const e1rm = estimateOneRepMax(s.weight, s.reps);
        if (e1rm > bestE1RM) bestE1RM = e1rm;
      }
      if (s.reps != null && s.reps > maxReps) maxReps = s.reps;
      if (s.durationSec != null && s.durationSec > maxDurationSec) maxDurationSec = s.durationSec;
    }
  }
  return { maxWeight, bestE1RM, maxReps, maxDurationSec };
}
