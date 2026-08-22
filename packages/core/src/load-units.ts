import { kgToLb, lbToKg } from './health-mapping';
import type { UnitSystem } from './unit-system';

/**
 * Lifted load — barbell weight, dumbbell weight, volume, e1RM — in the unit
 * the user trains in, over a store that is always POUNDS.
 *
 * ## Why this is a separate module from `body-weight-units`
 *
 * They convert with the same constant and they are not the same concern. A
 * body weight is a measurement of a person; a load is a thing you can actually
 * build out of the plates in front of you, and that is what makes the units
 * question different:
 *
 * - **The bar is not the same bar.** 45 lb in an imperial gym, 20 kg in a
 *   metric one — and 20 kg is 44.09 lb, so they are genuinely different bars,
 *   not one bar described two ways.
 * - **The plates are not the same plates.** 45/35/25/10/5/2.5 lb against
 *   25/20/15/10/5/2.5/1.25 kg. Converting a pound stack into kilograms
 *   produces numbers no metric gym owns.
 * - **The step is not the same step.** A lb lifter adds 5; a kg lifter adds
 *   2.5, because that is the smallest pair of plates on the rack.
 *
 * So plate math must be solved **in the display unit**, with that unit's own
 * bar and plates — not solved in pounds and converted afterwards. Converting
 * afterwards is how a metric lifter is told to load 20.4 kg a side.
 *
 * ## Storage stays in pounds, exactly as body weight does
 *
 * One representation, no migration of historical sets, and every derivation
 * that sums or compares loads (volume, e1RM, progression) keeps working on one
 * scale. The alternative — a unit tag per set — makes every consumer ask a
 * question it does not need to ask, and makes a lifter who switches units
 * unable to compare this month to last.
 */

/** Standard Olympic bar in a metric gym. NOT 45 lb converted — a different
 *  bar, which happens to weigh 44.09 lb. */
export const DEFAULT_BAR_KG = 20;
/** Common kg plate set, heaviest first. */
export const DEFAULT_PLATES_KG: readonly number[] = [25, 20, 15, 10, 5, 2.5, 1.25];

/** Smallest sensible progression step per unit — a pair of the smallest
 *  commonly-racked plates. */
export const DEFAULT_INCREMENT_LB = 5;
export const DEFAULT_INCREMENT_KG = 2.5;

export function loadUnit(unitSystem: UnitSystem | undefined): 'lb' | 'kg' {
  return unitSystem === 'metric' ? 'kg' : 'lb';
}

/**
 * Stored pounds → the number to SHOW, in the training unit.
 *
 * `decimals` defaults to 1, which is what a working set needs (102.1 kg). Pass
 * 0 for aggregates — a weekly volume of "5,669.9 kg" reads as false precision
 * on a number that is a sum of estimates.
 */
export function toDisplayLoad(
  lb: number,
  unitSystem: UnitSystem | undefined,
  decimals: 0 | 1 = 1,
): number {
  const value = unitSystem === 'metric' ? lbToKg(lb) : lb;
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** What the user typed, in their training unit → pounds to store. Null for
 *  anything unparseable. Accepts a comma decimal separator (es-PR keyboards). */
export function parseLoadToLb(
  input: string,
  unitSystem: UnitSystem | undefined,
): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return unitSystem === 'metric' ? kgToLb(n) : n;
}

/** `"225 lb"` / `"102.1 kg"`. */
export function formatLoad(
  lb: number,
  unitSystem: UnitSystem | undefined,
  decimals: 0 | 1 = 1,
): string {
  return `${toDisplayLoad(lb, unitSystem, decimals).toLocaleString()} ${loadUnit(unitSystem)}`;
}

/** The bar, IN THE DISPLAY UNIT. Feed this to `computePlateLoad` together
 *  with a target that is also in the display unit. */
export function barFor(unitSystem: UnitSystem | undefined): number {
  return unitSystem === 'metric' ? DEFAULT_BAR_KG : 45;
}

/** The plate set, IN THE DISPLAY UNIT. */
export function platesFor(unitSystem: UnitSystem | undefined): readonly number[] {
  return unitSystem === 'metric' ? DEFAULT_PLATES_KG : [45, 35, 25, 10, 5, 2.5];
}

/** Default progression step, IN THE DISPLAY UNIT. */
export function defaultIncrement(unitSystem: UnitSystem | undefined): number {
  return unitSystem === 'metric' ? DEFAULT_INCREMENT_KG : DEFAULT_INCREMENT_LB;
}
