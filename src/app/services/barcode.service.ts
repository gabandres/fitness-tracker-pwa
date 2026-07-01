import { Injectable } from '@angular/core';

export interface BarcodeResult {
  calories: number;
  protein: number;
  carbs: number | null;
  fat: number | null;
  productName: string;
  brand?: string;
  /** Grams the returned macros correspond to — the product's serving weight
   *  when known, else 100 (per-100g basis), else null when the product only
   *  had per-serving macros with no gram weight (ADR-0013: honest grams). */
  grams: number | null;
}

/**
 * Wraps the native BarcodeDetector API for scanning + OpenFoodFacts
 * for nutrition lookup. Entirely client-side, no Cloud Function needed.
 */
@Injectable({ providedIn: 'root' })
export class BarcodeService {
  /** True if the browser supports BarcodeDetector. */
  isSupported(): boolean {
    return 'BarcodeDetector' in window;
  }

  /**
   * Scan from a live video stream. Loops requestAnimationFrame calling
   * BarcodeDetector.detect() until a barcode is found or timeout (15s).
   */
  scanFromStream(video: HTMLVideoElement): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.isSupported()) {
        reject(new Error('BarcodeDetector not supported in this browser.'));
        return;
      }

      const detector = new (window as any).BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'],
      });

      let stopped = false;
      const timeout = setTimeout(() => {
        stopped = true;
        reject(new Error('No barcode detected within 15 seconds.'));
      }, 15_000);

      const tick = async () => {
        if (stopped) return;
        try {
          const barcodes = await detector.detect(video);
          if (barcodes.length > 0) {
            stopped = true;
            clearTimeout(timeout);
            resolve(barcodes[0].rawValue);
            return;
          }
        } catch {
          // Frame not ready yet — keep trying.
        }
        if (!stopped) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /**
   * Look up a barcode on OpenFoodFacts (free, CORS-enabled, no key).
   * Returns per-serving calories/protein if available, else per-100g.
   */
  async lookupProduct(barcode: string): Promise<BarcodeResult> {
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

    const KJ_TO_KCAL = 4.184;
    // Pick a single consistent basis so `grams` matches the macros (grams-first
    // save, ADR-0013). Prefer the per-serving basis when the product declares a
    // serving weight; otherwise per-100g; otherwise per-serving macros with an
    // unknown weight (grams = null → saved as `serving:1`).
    const servingGramsRaw = typeof p.serving_quantity === 'string'
      ? parseFloat(p.serving_quantity)
      : p.serving_quantity;
    const servingGrams = typeof servingGramsRaw === 'number' && Number.isFinite(servingGramsRaw) && servingGramsRaw > 0
      ? servingGramsRaw : null;
    const kcalServing = n['energy-kcal_serving']
      ?? (n['energy_serving'] != null ? n['energy_serving'] / KJ_TO_KCAL : null);
    const kcal100 = n['energy-kcal_100g']
      ?? (n['energy_100g'] != null ? n['energy_100g'] / KJ_TO_KCAL : null);

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
      productName: name.slice(0, 100),
      ...(brand ? { brand: brand.slice(0, 80) } : {}),
      grams,
    };
  }
}
