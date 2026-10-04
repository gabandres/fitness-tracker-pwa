/**
 * The add sheet's "edit in grams" field (2026-10-04, round 2 of the food-sheet
 * pass). A searched or scanned food arrives at a known gram weight; typing a
 * different weight should rescale the four numbers to it.
 *
 * **Always from the basis, never from the fields.** The tempting version reads
 * the form's current kcal, multiplies by `new / old` grams and writes it back.
 * That compounds: every keystroke ("1", "15", "150") rescales the previous
 * keystroke's ROUNDED result, so the numbers drift and a typo followed by a
 * correction does not come back to where it started. Here the basis is the
 * food as it was picked — a fixed portion and its unscaled macros — and every
 * call is one multiplication away from it, so 50 g then 200 g equals 200 g.
 */

/** A food at one known weight: what a gram amount is scaled from. */
export interface GramBasis {
  grams: number;
  kcal: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

export interface RescaledMacros {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/** Outside this the typed text is a typo, not a portion (5 kg of anything). */
export const GRAMS_MAX = 5000;

/** Typed grams → a number, or null. Accepts a decimal comma (pt-BR / es keypads). */
export function parseGrams(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) && n > 0 && n <= GRAMS_MAX ? n : null;
}

/** Kcal to whole numbers; a macro keeps one decimal under 10 g and whole grams
 *  above — the rounding the form's Scale row already uses. */
function roundMacro(v: number): number {
  return v >= 10 ? Math.round(v) : Math.round(v * 10) / 10;
}

/** The basis's macros at `grams`, or null when either weight is unusable. */
export function rescaleFromBasis(basis: GramBasis, grams: number): RescaledMacros | null {
  if (!(basis.grams > 0) || !(grams > 0) || grams > GRAMS_MAX) return null;
  const f = grams / basis.grams;
  return {
    calories: Math.round(basis.kcal * f),
    protein: basis.protein != null ? roundMacro(basis.protein * f) : undefined,
    carbs: basis.carbs != null ? roundMacro(basis.carbs * f) : undefined,
    fat: basis.fat != null ? roundMacro(basis.fat * f) : undefined,
  };
}
