/**
 * Photo-scan domain types — the shape a meal-photo analysis returns, shared by
 * BOTH frontends and the `scanMeal` Cloud Function (ADR-0015). The vision model
 * does recognition + portion only; the server resolves each item's macros
 * against the USDA/`customFoods` data, so what reaches the client is already
 * itemized, grounded macros the user reviews and edits — never a black-box
 * total. Keep this pure (no I/O) like the rest of `@macrolog/core`.
 */

/** Where one item's macros actually came from. Per ITEM, not per scan: one
 *  plate routinely mixes a USDA-resolved rice with an unresolvable mofongo,
 *  and the user is entitled to know which is which. */
export type ScannedItemSource = 'usda' | 'custom' | 'model';

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
  /**
   * How THIS item's macros were produced. `'model'` means the food database had
   * no match and the vision model's own numbers stand — the case ADR-0015 §1
   * measured at >60% protein error, so it is worth surfacing rather than
   * presenting with the same authority as a database row.
   *
   * Optional because a client may still be reading a response from before the
   * server was itemized; absent means "not stated", not "grounded".
   */
  source?: ScannedItemSource;
  /** FDC id of the matched food, when `source` is `'usda'`. */
  fdcId?: string | null;
  /** The database description the macros came from, so the review screen can
   *  show the user what the app thinks it is looking at. */
  matchedDescription?: string | null;
  /**
   * `grams` was READ OFF A SCALE in the photo rather than estimated from
   * visual cues (ADR-0029 item 2). Present only when true.
   *
   * **This is the one field here that claims something about the physical
   * world**, and ADR-0029 item 4 requires the review screen to render it
   * differently from an estimate: `grams` is the only number the model
   * contributes and every macro scales linearly off it, so a measurement and a
   * guess are not the same evidence and must not look the same. Showing them
   * identically is the failure ADR-0027 named for the 2022 menu figures.
   *
   * Independent of {@link source}, deliberately. `source` says where the MACROS
   * came from; this says where the WEIGHT came from. A USDA row with a guessed
   * weight and a model fallback with a weighed one are both real.
   */
  measured?: boolean;
}

/** Full result of one scan: the items plus the source the macros came from. */
export interface ScanResult {
  items: ScannedFoodItem[];
  /** Scan-level roll-up: `'usda'` when at least one item resolved against the
   *  database, `'model'` when none did. Per-item `source` is the finer answer. */
  source: ScannedItemSource;
}

/** True when any item fell back to the model's own numbers — the condition the
 *  review screen warns on. */
export function hasUngroundedItems(items: readonly ScannedFoodItem[]): boolean {
  return items.some((i) => i.source === 'model');
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
