// OpenFoodFacts barcode → nutrition lookup. Pure fetch (CORS-enabled, no
// key); the nutriment-basis rule itself lives in @macrolog/core/off-product,
// shared with the PWA BarcodeService, as does the URL (and its `fields=` trim).
// Scanning is native (expo-camera) — see components/BarcodeScanner.
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  type CustomFood,
  type OffResponse,
  type ResolvedProduct,
  offProductUrl,
  resolveOffProduct,
  scaleCustomFood,
} from '@macrolog/core';

/**
 * On-device memo of barcode → resolved product.
 *
 * People eat the same things. A protein bar scanned on Monday and again on
 * Thursday is two identical network round trips to a third party for a payload
 * that cannot have changed meaningfully in between — and the second one is the
 * scan that *feels* slow, because by then the user knows what the answer should
 * be. A hit here returns before the camera modal has finished its slide.
 *
 * Deliberately small and deliberately dumb:
 *
 * - **Bounded** at {@link CACHE_LIMIT} entries, evicted oldest-first. A tracker
 *   used daily for a year must not accumulate an unbounded blob in
 *   AsyncStorage; the working set of foods one person scans is small.
 * - **TTL'd** at {@link CACHE_TTL_MS}. OFF is crowd-edited, so a product's
 *   nutrition genuinely can be corrected. Thirty days is long enough that a
 *   regular item is always warm and short enough that a fix reaches users
 *   without anyone thinking about invalidation.
 * - **Never authoritative.** Every read is wrapped so that a corrupt or
 *   schema-drifted entry falls through to the network instead of throwing.
 *   This is a latency cache, not a data store — losing it costs nothing.
 *
 * It is NOT the offline queue. A scan that misses the cache while offline still
 * fails, and should: the user is mid-flow and needs to be told, not handed a
 * silent blank. `pending-logs.ts` owns durability for the *write* that follows.
 */
const CACHE_KEY = 'barcodeCache.v1';
const CACHE_LIMIT = 200;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface CacheEntry {
  /** When this product was fetched, epoch ms. */
  at: number;
  product: ResolvedProduct;
}

type CacheMap = Record<string, CacheEntry>;

async function readCache(): Promise<CacheMap> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    // A hand-rolled shape check, because a schema change in ResolvedProduct
    // would otherwise surface as a wrong macro rather than a cache miss.
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as CacheMap) : {};
  } catch {
    return {};
  }
}

async function writeCache(map: CacheMap): Promise<void> {
  try {
    const entries = Object.entries(map);
    // Oldest-first eviction. Sorting the whole map on every write is fine at
    // 200 entries and keeps the policy in one obvious line.
    const kept = entries.length > CACHE_LIMIT
      ? entries.sort((a, b) => b[1].at - a[1].at).slice(0, CACHE_LIMIT)
      : entries;
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    // A full disk must not break scanning.
  }
}

/** Drop every cached product. Exposed for the account-delete / sign-out paths. */
export async function clearBarcodeCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(CACHE_KEY);
  } catch {
    /* nothing to do */
  }
}

/**
 * The open add-sheet's view of the user's own library, for the scan in flight.
 *
 * `resolveLocal` answers a barcode from the user's saved My Foods BEFORE Open
 * Food Facts is asked: a food the user typed in from a label (because OFF did
 * not have it) must match on the next scan, or saving it bought nothing.
 *
 * A module-level registration rather than a prop on `BarcodeScanner` because
 * the scanner calls `lookupProduct` itself; the sheet registers while its
 * scanner is open and clears on close. One scanner is ever open at a time, so
 * one slot is enough.
 */
export interface ScanLibrary {
  resolveLocal: (barcode: string) => ResolvedProduct | null;
}

let scanLibrary: ScanLibrary | null = null;

/** Register the library for the scan in flight; returns the unregister. */
export function setScanLibrary(lib: ScanLibrary): () => void {
  scanLibrary = lib;
  return () => {
    if (scanLibrary === lib) scanLibrary = null;
  };
}

/**
 * Look up a barcode on OpenFoodFacts and resolve it to a single nutriment
 * basis. Throws `OffLookupError` (carrying a translatable `code`) when the
 * product or its calories are missing, and a plain Error on transport failure.
 *
 * The user's own saved food wins over both the cache and the network (see
 * {@link ScanLibrary}). Otherwise served from the on-device cache when one is
 * warm and unexpired.
 */
export async function lookupProduct(barcode: string): Promise<ResolvedProduct> {
  const own = scanLibrary?.resolveLocal(barcode);
  if (own) return own;
  return lookupRemote(barcode);
}

async function lookupRemote(barcode: string): Promise<ResolvedProduct> {
  const cache = await readCache();
  const hit = cache[barcode];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS && hit.product) {
    return hit.product;
  }

  const res = await fetch(offProductUrl(barcode));
  // 404 is OFF v3's answer for "no such product", and it is the single most
  // common barcode outcome — plenty of US groceries are simply not in a
  // crowd-sourced European database. It carries a normal JSON body, so it must
  // reach `resolveOffProduct`, which raises `OffLookupError('FOOD_NOT_FOUND')`
  // and gets the user the "we don't have that product" copy.
  //
  // Rejecting every non-2xx (which is what this did until 2026-08-21) turned
  // that into a bare `Error`, which `errorKeyFor` cannot classify, so it fell
  // back to "couldn't read that barcode" — telling the user to re-scan a
  // barcode that scanned perfectly and will never resolve. Only genuine
  // transport failures belong in the throw below.
  if (!res.ok && res.status !== 404) {
    throw new Error(`OpenFoodFacts returned ${res.status}.`);
  }
  const product = resolveOffProduct((await res.json()) as OffResponse, barcode);

  // Cache only a successful resolution. A miss or a nutrition-less product
  // throws above and is never stored — re-asking is correct there, because the
  // most common reason for both is that OFF has not been edited YET.
  cache[barcode] = { at: Date.now(), product };
  await writeCache(cache);

  return product;
}

/**
 * A saved My Foods entry as the scanner's `ResolvedProduct`, or null when the
 * library holds nothing under this barcode. One serving of the saved food is
 * the basis; its gram weight rides along only when the food was saved
 * grams-first (`servingUnit: 'g'`), so a `serving:1` food stays honest about
 * having no weight (ADR-0013).
 */
export function productFromLibrary(foods: readonly CustomFood[], barcode: string): ResolvedProduct | null {
  const food = foods.find((f) => f.barcode === barcode);
  if (!food) return null;
  const m = scaleCustomFood(food, 1);
  const grams = food.servingUnit === 'g' && food.servingSize > 0 ? food.servingSize : null;
  return {
    calories: m.calories,
    protein: m.protein ?? 0,
    carbs: m.carbs ?? null,
    fat: m.fat ?? null,
    productName: food.name,
    brand: food.brand,
    grams,
    serving: {
      grams: grams ?? undefined,
      // `barcode` keeps a re-save keyed on the same doc (`customFoodDocId`).
      source: 'barcode',
      barcode,
      brand: food.brand,
      name: food.name,
    },
  };
}
