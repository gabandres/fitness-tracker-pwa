/**
 * The mid-session calibration prompt (S-v2 training, 2026-10-24).
 *
 * A lifter moved onto a new straight-set program starts each lift at a load
 * that is a guess. The engine cannot correct that guess until the session is
 * finished and read — so a first set of 15 on a 10-12 row spends the whole
 * session two sets too light, and the next session's single step barely
 * closes the gap. This asks the question while it can still help: "Set 1 was
 * 15 — raise to 25 now?", for the rest of TODAY's sets.
 *
 * It fires only on a calibration session — the engine has no read for the
 * row since its baseline (the first session in the new program) — and only
 * when set 1 overshot the top of the range by {@link CALIBRATION_OVERSHOOT}
 * reps or more. The suggested load is exactly the engine's next real step
 * (`nextLoad` with the row's own grid / `availableLoads` / increment), never
 * a jump computed from the overshoot: one step, the same one the engine would
 * have proposed next week. Pure.
 */
import { nextLoad, type RecommendOptions } from './progression-engine';
import { DEFAULT_LOG_STYLE, isTickedSet, type PlannedSet, type SessionExercise } from './workout';

/** Reps over the top of the range that set 1 must reach for the prompt. */
export const CALIBRATION_OVERSHOOT = 3;

export interface CalibrationRaise {
  /** The load to raise the remaining working sets to. */
  suggestedLoad: number;
  /** What set 1 was: its reps and its load. */
  reps: number;
  load: number;
  /** The top of the row's range the reps were judged against. */
  topReps: number;
  /** Indices (into `sessionExercise.sets`) of the remaining un-ticked working
   *  sets that are below `suggestedLoad` — what "raise" writes. */
  setIndices: number[];
}

/** The top of a straight row's rep range: the progression's `targetReps`,
 *  else the first working set's `repsMax` (else its `reps`). */
export function rowTopReps(row: {
  plannedSets?: readonly PlannedSet[];
  progression?: { targetReps?: number };
}): number | undefined {
  if (row.progression?.targetReps != null) return row.progression.targetReps;
  const first = (row.plannedSets ?? []).find((p) => p.kind === 'working') ?? row.plannedSets?.[0];
  return first?.repsMax ?? first?.reps;
}

/** True when the engine has no straight-set read in `history` — no working
 *  set with a rep count. */
function hasNoRead(history: readonly SessionExercise[]): boolean {
  return !history.some((h) => h.sets.some((s) => s.kind === 'working' && s.reps != null));
}

export function calibrationRaise(input: {
  /** The template row the exercise was started from. */
  row: { plannedSets?: readonly PlannedSet[]; progression?: { targetReps?: number } } | null | undefined;
  /** The ENGINE's history for the row — `engineHistory`, i.e. already
   *  filtered to the row's baseline. Completed sessions only. */
  history: readonly SessionExercise[];
  /** The live session's exercise. */
  sessionExercise: SessionExercise;
  /** The options the engine reads the row with (`recommendOptionsFor`). */
  opts: Pick<RecommendOptions, 'structure' | 'availableLoads' | 'assisted' | 'progression' | 'config'>;
}): CalibrationRaise | null {
  const { row, history, sessionExercise: ex, opts } = input;
  if (!row || opts.structure !== 'straight') return null;
  // Assistance runs the other way (a "raise" is less help) — not this prompt.
  if (opts.assisted) return null;
  if ((ex.logStyle ?? DEFAULT_LOG_STYLE) !== 'weight-reps') return null;
  if (!hasNoRead(history)) return null;
  const top = rowTopReps(row);
  if (top == null) return null;

  const firstIdx = ex.sets.findIndex((s) => s.kind === 'working');
  if (firstIdx < 0) return null;
  const first = ex.sets[firstIdx];
  // Ticked, not typed: a 1 on the way to 15 must not raise anything.
  if (!isTickedSet(first, 'weight-reps') || first.reps == null) return null;
  const load = first.weight;
  if (load == null || !(load > 0)) return null;
  if (first.reps < top + CALIBRATION_OVERSHOOT) return null;

  const grid = opts.config?.loadGrid;
  const { load: suggestedLoad } = nextLoad(load, {
    availableLoads: opts.availableLoads,
    incrementLb: opts.progression?.incrementLb,
    ...(grid ? { grid } : {}),
  });
  if (!(suggestedLoad > load)) return null;

  const setIndices: number[] = [];
  ex.sets.forEach((s, i) => {
    if (i <= firstIdx || s.kind !== 'working' || s.done === true) return;
    if (s.weight != null && s.weight >= suggestedLoad) return;
    setIndices.push(i);
  });
  // Nothing left to raise — the lift is done, or already raised by hand.
  if (setIndices.length === 0) return null;
  return { suggestedLoad, reps: first.reps, load, topReps: top, setIndices };
}
