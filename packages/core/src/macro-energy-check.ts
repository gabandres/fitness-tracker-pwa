import { atwaterKcal } from './food-plausibility';

/**
 * Does a logged entry's calorie figure disagree with its own macros?
 *
 * The sibling of `assessMacros` for a WHOLE entry rather than a per-100 g
 * sample: the mass caps there (105 g) are meaningless for a meal, so only the
 * Atwater ratio is reused, with the same band. A miss is a WARNING, never a
 * block — partial macro logging is legitimate (protein alone is the common
 * case, and a protein-only entry is deliberately not flagged for being "below"
 * its calories), and a number the user typed on purpose must save.
 *
 * Measured motivation (2026-08-31): 240 kcal with P16/C40/F20 — 404 kcal by
 * Atwater, a 68% miss — saved silently.
 */
export interface MacroEnergyMismatch {
  /** 4P + 4C + 9F, rounded. */
  estimateKcal: number;
  /** entered ÷ estimate. */
  ratio: number;
}

/** ±25%. The upper edge matches `food-plausibility.ts`; the lower one is
 *  tighter than its 0.5, which exists to keep fibre/sugar-alcohol PRODUCTS
 *  searchable. A hand-typed entry 40% under its own macros (the measured case
 *  is 59%) is a slip worth a sentence, and a sentence is all this is. */
export const MACRO_ENERGY_SUSPECT_ABOVE = 1.25;
export const MACRO_ENERGY_SUSPECT_BELOW = 0.75;

export function macroEnergyMismatch(entry: {
  kcal: number | undefined;
  protein?: number;
  carbs?: number;
  fat?: number;
}): MacroEnergyMismatch | null {
  const kcal = entry.kcal;
  if (kcal == null || !Number.isFinite(kcal) || kcal <= 0) return null;
  // All three macros are needed for "the macros add up to X" to be a claim at
  // all. Protein-only (the common partial log) has nothing to reconcile.
  const p = entry.protein;
  const c = entry.carbs;
  const f = entry.fat;
  if (p == null || c == null || f == null) return null;
  const estimate = atwaterKcal({ kcal, protein: p, carb: c, fat: f });
  if (estimate == null || estimate <= 0) return null;
  const ratio = kcal / estimate;
  if (ratio > MACRO_ENERGY_SUSPECT_ABOVE || ratio < MACRO_ENERGY_SUSPECT_BELOW) {
    return { estimateKcal: Math.round(estimate), ratio };
  }
  return null;
}
