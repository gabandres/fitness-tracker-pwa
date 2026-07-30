import { Injectable } from '@angular/core';
import { type OffResponse, type ResolvedProduct, resolveOffProduct } from '@macrolog/core';

/**
 * Wraps the native BarcodeDetector API for scanning + OpenFoodFacts
 * for nutrition lookup. Entirely client-side, no Cloud Function needed.
 *
 * The nutriment-basis rule itself lives in `@macrolog/core/off-product`
 * (shared with the Expo app); this service owns only the two browser-specific
 * halves — BarcodeDetector and the fetch.
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
   * Look up a barcode on OpenFoodFacts (free, CORS-enabled, no key) and
   * resolve it to a single nutriment basis. Throws `OffLookupError` (carrying
   * a translatable `code`) for a missing product or missing nutrition data,
   * and a plain Error for a transport failure.
   */
  async lookupProduct(barcode: string): Promise<ResolvedProduct> {
    const url = `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenFoodFacts returned ${res.status}.`);
    return resolveOffProduct((await res.json()) as OffResponse, barcode);
  }
}
