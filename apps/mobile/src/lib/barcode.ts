// OpenFoodFacts barcode → nutrition lookup. Pure fetch (CORS-enabled, no
// key); the nutriment-basis rule itself lives in @macrolog/core/off-product,
// shared with the PWA BarcodeService. Scanning is native (expo-camera) — see
// components/BarcodeScanner.
import { type OffResponse, type ResolvedProduct, resolveOffProduct } from '@macrolog/core';

/**
 * Look up a barcode on OpenFoodFacts and resolve it to a single nutriment
 * basis. Throws `OffLookupError` (carrying a translatable `code`) when the
 * product or its calories are missing, and a plain Error on transport failure.
 */
export async function lookupProduct(barcode: string): Promise<ResolvedProduct> {
  const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`OpenFoodFacts returned ${res.status}.`);
  return resolveOffProduct((await res.json()) as OffResponse, barcode);
}
