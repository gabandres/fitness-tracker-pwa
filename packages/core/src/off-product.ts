/**
 * Open Food Facts product resolution — the barcode arm of the
 * food-resolution pipeline (ADR-0013).
 *
 * Turns an OFF product payload into a `ResolvedProduct`: one consistent
 * nutriment basis, so the returned `grams` always matches the returned
 * macros (grams-first save). Both frontends resolve here; each keeps its
 * own `fetch` (browser vs React Native failure modes differ) and its own
 * scanner adapter (`BarcodeDetector` on web, expo-camera on mobile).
 *
 * Pure by design (ADR-0012): no fetch, no SDK, no framework.
 *
 * NOT the same code path as `functions/src/food-search.ts` `buildOffServings`.
 * That one serves the cached `getFoodDetail` portion picker and emits a
 * `ServingOption[]` anchored per-100g; ADR-0013 (step 2) keeps the client
 * scanner and the cached server search as two deliberate lookup paths.
 * The overlap is four primitives, not the rule — see that file's header.
 */
import type { FoodSource } from './types';

/** kJ → kcal. OFF reports `energy_*` in kJ and `energy-kcal_*` in kcal;
 *  older/partial products carry only the former. */
const KJ_TO_KCAL = 4.184;

const MAX_NAME_LEN = 100;
const MAX_BRAND_LEN = 80;

/** The two failure modes of a resolution. These strings are the SAME values
 *  as `ErrorCode.FOOD_NOT_FOUND` / `ErrorCode.FOOD_NO_NUTRITION` in
 *  `src/app/models/error-codes.ts` and `functions/src/error-codes.ts` — core
 *  deliberately does NOT declare a fourth competing ErrorCode enum, only the
 *  two literals it can actually raise. */
export type OffLookupErrorCode = 'FOOD_NOT_FOUND' | 'FOOD_NO_NUTRITION';

/** Thrown by {@link resolveOffProduct}. Callers translate `code` through their
 *  own i18n (web `tError`, mobile a local map) — this module never emits a
 *  user-facing string, so a message can't reach a user in the wrong language. */
export class OffLookupError extends Error {
  readonly code: OffLookupErrorCode;
  /** Product name when we got far enough to read one — lets a message say
   *  which product had no nutrition data. */
  readonly productName?: string;

  constructor(code: OffLookupErrorCode, productName?: string) {
    super(code);
    this.name = 'OffLookupError';
    this.code = code;
    this.productName = productName;
  }
}

/** The subset of an OFF `nutriments` object this rule reads. OFF returns many
 *  more keys; all are optional and any may be absent on a given product. */
export interface OffNutriments {
  'energy-kcal_serving'?: number;
  energy_serving?: number;
  'energy-kcal_100g'?: number;
  energy_100g?: number;
  proteins_serving?: number;
  carbohydrates_serving?: number;
  fat_serving?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
}

/** The subset of an OFF product doc this rule reads. */
export interface OffProductDoc {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  /** Grams per declared serving. OFF types this inconsistently — a number on
   *  most products, a numeric string on others. */
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
}

/** The parsed body of `GET /api/v3/product/{barcode}`. */
export interface OffResponse {
  /** v3 reports `'success' | 'failure'`. */
  status?: string;
  product?: OffProductDoc;
}

/**
 * Exactly the fields {@link resolveOffProduct} reads, as OFF's `fields=` list.
 *
 * It lives HERE, beside the interfaces above, because those interfaces are the
 * definition of what the resolver consumes — a list kept in the two frontends
 * would drift from the resolver the first time someone adds a nutriment, and
 * the failure mode is silent: a missing field resolves to a plausible-looking
 * wrong number, never an error.
 */
const OFF_FIELDS = [
  'code',
  'product_name',
  'generic_name',
  'brands',
  'serving_size',
  'serving_quantity',
  'nutriments',
] as const;

/**
 * Build the barcode lookup URL both frontends call.
 *
 * ## Why `fields=` is not an optimization detail
 *
 * Without it OFF returns the ENTIRE product document. Measured 2026-08-21 on
 * EAN 3017620422003: **145.8 KB against 2.4 KB** for the seven fields above —
 * a 60x payload for data that is thrown away during parsing. Four runs of each
 * had near-identical medians (149 ms vs 143 ms) on a desktop link, because
 * that is round-trip-bound; the difference lands on cellular, and in the tail
 * (one of the four full-document runs took **1,760 ms**).
 *
 * Verified equivalent, not assumed: across five products the trimmed response
 * is byte-identical on every field the resolver reads, `serving_size` and
 * `serving_quantity` included. That check matters more than the speed — a
 * dropped `serving_quantity` would silently re-base the macros on 100 g
 * (ADR-0013 "honest grams") rather than fail.
 *
 * ## Why the app identity is a query parameter and not a header
 *
 * OFF asks API callers to identify themselves. `User-Agent` is a **forbidden
 * header name** in browsers — the PWA's `fetch` would drop it silently — so
 * OFF accepts `app_name`/`app_version` in the query string instead, which is
 * the one form that works from both a browser and React Native. The Cloud
 * Function keeps sending the header, since Node has no such restriction.
 */
