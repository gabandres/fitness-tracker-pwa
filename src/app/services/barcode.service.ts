import { Injectable } from '@angular/core';

export interface BarcodeResult {
  calories: number;
  protein: number;
  productName: string;
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
    const url = `https://world.openfoodfacts.org/api/v3/product/${barcode}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenFoodFacts returned ${res.status}.`);
    const data = await res.json();

    if (data.status === 'failure' || !data.product) {
      throw new Error('Product not found in OpenFoodFacts.');
    }

    const p = data.product;
    const n = p.nutriments ?? {};
    const name = p.product_name ?? p.generic_name ?? 'Unknown product';

    // Prefer per-serving kcal, fall back to per-100g kcal, then kJ conversions.
    const KJ_TO_KCAL = 4.184;
    const calories = n['energy-kcal_serving'] ?? n['energy-kcal_100g']
      ?? (n['energy_serving'] != null ? Math.round(n['energy_serving'] / KJ_TO_KCAL) : null)
      ?? (n['energy_100g'] != null ? Math.round(n['energy_100g'] / KJ_TO_KCAL) : null);
    const protein = n['proteins_serving'] ?? n['proteins_100g'];

    if (calories == null) {
      throw new Error(`No calorie data found for "${name}".`);
    }

    return {
      calories: Math.round(calories),
      protein: protein != null ? Math.round(protein) : 0,
      productName: name.slice(0, 100),
    };
  }
}
