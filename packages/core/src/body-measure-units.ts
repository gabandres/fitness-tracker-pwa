/**
 * Tape-measurement units — the shared answer to "what number do I SHOW, and
 * what did the user just type", for body measurements.
 *
 * Measurements are STORED IN INCHES (see `MeasurementDoc` in
 * ./firestore-writers and the bands in ./measurement-bounds), which is fine
 * until the app is set to metric. Measured 2026-09-22 on a real capture: the
 * Body tab printed `Waist 33.3 · Neck 15.5 · Chest 41.8` **with no unit and no
 * conversion**, byte-identical in pounds mode and kilograms mode, on a screen
 * whose every other number had just flipped to kg. 33.3 read as centimetres is
 * a thigh. Typing 84 for a waist in cm was then rejected against the INCH band
 * by a message quoting inches.
 *
 * That is worse than a wrong unit label, because a missing label cannot be
 * noticed. These functions are the single seam, mirroring
 * ./body-weight-units for weight.
 */
import type { MeasurementField } from './measurement-bounds';
import { MEASUREMENT_BOUNDS_IN } from './measurement-bounds';
import type { UnitSystem } from './unit-system';

const CM_PER_IN = 2.54;
/** One decimal: a tape is not more precise than that, in either unit. */
const DECIMALS = 1;

const round = (n: number) => Math.round(n * 10 ** DECIMALS) / 10 ** DECIMALS;

export function measureUnit(unitSystem: UnitSystem | undefined): 'in' | 'cm' {
  return unitSystem === 'metric' ? 'cm' : 'in';
}

/** Stored inches → the number to SHOW. Display only; never store this back. */
export function toDisplayMeasure(inches: number, unitSystem: UnitSystem | undefined): number {
  return round(unitSystem === 'metric' ? inches * CM_PER_IN : inches);
}

/** What the user typed, in their unit → inches to store. Null when
 *  unparseable, so callers keep one "no usable number" branch.
 *
 *  Accepts a comma decimal separator for the same reason `parseWeightToLb`
 *  does: an es-PR keyboard produces `84,5` and `Number('84,5')` is NaN. */
export function parseMeasureToIn(input: string, unitSystem: UnitSystem | undefined): number | null {
  const text = input.trim().replace(',', '.');
  if (text === '') return null;
  const n = Number(text);
  if (!Number.isFinite(n) || n <= 0) return null;
  return unitSystem === 'metric' ? n / CM_PER_IN : n;
}

/** A field's plausible band in the user's OWN unit, for the out-of-range
 *  message. Telling a metric user their waist must be "15–80 in" is a
 *  non-answer, and it is what shipped. */
export function measureBoundsFor(
  field: MeasurementField,
  unitSystem: UnitSystem | undefined,
): { min: number; max: number } {
  const [lo, hi] = MEASUREMENT_BOUNDS_IN[field];
  return {
    min: Math.ceil(toDisplayMeasure(lo, unitSystem)),
    max: Math.floor(toDisplayMeasure(hi, unitSystem)),
  };
}

/** `"33.3 in"` / `"84.6 cm"` — the one place number and unit are joined, so
 *  no screen has to remember to print the glyph. It forgot for a year. */
export function formatMeasure(inches: number, unitSystem: UnitSystem | undefined): string {
  return `${toDisplayMeasure(inches, unitSystem)} ${measureUnit(unitSystem)}`;
}