export function offProductUrl(barcode: string, appVersion = '1.0'): string {
  // Hand-built rather than `URLSearchParams`: core targets no runtime in
  // particular (ADR-0012) and its tsconfig carries no DOM lib, so the global
  // is not in scope here. `encodeURIComponent` is plain ES.
  const query =
    `fields=${OFF_FIELDS.join(',')}` +
    `&app_name=Ignia` +
    `&app_version=${encodeURIComponent(appVersion)}`;
  return `https://world.openfoodfacts.org/api/v3/product/${encodeURIComponent(barcode)}?${query}`;
}

/** Food-library context for the save-to-My-Foods path (ADR-0013 2a-iii).
 *  Assembled here because both frontends built the identical object by hand. */
export interface ResolvedServing {
  /** Weight of this portion. Absent when the product declared no gram weight
   *  → saved as `serving:1` rather than a fabricated gram count. */
  grams?: number;
  source: FoodSource;
  /** GTIN — drives barcode-as-doc-id de-dup. */
  barcode: string;
  brand?: string;
  /** Clean food name (no portion suffix) to default the save name field. */
  name: string;
}

/** One OFF product reduced to a single consistent nutriment basis. */
export interface ResolvedProduct {
  calories: number;
  /** NOTE the asymmetry with carbs/fat below: an unreported protein resolves
   *  to 0, not null. Preserved from the original per-frontend implementations
   *  rather than silently changed — see `off-product.test.ts`
   *  "reports 0 protein but null carbs/fat when OFF omits them". Making all
   *  three honest is a product decision, not a refactor. */
  protein: number;
  carbs: number | null;
  fat: number | null;
  productName: string;
  brand?: string;
  /** Grams the returned macros correspond to: the product's serving weight
   *  when known, else 100 (per-100g basis), else null (per-serving macros
   *  with no declared weight — ADR-0013 "honest grams"). */
  grams: number | null;
  serving: ResolvedServing;
}

/** Coerce OFF's inconsistently-typed `serving_quantity` to a usable gram
 *  weight. Returns null for absent, unparseable, zero, or negative values. */
function servingGrams(raw: number | string | undefined): number | null {
  const n = typeof raw === 'string' ? parseFloat(raw) : raw;
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : null;
}

/** kcal on a basis, falling back to the kJ field when OFF has no kcal one. */
function kcalOn(kcal: number | undefined, kj: number | undefined): number | null {
  if (kcal != null) return kcal;
  return kj != null ? kj / KJ_TO_KCAL : null;
}

/**
 * Resolve an OFF product payload into a single-basis {@link ResolvedProduct}.
 *
 * Basis precedence — the whole point of this module, since `grams` and the
 * macros must describe the SAME portion:
 *   1. per-serving, when the product declares both a serving weight and
 *      per-serving calories → `grams` = that weight
 *   2. per-100g → `grams` = 100
 *   3. per-serving macros with no declared weight → `grams` = null
 *
 * @param body    the parsed `/api/v3/product/{barcode}` response
 * @param barcode the scanned GTIN, carried into the serving context
 * @throws {OffLookupError} `FOOD_NOT_FOUND` when the payload has no product,
 *   `FOOD_NO_NUTRITION` when no basis yields calories.
 */
export function resolveOffProduct(body: OffResponse, barcode: string): ResolvedProduct {
  if (body.status === 'failure' || !body.product) {
    throw new OffLookupError('FOOD_NOT_FOUND');
  }

  const p = body.product;
  const n = p.nutriments ?? {};

  const productName = String(p.product_name ?? p.generic_name ?? 'Unknown product')
    .slice(0, MAX_NAME_LEN);
  const brand = typeof p.brands === 'string'
    ? p.brands.split(',')[0].trim().slice(0, MAX_BRAND_LEN) || undefined
    : undefined;

  const grams100 = servingGrams(p.serving_quantity);
  const kcalServing = kcalOn(n['energy-kcal_serving'], n.energy_serving);
  const kcal100 = kcalOn(n['energy-kcal_100g'], n.energy_100g);

  let grams: number | null;
  let calories: number | null;
  let protein: number | undefined;
  let carbs: number | undefined;
  let fat: number | undefined;

  if (grams100 != null && kcalServing != null) {
    grams = grams100;
    calories = kcalServing;
    protein = n.proteins_serving;
    carbs = n.carbohydrates_serving;
    fat = n.fat_serving;
  } else if (kcal100 != null) {
    grams = 100;
    calories = kcal100;
    protein = n.proteins_100g;
    carbs = n.carbohydrates_100g;
    fat = n.fat_100g;
  } else {
    grams = null;
    calories = kcalServing;
    protein = n.proteins_serving;
    carbs = n.carbohydrates_serving;
    fat = n.fat_serving;
  }

  if (calories == null) {
    throw new OffLookupError('FOOD_NO_NUTRITION', productName);
  }

  return {
    calories: Math.round(calories),
    protein: protein != null ? Math.round(protein) : 0,
    carbs: carbs != null ? Math.round(carbs) : null,
    fat: fat != null ? Math.round(fat) : null,
    productName,
    ...(brand ? { brand } : {}),
    grams,
    serving: {
      ...(grams != null ? { grams } : {}),
      source: 'barcode',
      barcode,
      ...(brand ? { brand } : {}),
      name: productName,
    },
  };
}
