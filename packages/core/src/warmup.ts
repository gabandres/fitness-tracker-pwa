import { computePlateLoad, DEFAULT_BAR_LB, DEFAULT_PLATES_LB } from './plate-math';

/**
 * Warmup ramp generator — given a working weight, the warmup sets that
 * lead up to it (empty bar, then ~50/70/90%). Pure and dependency-free
 * (ADR-0003 sibling); reuses {@link computePlateLoad} so every ramp
 * weight is actually loadable on the same bar/plate set rather than an
 * un-rackable number like 117.5. Shared by both apps (ADR-0012).
 *
 * The ramp rounds each percentage DOWN to the nearest achievable load
 * (warmups err light, never heavier than intended) and drops any step
 * that would collide with the bar, a prior step, or the working weight —
 * so a light working weight yields a short ramp, not three near-identical
 * sets.
 */

export interface WarmupSet {
  /** Loadable total weight (lb), already rounded to the plate set. */
  readonly weight: number;
  readonly reps: number;
  /** Fraction of working weight this step approximates (0.5/0.7/0.9), or
   *  null for the empty-bar set. */
  readonly pct: number | null;
}

/** Ramp stops: lighter = more reps. Tuned for strength work, not a
 *  scientific protocol — just enough to grease the groove. */
const RAMP: readonly { pct: number; reps: number }[] = [
  { pct: 0.5, reps: 5 },
  { pct: 0.7, reps: 3 },
  { pct: 0.9, reps: 2 },
];

/**
 * Build the warmup ramp for a working weight. Returns an empty array when
 * the working weight is at or below the bar (nothing to warm up to). The
 * first set is always the empty bar; each later step is the percentage
 * rounded down to a loadable weight, skipped when it doesn't clear the
 * previous step or has already reached the working weight.
 */
export function generateWarmup(
  workingWeight: number,
  bar: number = DEFAULT_BAR_LB,
  plates: readonly number[] = DEFAULT_PLATES_LB,
): WarmupSet[] {
  if (!(workingWeight > bar)) return [];

  const out: WarmupSet[] = [{ weight: bar, reps: 10, pct: null }];
  let prev = bar;
  for (const step of RAMP) {
    const load = computePlateLoad(workingWeight * step.pct, bar, plates);
    const weight = load ? load.achievable : bar;
    // Skip a step that doesn't add load over the last one, or that has
    // already crept up to the working weight.
    if (weight <= prev || weight >= workingWeight) continue;
    out.push({ weight, reps: step.reps, pct: step.pct });
    prev = weight;
  }
  return out;
}
