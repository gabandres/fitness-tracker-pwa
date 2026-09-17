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
 * Rest before a `continuation` set: the short intra-block pause, not a real rest.
 *
 * A `continuation` is the prescribed second half of an activation — rest-pause
 * ("activation to failure, SHORT rest, continue to failure") and cluster
 * ("prescribed reps per mini-block with INTRA-SET rest"). Both structures are
 * defined by the shortness of this gap: rest the between-sets value into one and
 * the continuation stops being a continuation and becomes an ordinary second
 * set, which is the same failure {@link REST_INTO_DROP_SEC} exists to prevent
 * for drops. `progression-engine.ts` already states the intent — "a rest-pause
 * continuation is SUPPOSED to be short".
 *
 * Not configurable, for the same reason as the drop constant: the template's two
 * knobs are "between sets" and "between clusters", and neither is this. A third
 * field would only be a way to set it wrong.
 *
 * ADR-0040 added the `continuation` kind on 2026-09-16 without teaching this
 * function about it, so both structures fell through to `rest.mini` — the
 * between-STRAIGHT-sets rest — and shipped that way in OTA `478e00b4`.
 */
export const REST_INTO_CONTINUATION_SEC = 20;

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
 * Two kinds coming next override both template values, and both are checked
 * FIRST so the rule stays independent of where in the list they sit: a `drop`
 * takes {@link REST_INTO_DROP_SEC} and a `continuation` takes
 * {@link REST_INTO_CONTINUATION_SEC} — see those constants for why. (A drop is
 * the last set of its exercise in practice, so the `!next` branch would never
 * be reached for it anyway.)
 */
export function restAfterSet(
  sets: readonly { kind: SetKind }[],
  index: number,
  rest: RestSeconds,
): number {
  const next = sets[index + 1];
  if (next?.kind === 'drop') return REST_INTO_DROP_SEC;
  if (next?.kind === 'continuation') return REST_INTO_CONTINUATION_SEC;
  if (!next || next.kind === 'activation') return rest.cluster;
  return rest.mini;
}
