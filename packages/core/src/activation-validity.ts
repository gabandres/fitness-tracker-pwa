/**
 * Whether an activation set's rep count is a VALID progression read.
 *
 * ## Why this is not just "check the RIR"
 *
 * In cluster / myo-rep training the activation set is defined by its
 * proximity to failure: one set stopped a couple of reps short, then
 * short-rest mini-sets. The rep count only means anything *given* that
 * stopping point. Twelve reps at RIR 1 and twelve reps at RIR 5 are not two
 * observations of the same quantity, and comparing them across sessions — which
 * is exactly what double progression does — compares a lift against a
 * different lift wearing the same name.
 *
 * So a load recommendation built on an out-of-band activation is not a weak
 * recommendation, it is an unfounded one. The app should not make it.
 *
 * ## Why the band is 1-3, and why it stops at `activation`
 *
 * Trainees systematically UNDER-predict how many reps they have left: Steele
 * 2017 (n=141) puts the error at 1-2 reps, Halperin's review (12 studies, 414
 * participants) at ~1, Refalo 2024 at 0.65 ± 0.78. A called RIR 3 is plausibly
 * a true RIR 4, which is the edge of where proximity to failure still drives
 * hypertrophy. Past that the set is not a stimulus the next session can be
 * measured against.
 *
 * **This band applies to `activation` sets ONLY, and that boundary is
 * load-bearing.** A plain `working` set carries no protocol-defined stopping
 * point: taking a straight set to failure (RIR 0) is ordinary training, and
 * hitting the rep target with reps to spare (RIR 5) is precisely when double
 * progression SHOULD add load. Applying the band there would invert the rule
 * and block progression for every straight-set user in the app. The band is a
 * property of the cluster protocol, not of lifting.
 *
 * ## Missing RIR is flagged but does not block
 *
 * Absence of a measurement is not a measurement. Most users log no RIR at all;
 * treating that as invalidity would silently switch progression off for them.
 * It is surfaced in the session summary — where it reads as "we cannot judge
 * this" — and left out of {@link blocksProgression}.
 */
import type { LogStyle, SessionExercise, WorkoutSet } from './workout';
import { DEFAULT_LOG_STYLE } from './workout';

/** The RIR band an `activation` set must land in for its reps to be readable. */
export const ACTIVATION_RIR_MIN = 1;
export const ACTIVATION_RIR_MAX = 3;

export type ActivationIssue =
  /** No RIR recorded — unjudgeable, but not evidence of a bad set. */
  | 'rir-missing'
  /** RIR 0: the activation was taken to failure, so the minis that follow it
   *  are not the protocol's minis and the rep count cannot be repeated. */
  | 'rir-to-failure'
  /** RIR above {@link ACTIVATION_RIR_MAX}: not proximate to failure, so the
   *  rep count is not comparable to the sessions it would be measured against. */
  | 'rir-too-easy'
  /** The template prescribes a cluster and the session logged straight sets,
   *  so there is no activation set to read at all. */
  | 'not-clustered';

/** True when the issue is EVIDENCE the set is invalid, rather than absence of
 *  evidence. Only these block a load recommendation. */
export function blocksProgression(issue: ActivationIssue | null | undefined): boolean {
  return issue === 'rir-to-failure' || issue === 'rir-too-easy';
}

/**
 * The issue with this exercise's activation read, or `null` when it is clean.
 *
 * `expectsCluster` comes from the TEMPLATE (does it prescribe an `activation`
 * set?) and is what makes `not-clustered` detectable — a session that logged
 * straight sets has no activation to inspect, so the defect is only visible
 * against the prescription. Omit it and that check is skipped.
 *
 * Reports the FIRST out-of-band activation, so a two-cluster lift whose second
 * activation collapsed is caught rather than masked by a clean first one.
 */
export function activationIssue(
  exercise: Pick<SessionExercise, 'sets' | 'logStyle'>,
  opts?: { expectsCluster?: boolean },
): ActivationIssue | null {
  const style: LogStyle = exercise.logStyle ?? DEFAULT_LOG_STYLE;
  const activations = exercise.sets.filter((s) => s.kind === 'activation');

  const logged = (s: WorkoutSet) => (style === 'time' ? s.durationSec != null : s.reps != null);

  if (activations.length === 0) {
    // Only a defect when the template asked for a cluster AND something was
    // actually performed. An exercise that is straight sets by design is not
    // "missing" anything, and an untouched scaffold has not happened yet.
    return opts?.expectsCluster && exercise.sets.some(logged) ? 'not-clustered' : null;
  }

  // Only judge activations that were actually performed — an untouched
  // scaffold row is not a bad set, it is a set that has not happened yet.
  const performed = activations.filter(logged);
  if (performed.length === 0) return null;

  // EVERY performed activation is inspected, not just the first: the failure
  // this exists to catch is a two-cluster lift whose C1 looks fine and whose
  // C2 collapsed. Out-of-band beats missing, so the loop runs to completion
  // before the `rir-missing` fallback below.
  for (const s of performed) {
    if (s.rir == null) continue;
    if (s.rir < ACTIVATION_RIR_MIN) return 'rir-to-failure';
    if (s.rir > ACTIVATION_RIR_MAX) return 'rir-too-easy';
  }
  if (performed.some((s) => s.rir == null)) return 'rir-missing';
  return null;
}

export interface ActivationFinding {
  exerciseId: string;
  name: string;
  issue: ActivationIssue;
}

/**
 * Every unreadable activation in a session — what the session summary lists.
 *
 * `expectsCluster` is looked up per exercise id so `not-clustered` can be
 * reported; pass the template the session was started from. Pure and
 * order-preserving: the report reads in the order the workout was performed.
 */
export function sessionActivationIssues(
  exercises: readonly SessionExercise[],
  template?: { exercises: readonly { exerciseId: string; plannedSets: readonly { kind: string }[] }[] } | null,
): ActivationFinding[] {
  const clustered = new Set(
    (template?.exercises ?? [])
      .filter((e) => e.plannedSets.some((p) => p.kind === 'activation'))
      .map((e) => e.exerciseId),
  );
  const out: ActivationFinding[] = [];
  for (const ex of exercises) {
    const issue = activationIssue(ex, { expectsCluster: clustered.has(ex.exerciseId) });
    if (issue) out.push({ exerciseId: ex.exerciseId, name: ex.name, issue });
  }
  return out;
}
