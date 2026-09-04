import type { SetKind } from './workout';

/** The two rest lengths a template prescribes, seconds. */
export interface RestSeconds {
  /** Between mini-sets and between straight sets (`WorkoutTemplate.restMiniSec`,
   *  or the exercise's own `TemplateExercise.restMiniSec` when it has one). */
  mini: number;
  /** Between clusters and between exercises (`WorkoutTemplate.restClusterSec`). */
  cluster: number;
}

/**
 * Rest before a `drop` set: only as long as it takes to change the weight.
 *
 * A drop set is not a new effort, it is the SAME effort continued at a lower
 * load — the stimulus is the absence of recovery. Resting the intra-cluster
 * 15-20 s into it makes it an ordinary back-off set, which is a different
 * exercise wearing the same name. Deliberately not configurable: there is no
 * training reason to want a long rest here, and a field for it would only be
 * a way to get it wrong.
 */
export const REST_INTO_DROP_SEC = 10;

/**
 * Which rest follows the set at `index`.
 *
 * The rest between two sets belongs to the set that is COMING, not the one just
 * finished: inside a cluster (activation → mini → mini) every gap is the short
 * intra-cluster rest, and the long one comes after the cluster's LAST mini,
 * before the next activation or the next exercise. The timer keyed on the
 * finished set's kind until 2026-09-01, which ran the long rest right after the
 * activation set and the short one after the final mini — the exact inverse of
 * the protocol the template notes describe ("~20 s between mini-sets, 2–3 min
 * between clusters") — and gave straight sets the cluster rest, which is not
 * what the field's own label ("Rest: sets") or its doc comment says.
 *
 * So: the long rest when the next set opens a new cluster (`activation`) or
 * there is no next set in this exercise; the short rest otherwise.
 *
 * The one exception is a `drop` coming next, which takes
 * {@link REST_INTO_DROP_SEC} regardless of either template value — see that
 * constant for why. It is checked FIRST because a drop is the last set of its
 * exercise in practice, and the `!next` branch would otherwise never be
 * reached for it anyway; ordering it here makes the rule independent of where
 * the drop happens to sit.
 */
export function restAfterSet(
  sets: readonly { kind: SetKind }[],
  index: number,
  rest: RestSeconds,
): number {
  const next = sets[index + 1];
  if (next?.kind === 'drop') return REST_INTO_DROP_SEC;
  if (!next || next.kind === 'activation') return rest.cluster;
  return rest.mini;
}
