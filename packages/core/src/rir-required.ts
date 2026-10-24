/**
 * RIR is REQUIRED on the last working set of a straight-set lift held to a
 * target RIR (S-v2 training, 2026-10-24).
 *
 * `setsMissingRir` (train-view.ts) asks about every blank effort set, and
 * lets the lifter "Leave blank" — the engine then reads the blank as 0. On a
 * `rir1` / `rir2` straight lift that is the one number the progression cannot
 * do without: `bindingStraight` judges the session by reps AT THE TARGET, so a
 * blank on the last (hardest) set reads as "taken to failure" and the lift
 * looks two reps worse than it was. The last working set is where effort is
 * highest and the lifter knows the answer best, so it is the one set asked
 * for outright: ticking it opens the RIR picker, and Finish will not complete
 * with it blank. Every other blank keeps the old, non-blocking question.
 *
 * Applies to: structure `straight`, effort standard `rir1` / `rir2`, log style
 * `weight-reps` or `bodyweight` (a timed hold has no reps to be short of).
 * Pure.
 */
import { DEFAULT_LOG_STYLE, isLoggedSet, type EffortStandard, type SessionExercise, type SetStructure } from './workout';
import { targetRirOf } from './progression-engine';

/** What decides whether a lift requires its last set's RIR. */
export interface RirRequirementLift {
  /** The lift's resolved structure (`structureOf`). */
  structure?: SetStructure;
  /** The catalog exercise's effort standard. */
  effortStandard?: EffortStandard;
}

/** True when the lift is one whose last working set must carry an RIR. */
export function requiresLastSetRir(
  ex: Pick<SessionExercise, 'logStyle'>,
  lift: RirRequirementLift | null | undefined,
): boolean {
  if (!lift || lift.structure !== 'straight') return false;
  if (lift.effortStandard !== 'rir1' && lift.effortStandard !== 'rir2') return false;
  return (ex.logStyle ?? DEFAULT_LOG_STYLE) !== 'time';
}

/**
 * The index of the set whose RIR is required while the lift is LIVE — the
 * last `working` set in the list — or null when the lift requires none. The
 * tick on this set opens the RIR picker when it has no RIR yet.
 */
export function lastSetRirRequired(
  ex: Pick<SessionExercise, 'sets' | 'logStyle'>,
  lift: RirRequirementLift | null | undefined,
): number | null {
  if (!requiresLastSetRir(ex, lift)) return null;
  for (let i = ex.sets.length - 1; i >= 0; i--) {
    if ((ex.sets[i].kind ?? 'working') === 'working') return i;
  }
  return null;
}

/** One lift whose last saved working set has no RIR. */
export interface RequiredRir {
  exerciseIndex: number;
  exerciseId: string;
  name: string;
  /** Index into that exercise's `sets`. */
  setIndex: number;
  /** The lift's target RIR (`targetRirOf`), what the picker leads with. */
  targetRir: number;
}

/**
 * At Finish: each requiring lift whose LAST SAVED working set (ticked, or
 * carrying a count — what the save keeps) has no RIR. The last saved one, not
 * the last in the list: a third set never done is dropped on save, and the
 * second was then the last set of the day. Blocking — Finish asks for each.
 */
export function setsRequiringRir(
  exercises: readonly Pick<SessionExercise, 'exerciseId' | 'name' | 'sets' | 'logStyle'>[],
  liftOf: (ex: Pick<SessionExercise, 'exerciseId'>, exerciseIndex: number) => RirRequirementLift | null | undefined,
): RequiredRir[] {
  const out: RequiredRir[] = [];
  exercises.forEach((ex, exerciseIndex) => {
    const lift = liftOf(ex, exerciseIndex);
    if (!requiresLastSetRir(ex, lift)) return;
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    let last = -1;
    ex.sets.forEach((s, i) => {
      if ((s.kind ?? 'working') === 'working' && (s.done || isLoggedSet(s, style))) last = i;
    });
    if (last < 0 || ex.sets[last].rir != null) return;
    out.push({ exerciseIndex, exerciseId: ex.exerciseId, name: ex.name, setIndex: last, targetRir: targetRirOf(lift?.effortStandard) });
  });
  return out;
}
