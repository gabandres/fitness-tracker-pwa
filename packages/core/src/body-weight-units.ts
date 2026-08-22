import { kgToLb, lbToKg } from './health-mapping';
import type { UnitSystem } from './unit-system';
import { WEIGHT_MAX_LB, WEIGHT_MIN_LB } from './weight-bounds';

/**
 * Body weight in the unit the user reads and types, over a store that is
 * always POUNDS.
 *
 * ## The defect this closes (UX_AUDIT F3)
 *
 * Body weight was pounds-only, everywhere, with no way to change it.
 * Onboarding's big input hardcoded a literal `lb` glyph beside a 72pt number;
 * the Body tab hardcoded `lb` on the hero, the goal rail and every history
 * row. `unitSystem` existed on the profile and was settable — but Settings
 * labelled that row **Portion display**, and the label was honest: it reached
 * food serving sizes and nothing else. So a metric user could not enter or
 * read their own body weight in kilograms anywhere in the app, and typing
 * `68` (kg) at onboarding produced a plan built for a 68 lb person.
 *
 * ## Why storage stays in pounds
 *
 * Everything downstream is pounds: `firestore.rules` validates
 * `dailyWeights` against 30–700, `checkWeightEntry` against 50–500,
 * Mifflin-St Jeor takes `weightLbs`, and the TDEE regression is lb/day. A
 * stored unit would mean either a migration of every historical row or a
 * per-row unit tag, and both make every consumer ask a question it does not
 * need to ask. Convert at the UI seam instead: parse on the way in, format on
 * the way out, and the model never learns that kilograms exist.
 *
 * That is also why this module is deliberately thin. It is a display and
 * input concern, not domain math.
 */

/** Display precision. Pounds get 1 decimal, kilograms get 1 — a 0.1 kg step
 *  is finer than 0.1 lb, but a scale that reads to 0.1 kg is ordinary and
 *  rounding it away would lose real signal. */
const DECIMALS = 1;

export function bodyWeightUnit(unitSystem: UnitSystem | undefined): 'lb' | 'kg' {
  return unitSystem === 'metric' ? 'kg' : 'lb';
}

/** Stored pounds → the number to SHOW, in the user's unit. Rounded for
 *  display only; never feed this back into the store. */
export function toDisplayWeight(lb: number, unitSystem: UnitSystem | undefined): number {
  const value = unitSystem === 'metric' ? lbToKg(lb) : lb;
  return Math.round(value * 10 ** DECIMALS) / 10 ** DECIMALS;
}

/** What the user typed, in their unit → pounds to store. Returns null for
 *  anything unparseable, so callers keep one "no usable number" branch.
 *
 *  Accepts a comma decimal separator: es-PR keyboards produce `70,5`, and
 *  `Number('70,5')` is NaN, which would have read as "invalid weight" to a
 *  user who typed a perfectly ordinary number. */
export function parseWeightToLb(input: string, unitSystem: UnitSystem | undefined): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unitSystem === 'metric' ? kgToLb(n) : n;
}

/** The plausible-bodyweight band, expressed in the user's own unit, for the
 *  message shown when an entry falls outside it. Telling a metric user their
 *  weight must be "between 50 and 500 lb" is a non-answer. */
export function weightBoundsFor(unitSystem: UnitSystem | undefined): { min: number; max: number } {
  return {
    min: Math.ceil(toDisplayWeight(WEIGHT_MIN_LB, unitSystem)),
    max: Math.floor(toDisplayWeight(WEIGHT_MAX_LB, unitSystem)),
  };
}

/** `"178.5 lb"` / `"81.0 kg"` — the one place the number and its unit are
 *  joined, so no screen has to remember to print the glyph. */
export function formatBodyWeight(lb: number, unitSystem: UnitSystem | undefined): string {
  return `${toDisplayWeight(lb, unitSystem)} ${bodyWeightUnit(unitSystem)}`;
}
