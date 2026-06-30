/**
 * U.S. Navy body-fat estimate. Pure and dependency-free: the circumference
 * formula and all its guards live here, so this one function is the whole
 * test surface. Shared by the Angular PWA and the Expo app (ADR-0012).
 *
 * Inputs are inches (the app stores measurements + height in inches). The
 * estimate is a rough field method — accurate to ~3–4% vs a DEXA scan —
 * so callers should frame it as an estimate, never a clinical number.
 */
import type { Sex } from './types';

/** Plausible body-fat band; results outside it mean bad inputs, so we
 *  clamp rather than show a -5% or 80% figure. */
const MIN_BF = 2;
const MAX_BF = 60;

/**
 * Estimate body-fat percentage from tape measurements via the U.S. Navy
 * formula. Returns null when a required input is missing or non-positive,
 * or when the log argument would be ≤ 0 (e.g. neck ≥ waist) — i.e. when
 * there's nothing trustworthy to show. Result is clamped to a plausible
 * band and rounded to 0.1%.
 *
 * Male needs `waist`, `neck`, `heightIn`; female additionally needs `hip`.
 * All in inches.
 */
export function navyBodyFat(
  sex: Sex,
  heightIn: number,
  waistIn: number,
  neckIn: number,
  hipIn?: number,
): number | null {
  if (!(heightIn > 0) || !(waistIn > 0) || !(neckIn > 0)) return null;

  let pct: number;
  if (sex === 'female') {
    if (!(hipIn != null && hipIn > 0)) return null;
    const girth = waistIn + hipIn - neckIn;
    if (girth <= 0) return null;
    pct = 163.205 * Math.log10(girth) - 97.684 * Math.log10(heightIn) - 78.387;
  } else {
    const girth = waistIn - neckIn;
    if (girth <= 0) return null;
    pct = 86.01 * Math.log10(girth) - 70.041 * Math.log10(heightIn) + 36.76;
  }

  const clamped = Math.min(MAX_BF, Math.max(MIN_BF, pct));
  return Math.round(clamped * 10) / 10;
}
