/**
 * Photo-scan domain types — the shape a meal-photo analysis returns, shared by
 * BOTH frontends and the `scanMeal` Cloud Function (ADR-0015). The vision model
 * does recognition + portion only; the server resolves each item's macros
 * against the USDA/`customFoods` data, so what reaches the client is already
 * itemized, grounded macros the user reviews and edits — never a black-box
 * total. Keep this pure (no I/O) like the rest of `@macrolog/core`.
 */

/** One recognized food in a scanned meal, with server-resolved macros. */
export interface ScannedFoodItem {
  /** Display name the vision model recognized ("grilled chicken breast"). */
  name: string;
  /** Estimated portion in grams — the number the user is most likely to fix. */
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  /** 0–1 model confidence; drives a "double-check this" hint on low values. */
  confidence: number;
}

/** Full result of one scan: the items plus the source the macros came from. */
export interface ScanResult {
  items: ScannedFoodItem[];
  /** How the macros were grounded — 'usda' | 'custom' | 'model' (unresolved
   *  fallback where no DB match was found and the model's numbers stand). */
  source: 'usda' | 'custom' | 'model';
}

/** Sum a scan's items into a single macro total (for the review-screen ring). */
export function sumScannedMacros(items: ScannedFoodItem[]): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  return items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories,
      protein: acc.protein + it.protein,
      carbs: acc.carbs + it.carbs,
      fat: acc.fat + it.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

/**
 * Rescale an item's macros when the user edits its portion. Macros are linear
 * in grams, so we scale from the ratio of new:old grams. Guards a zero/again
 * old-grams so a mis-scanned 0 g item stays editable instead of dividing by 0.
 */
export function rescaleScannedItem(item: ScannedFoodItem, newGrams: number): ScannedFoodItem {
  const grams = Math.max(0, newGrams);
  if (item.grams <= 0) return { ...item, grams };
  const r = grams / item.grams;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...item,
    grams,
    calories: Math.round(item.calories * r),
    protein: round(item.protein * r),
    carbs: round(item.carbs * r),
    fat: round(item.fat * r),
  };
}
