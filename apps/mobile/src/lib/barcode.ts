// OpenFoodFacts barcode → nutrition lookup. Pure fetch (CORS-enabled, no
// key), ported from the PWA BarcodeService.lookupProduct so both apps read
// the same fields. Scanning itself is native (expo-camera) — see
// components/BarcodeScanner.

export interface BarcodeResult {
  calories: number;
  protein: number;
  carbs: number | null;
  fat: number | null;
  productName: string;
  brand?: string;
  /** Grams the returned macros correspond to — the product's serving weight
   *  when known, else 100 (per-100g basis), else null when the product only
   *  had per-serving macros with no gram weight (ADR-0013: honest grams, so a
   *  weightless product saves as `serving:1` rather than a fabricated weight). */
  grams: number | null;
}

const KJ_TO_KCAL = 4.184;

/**
 * Look up a barcode on OpenFoodFacts. Picks a SINGLE consistent basis so
 * `grams` matches the returned macros (grams-first save, ADR-0013): prefer
 * per-serving when the product declares a serving weight, else per-100g, else
 * per-serving macros with unknown weight (grams=null). Mirrors the PWA
 * BarcodeService.lookupProduct byte-for-byte so both apps de-dup identically.
 * Throws a user-readable Error when the product or its calories are missing.
 */
export async function lookupProduct(barcode: string): Promise<BarcodeResult> {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenFoodFacts returned ${res.status}.`);
  const data = await res.json();

  if (data.status === 'failure' || !data.product) {
    throw new Error('Product not found in OpenFoodFacts.');
  }

  const p = data.product;
  const n = p.nutriments ?? {};
  const name = p.product_name ?? p.generic_name ?? 'Unknown product';
  const brand = typeof p.brands === 'string' ? p.brands.split(',')[0].trim() : undefined;

  const servingGramsRaw =
    typeof p.serving_quantity === 'string' ? parseFloat(p.serving_quantity) : p.serving_quantity;
  const servingGrams =
    typeof servingGramsRaw === 'number' && Number.isFinite(servingGramsRaw) && servingGramsRaw > 0
      ? servingGramsRaw
      : null;
  const kcalServing =
    n['energy-kcal_serving'] ?? (n['energy_serving'] != null ? n['energy_serving'] / KJ_TO_KCAL : null);
  const kcal100 =
    n['energy-kcal_100g'] ?? (n['energy_100g'] != null ? n['energy_100g'] / KJ_TO_KCAL : null);

  let grams: number | null;
  let calories: number | null;
  let protein: number | undefined;
  let carbs: number | undefined;
  let fat: number | undefined;
  if (servingGrams != null && kcalServing != null) {
    grams = servingGrams;
    calories = kcalServing;
    protein = n['proteins_serving']; carbs = n['carbohydrates_serving']; fat = n['fat_serving'];
  } else if (kcal100 != null) {
    grams = 100;
    calories = kcal100;
    protein = n['proteins_100g']; carbs = n['carbohydrates_100g']; fat = n['fat_100g'];
  } else {
    grams = null; // per-serving macros, no weight
    calories = kcalServing;
    protein = n['proteins_serving']; carbs = n['carbohydrates_serving']; fat = n['fat_serving'];
  }

  if (calories == null) {
    throw new Error(`No calorie data found for "${name}".`);
  }

  return {
    calories: Math.round(calories),
    protein: protein != null ? Math.round(protein) : 0,
    carbs: carbs != null ? Math.round(carbs) : null,
    fat: fat != null ? Math.round(fat) : null,
    productName: String(name).slice(0, 100),
    ...(brand ? { brand: brand.slice(0, 80) } : {}),
    grams,
  };
}
