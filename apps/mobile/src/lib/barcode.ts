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
}

const KJ_TO_KCAL = 4.184;

/**
 * Look up a barcode on OpenFoodFacts. Returns per-serving calories/protein
 * when available, else per-100g (falling back to kJ→kcal conversions).
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

  const calories =
    n['energy-kcal_serving'] ??
    n['energy-kcal_100g'] ??
    (n['energy_serving'] != null ? Math.round(n['energy_serving'] / KJ_TO_KCAL) : null) ??
    (n['energy_100g'] != null ? Math.round(n['energy_100g'] / KJ_TO_KCAL) : null);
  const protein = n['proteins_serving'] ?? n['proteins_100g'];
  const carbs = n['carbohydrates_serving'] ?? n['carbohydrates_100g'];
  const fat = n['fat_serving'] ?? n['fat_100g'];

  if (calories == null) {
    throw new Error(`No calorie data found for "${name}".`);
  }

  return {
    calories: Math.round(calories),
    protein: protein != null ? Math.round(protein) : 0,
    carbs: carbs != null ? Math.round(carbs) : null,
    fat: fat != null ? Math.round(fat) : null,
    productName: String(name).slice(0, 100),
  };
}
