/**
 * What a chosen pace ACTUALLY delivers once the calorie floor is applied.
 *
 * ## The problem this reports
 *
 * The pace control is presented as a promise — "0.9 lb/wk" — and the app is
 * free to break it silently. `calculateTdee` derives the target as
 * `trueTdee − pace × 3500 / 7` and then clamps it at `calorieFloor`, so a
 * floor above that number quietly rewrites the pace and nothing says so.
 *
 * Measured on a real account: maintenance 1,870, pace 0.9 lb/wk, floor 1,850.
 * The pace asks for a 1,420 target; the floor holds it at 1,850; the deficit
 * that survives is 20 kcal/day, which is **0.04 lb/wk**. The user picked a
 * number, the app displayed it back, and delivered one twenty-second of it.
 *
 * ## No math is invented here
 *
 * Every line below re-derives what `calculateTdee` already does — same
 * `KCAL_PER_POUND`, same `calorieFloor()`, same `Math.round` and same
 * `Math.max`, in the same order — so `target` is byte-identical to
 * `tdee.newDailyTarget` when the requested pace is the profile's own. That
 * equality is pinned by a test. This module decides nothing about targets; it
 * only makes an existing clamp visible.
 *
 * ## Why it takes the pace as an argument rather than reading the profile
 *
 * Its consumer is the Refine-targets sheet, where the interesting pace is the
 * one under the user's thumb, not the one on the saved profile. Passing it
 * explicitly lets the sheet answer "what would this do?" while the slider
 * moves, and lets a caller that wants the stored answer pass
 * `profile.targetPaceLbsPerWeek`.
 */
import type { GoalDirection } from './macro-heuristic';
import { calorieFloor, type TdeeResult } from './tdee';

const KCAL_PER_POUND = 3500;

export interface PaceReality {
  /** The pace the user asked for, lb/wk, rounded for display. */
  requestedPace: number;
  /**
   * The pace the resulting target can actually produce, lb/wk. Equal to
   * `requestedPace` when nothing binds. **Can be zero or negative**: a floor
   * at or above maintenance produces a target that maintains or gains, which
   * is a real configuration and worth saying out loud rather than clamping
   * away into a reassuring 0.
   */
  effectivePace: number;
  /** The daily kcal target this pace produces — the same number
   *  `calculateTdee` would return for it. */
  target: number;
  /** The floor that was applied: the user's `calorieFloor`, else the built-in
   *  default. Named so a UI can say WHICH number is doing this. */
  floor: number;
  /** Maintenance (kcal/day) the arithmetic ran against. */
  maintenance: number;
  /**
   * Whether the floor is what stands between the requested pace and the
   * effective one. Compared on the ROUNDED values on purpose: a floor that
   * exceeds the unclamped target by a couple of kcal is technically binding
   * and displays identically, and "your floor holds this to 0.90 lb/wk" when
   * 0.9 was asked for reads as a bug. If it does not change the number a user
   * can see, it is not worth telling them about.
   */
  floorBinding: boolean;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The pace-vs-floor reading, or `null` when there is nothing meaningful to
 * compute.
 *
 * Null for `source === 'seed'`, and only for that: the seed result's
 * `newDailyTarget` is a hardcoded 1,800 that is not derived from pace at all,
 * so a "your floor is costing you X" sentence built on it would be fiction.
 * Formula mode IS reported — its target runs through exactly the same
 * pace-minus-floor arithmetic as measured mode, and a formula user with a high
 * floor is being misled by precisely the same amount. What is uncertain there
 * is the maintenance estimate, not the clamp, which is why the field is named
 * `maintenance` and the copy that consumes it does not claim it was measured.
 */
export function paceReality(
  tdee: TdeeResult,
  requestedPaceLbsPerWeek: number,
  profile?: { calorieFloor?: number; goalDirection?: GoalDirection } | null,
): PaceReality | null {
  if (tdee.source === 'seed' || tdee.trueTdee <= 0) return null;
  if (!Number.isFinite(requestedPaceLbsPerWeek) || requestedPaceLbsPerWeek < 0) return null;
  // A surplus cannot collide with the calorie FLOOR — it moves away from it —
  // so there is nothing for this card to warn about on a "gain" goal, and
  // computing it anyway would report a floor-capped pace that is not real
  // (UX_AUDIT F7).
  if (profile?.goalDirection === 'gain') return null;

  const floor = calorieFloor(profile);
  // Mirrors calculateTdee exactly — round the deficit-derived target, then take
  // the floor. Rounding after the max, or before the subtraction, would drift
  // by a kcal and stop `target === tdee.newDailyTarget` from holding.
  const targetDeficit = (requestedPaceLbsPerWeek * KCAL_PER_POUND) / 7;
  const target = Math.max(floor, Math.round(tdee.trueTdee - targetDeficit));

  const requestedPace = round2(requestedPaceLbsPerWeek);
  const effectivePace = round2(((tdee.trueTdee - target) * 7) / KCAL_PER_POUND);

  return {
    requestedPace,
    effectivePace,
    target,
    floor,
    maintenance: tdee.trueTdee,
    floorBinding: effectivePace < requestedPace,
  };
}
