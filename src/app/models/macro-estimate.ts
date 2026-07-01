import type { FoodSource } from '@macrolog/core';

export interface MacroEstimate {
  calories: number;
  protein: number | null;
  carbs?: number | null;
  fat?: number | null;
  label: string;
  /**
   * Optional food-library context, set when the estimate came from a barcode
   * scan or a database search (ADR-0013 2a-iii). Lets the post-save
   * "Save to My Foods" store a grams-first, dedup-keyed CustomFood instead of
   * the manual `serving:1` fallback. Absent for manual / preset / photo.
   * `grams` is the weight of THIS emitted portion (already × any multiplier);
   * the estimate's macros are the macros for that same portion.
   */
  serving?: {
    /** Weight of this portion. Absent when the source had no gram weight
     *  (e.g. a barcode product with per-serving-only macros) → saved as
     *  `serving:1` rather than a fabricated gram count. */
    grams?: number;
    source: FoodSource;
    /** GTIN, only for an actual barcode scan → barcode-as-doc-id de-dup. */
    barcode?: string;
    brand?: string;
    /** Clean food name (no portion suffix) to default the save name field. */
    name?: string;
  };
}
