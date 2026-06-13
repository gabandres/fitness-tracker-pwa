/**
 * Barbell plate math — given a target total weight, what plates go on
 * each side of the bar. Pure and dependency-free (ADR-0003 sibling): the
 * greedy load algorithm and all the defaults live here, so this one
 * interface is the whole test surface.
 *
 * A barbell is loaded symmetrically, so the solver works in per-side
 * terms: `(target − bar) / 2` lb of plates on each side, filled greedily
 * from the heaviest plate down. Whatever can't be matched by a plate pair
 * (no plate small enough) surfaces as `remainder` rather than being
 * silently rounded away.
 */

/** A plate denomination and how many go on EACH side. */
export interface PlateStack {
  readonly plate: number;
  readonly count: number;
}

export interface PlateLoad {
  /** Bar weight used. */
  readonly bar: number;
  /** Per-side stacks, heaviest plate first. Empty when only the bar is
   *  needed (or the target is at/below the bar). */
  readonly perSide: readonly PlateStack[];
  /** Total actually achievable with these plates + bar — always ≤ target
   *  and ≥ bar. */
  readonly achievable: number;
  /** target − achievable, in lb (≥ 0). Non-zero when no plate pair is
   *  small enough to close the last gap. */
  readonly remainder: number;
}

/** Standard Olympic bar, lb. */
export const DEFAULT_BAR_LB = 45;
/** Common lb plate set, heaviest first. */
export const DEFAULT_PLATES_LB: readonly number[] = [45, 35, 25, 10, 5, 2.5];

/**
 * Solve the plates for a target total weight. Returns null only for a
 * non-positive target. A target at or below the bar yields an empty
 * `perSide` with `achievable = bar` (and a negative-clamped remainder of
 * 0) — i.e. "just the bar". `plates` need not be sorted; it's sorted
 * descending internally.
 */
export function computePlateLoad(
  target: number,
  bar: number = DEFAULT_BAR_LB,
  plates: readonly number[] = DEFAULT_PLATES_LB,
): PlateLoad | null {
  if (!(target > 0)) return null;

  // At/below the bar: nothing to load.
  if (target <= bar) {
    return { bar, perSide: [], achievable: bar, remainder: Math.max(0, target - bar) };
  }

  // Work in per-side lb; floats from 2.5-lb plates round-trip cleanly via
  // a fixed-point pass (×10) so 0.1-lb drift never spawns a phantom plate.
  let remainingTenths = Math.round(((target - bar) / 2) * 10);
  const sorted = [...plates].sort((a, b) => b - a);
  const perSide: PlateStack[] = [];

  for (const plate of sorted) {
    const plateTenths = Math.round(plate * 10);
    if (plateTenths <= 0) continue;
    const count = Math.floor(remainingTenths / plateTenths);
    if (count > 0) {
      perSide.push({ plate, count });
      remainingTenths -= count * plateTenths;
    }
  }

  const loadedPerSide = perSide.reduce((s, p) => s + p.plate * p.count, 0);
  const achievable = bar + loadedPerSide * 2;
  return {
    bar,
    perSide,
    achievable,
    remainder: Math.round((target - achievable) * 10) / 10,
  };
}
