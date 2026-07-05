/**
 * Food database search + detail lookup. Wraps the USDA FoodData Central
 * (FDC) public API and caches results in Firestore so repeat queries
 * skip the upstream round-trip and stay well inside FDC's free-key
 * rate ceiling (1,000 req/hour/key).
 *
 * Two callables:
 *   - searchFoods(query, pageSize?) → slim hit list for the typeahead.
 *   - getFoodDetail(fdcId)          → full nutrient + portion payload
 *                                     pre-processed into the shape the
 *                                     client renders directly.
 *
 * Why a Cloud Function and not a direct browser fetch:
 *   - The FDC API key is rate-limited per key; proxying lets every user
 *     share one quota with caching so a viral search burst doesn't
 *     burn the budget.
 *   - FDC has no CORS headers on its API — direct browser fetch fails
 *     with an opaque error. The proxy sidesteps that entirely.
 *   - Caching in Firestore makes the second-and-onward hit free.
 */
import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ErrorCode } from "./error-codes";

// Registered at https://api.data.gov/signup/ — operator sets this once
// via `firebase functions:secrets:set USDA_FDC_API_KEY`. If unset the
// callable returns a typed error so the client can render a clear
// "ask the admin to configure food search" message instead of a generic
// 500.
const fdcApiKey = defineSecret("USDA_FDC_API_KEY");

const db = getFirestore();
const FDC_BASE = "https://api.nal.usda.gov/fdc/v1";
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days
// Food detail docs in FDC are versioned by `publicationDate` and never
// mutate post-publish, so the detail cache has no TTL — once cached,
// always fresh. If a doc is republished it gets a new fdcId.
// Per-uid spam guards. Search and detail use SEPARATE collections so
// the common "search → tap result" handoff (which happens in 50-300 ms)
// doesn't trip the detail call's limiter on the search's still-warm
// timestamp. Detail also runs at a shorter interval because it's
// idempotent + cached on the second call.
const SEARCH_MIN_INTERVAL_MS = 500;
const DETAIL_MIN_INTERVAL_MS = 200;
const SEARCH_QUERY_MAX_LEN = 80;
const SEARCH_PAGE_SIZE_MAX = 25;

// Nutrient numbers we care about. FDC's foodNutrients[] uses the legacy
// `nutrientNumber` (string) or new `nutrient.number`. Energy can appear
// as kcal (208) or kJ (268); we prefer kcal and fall back via 4.184.
const NUTRIENT_KCAL = "208";
const NUTRIENT_KJ = "268";
const NUTRIENT_PROTEIN = "203";
const NUTRIENT_FAT = "204";
const NUTRIENT_CARBS = "205";

interface FdcSearchHit {
  fdcId: number;
  description: string;
  dataType?: string;
  brandOwner?: string;
  brandName?: string;
  brandedFoodCategory?: string;
}

interface FdcSearchResponse {
  foods?: FdcSearchHit[];
  totalHits?: number;
}

interface FdcFoodNutrient {
  // SR / Foundation / FNDDS shape
  nutrientNumber?: string;
  amount?: number;
  unitName?: string;
  // Branded shape (nested)
  nutrient?: { number?: string; unitName?: string };
  value?: number;
}

interface FdcFoodPortion {
  amount?: number;
  gramWeight?: number;
  portionDescription?: string;
  modifier?: string;
  measureUnit?: { name?: string; abbreviation?: string };
}

interface FdcFoodDetail {
  fdcId: number;
  description: string;
  brandOwner?: string;
  brandName?: string;
  dataType?: string;
  servingSize?: number;
  servingSizeUnit?: string;
  householdServingFulltext?: string;
  foodNutrients?: FdcFoodNutrient[];
  foodPortions?: FdcFoodPortion[];
  // Branded foods carry per-serving labels at the top level
  labelNutrients?: {
    calories?: { value?: number };
    protein?: { value?: number };
  };
}

type FoodSource = 'fdc' | 'off';

interface FoodSearchHit {
  /** Which database the hit came from — drives getFoodDetail dispatch. */
  source: FoodSource;
  /** Stable id within the source: FDC's numeric fdcId (stringified) or an
   *  Open Food Facts barcode. */
  id: string;
  description: string;
  brand?: string;
  dataType?: string;
}

interface ServingOption {
  /** Display label, e.g. "1 cup", "100 g", "1 medium (148 g)" */
  label: string;
  /** Grams this serving represents — drives the proportional macro math. */
  grams: number;
  /** Calories for this serving (rounded). */
  kcal: number;
  /** Protein in grams for this serving (rounded). */
  protein: number;
  /** Carbs / fat in grams (rounded). Absent on cache entries written
   *  before the macro expansion — clients treat undefined as unknown. */
  carbs?: number;
  fat?: number;
  /** Discriminator: 'per100g' is the canonical row for metric users;
   *  'portion' is a household measure (cup, tbsp, slice, piece). The
   *  client's unit preference sorts by this tag rather than guessing
   *  from the label string. */
  kind: 'per100g' | 'portion';
}

interface FoodDetail {
  source: FoodSource;
  id: string;
  description: string;
  brand?: string;
  servings: ServingOption[];
}

// ─── Open Food Facts ─────────────────────────────────────────────
// OFF is free, key-less, and CORS-enabled. It complements FDC: FDC is
// strong on generic/whole US foods + USDA-verified reference data, OFF
// is strong on branded + international/packaged items (great barcode
// coverage). We query both and merge so the typeahead isn't limited to
// FDC's branded subset. OFF asks API users to send a descriptive UA.
const OFF_USER_AGENT = "MacroLog/1.0 (https://ignia.fit)";
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
const OFF_TIMEOUT_MS = 3500;

interface OffNutriments {
  ["energy-kcal_100g"]?: number;
  ["energy_100g"]?: number;
  proteins_100g?: number;
  carbohydrates_100g?: number;
  fat_100g?: number;
}
interface OffProduct {
  code?: string;
  product_name?: string;
  generic_name?: string;
  brands?: string;
  serving_size?: string;
  serving_quantity?: number | string;
  nutriments?: OffNutriments;
}

async function enforceFoodRateLimit(
  collectionName: string,
  uid: string,
  minIntervalMs: number,
): Promise<void> {
  const ref = db.collection(collectionName).doc(uid);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const last = (snap.data()?.lastCallAt as Timestamp | undefined)?.toMillis() ?? 0;
    const now = Date.now();
    if (last && now - last < minIntervalMs) {
      throw new HttpsError(
        "resource-exhausted",
        "Too many requests. Please slow down.",
        { code: ErrorCode.RATE_LIMITED, retryAfterMs: minIntervalMs - (now - last) },
      );
    }
    tx.set(ref, { lastCallAt: Timestamp.now(), uid }, { merge: true });
  });
}

// Gram conversions for `servingSizeUnit` values FDC reports on Branded
// items. Approximate for liquids (ml ≈ 1 g) — calorie math is per-100g
// and the user can still pick a foodPortions row for higher accuracy.
const SERVING_UNIT_GRAMS: Record<string, number> = {
  g: 1, gram: 1, grams: 1, gm: 1,
  mg: 0.001,
  oz: 28.3495,
  lb: 453.592,
  ml: 1, mlt: 1, "milliliter": 1,
  l: 1000,
};

function gramsFromServingSize(size: number, unit: string): number | null {
  const factor = SERVING_UNIT_GRAMS[unit.toLowerCase()];
  return factor == null ? null : size * factor;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
}

function readKcal(nutrients: FdcFoodNutrient[] | undefined): number | null {
  if (!nutrients) return null;
  for (const n of nutrients) {
    const num = n.nutrientNumber ?? n.nutrient?.number;
    const val = n.amount ?? n.value;
    if (num === NUTRIENT_KCAL && typeof val === "number") return val;
  }
  // Fallback: kJ → kcal.
  for (const n of nutrients) {
    const num = n.nutrientNumber ?? n.nutrient?.number;
    const val = n.amount ?? n.value;
    if (num === NUTRIENT_KJ && typeof val === "number") return val / 4.184;
  }
  return null;
}

function readNutrient(
  nutrients: FdcFoodNutrient[] | undefined,
  nutrientNumber: string,
): number | null {
  if (!nutrients) return null;
  for (const n of nutrients) {
    const num = n.nutrientNumber ?? n.nutrient?.number;
    const val = n.amount ?? n.value;
    if (num === nutrientNumber && typeof val === "number") return val;
  }
  return null;
}

/**
 * Build the user-facing serving list for a food. Always includes a
 * per-100g row (canonical for metric users) and a per-package serving
 * row when the food carries `servingSize` + `householdServingFulltext`.
 * Adds one row per `foodPortions[]` entry so the typeahead's portion
 * picker offers "1 cup, chopped (148g)" etc. directly.
 */
function buildServings(food: FdcFoodDetail): ServingOption[] {
  const nutrients = food.foodNutrients ?? [];
  // FDC FNDDS / SR / Foundation nutrients are per-100g. Branded foods
  // are ALSO per-100g for the nutrients array (despite the labelNutrients
  // sibling being per-serving). Treating the array as per-100g uniformly.
  const kcalPer100g = readKcal(nutrients);
  const proteinPer100g = readNutrient(nutrients, NUTRIENT_PROTEIN);
  const carbsPer100g = readNutrient(nutrients, NUTRIENT_CARBS);
  const fatPer100g = readNutrient(nutrients, NUTRIENT_FAT);

  /** Scale the per-100g macros to a serving ratio, dropping the fields
   *  FDC didn't report rather than writing fake zeros. */
  const macrosAt = (ratio: number) => ({
    protein: Math.round((proteinPer100g ?? 0) * ratio),
    ...(carbsPer100g != null ? { carbs: Math.round(carbsPer100g * ratio) } : {}),
    ...(fatPer100g != null ? { fat: Math.round(fatPer100g * ratio) } : {}),
  });

  const out: ServingOption[] = [];

  if (kcalPer100g != null) {
    out.push({
      label: "100 g",
      grams: 100,
      kcal: Math.round(kcalPer100g),
      ...macrosAt(1),
      kind: 'per100g',
    });
  }

  // Foundation/Branded packaged serving (e.g. "30 g" or "1 cup (240 ml)").
  if (food.servingSize && food.servingSizeUnit && kcalPer100g != null) {
    const sizeStr = food.householdServingFulltext
      ?? `${food.servingSize} ${food.servingSizeUnit}`;
    const gramsApprox = gramsFromServingSize(food.servingSize, food.servingSizeUnit);
    if (gramsApprox != null) {
      const ratio = gramsApprox / 100;
      out.push({
        label: sizeStr.slice(0, 60),
        grams: gramsApprox,
        kcal: Math.round(kcalPer100g * ratio),
        ...macrosAt(ratio),
        kind: 'portion',
      });
    }
  }

  // Household measures (the cup/tbsp/oz/slice rows the user typically wants).
  for (const p of food.foodPortions ?? []) {
    if (!p.gramWeight || p.gramWeight <= 0) continue;
    if (kcalPer100g == null) continue;
    const ratio = p.gramWeight / 100;
    const unitName = p.measureUnit?.name ?? p.measureUnit?.abbreviation ?? "";
    const amount = p.amount != null ? p.amount : 1;
    const desc = p.portionDescription ?? p.modifier ?? "";
    // Compose: "1 cup, chopped (148 g)" with sensible fallbacks.
    const head = unitName && unitName !== "undetermined"
      ? `${amount} ${unitName}${desc ? `, ${desc}` : ""}`
      : desc || "1 serving";
    const label = `${head} (${Math.round(p.gramWeight)} g)`.slice(0, 80);
    out.push({
      label,
      grams: p.gramWeight,
      kcal: Math.round(kcalPer100g * ratio),
      ...macrosAt(ratio),
      kind: 'portion',
    });
  }

  // De-dup by label and cap. FDC sometimes returns dozens of portions
  // (e.g. "1 cup, sliced", "1 cup, diced", "1 cup, chopped") — keep the
  // first 12 so the picker doesn't become unwieldy.
  const seen = new Set<string>();
  const deduped: ServingOption[] = [];
  for (const s of out) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    deduped.push(s);
    if (deduped.length >= 12) break;
  }

  return deduped;
}

function fdcKeyValue(): string {
  // `defineSecret().value()` throws when the secret isn't bound to the
  // function. We surface a typed error so the client can show "ask admin
  // to configure" instead of a 500.
  try {
    const v = fdcApiKey.value();
    if (!v) throw new Error("empty");
    return v;
  } catch {
    throw new HttpsError(
      "failed-precondition",
      "Food search is not configured. Set USDA_FDC_API_KEY via Firebase secrets.",
      { code: ErrorCode.FOOD_API_NOT_CONFIGURED },
    );
  }
}

/** Non-throwing variant: returns the key or null when unset. Lets search
 *  degrade to Open Food Facts only (which needs no key) instead of erroring
 *  out when the USDA key isn't configured. */
function fdcKeyOrNull(): string | null {
  try {
    const v = fdcApiKey.value();
    return v || null;
  } catch {
    return null;
  }
}

/** FDC typeahead search, isolated so a FDC outage degrades to OFF-only
 *  results rather than failing the whole call. Returns [] on any error. */
async function searchFdc(query: string, size: number, key: string): Promise<FoodSearchHit[]> {
  const url = new URL(`${FDC_BASE}/foods/search`);
  url.searchParams.set("api_key", key);
  url.searchParams.set("query", query);
  url.searchParams.set("pageSize", String(size));
  url.searchParams.append("dataType", "Foundation");
  url.searchParams.append("dataType", "SR Legacy");
  url.searchParams.append("dataType", "Survey (FNDDS)");
  url.searchParams.append("dataType", "Branded");
  try {
    const resp = await fetch(url.toString());
    if (!resp.ok) {
      if (resp.status !== 429) {
        console.warn("FDC search non-OK:", resp.status);
      }
      return [];
    }
    const body = (await resp.json()) as FdcSearchResponse;
    return (body.foods ?? []).map((f) => {
      const brand = f.brandName || f.brandOwner;
      const hit: FoodSearchHit = {
        source: "fdc",
        id: String(f.fdcId),
        description: (f.description ?? "").slice(0, 140),
      };
      if (brand) hit.brand = brand.slice(0, 80);
      if (f.dataType) hit.dataType = f.dataType;
      return hit;
    });
  } catch (err) {
    console.warn("FDC search error (degrading to OFF):", err);
    return [];
  }
}

/** Open Food Facts typeahead search. Sorted by scan popularity so the
 *  household-name products surface first. Times out fast and returns []
 *  on any failure so it never stalls or breaks the merged search. */
async function searchOff(query: string, size: number): Promise<FoodSearchHit[]> {
  const url = new URL(OFF_SEARCH_URL);
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(Math.min(size, SEARCH_PAGE_SIZE_MAX)));
  url.searchParams.set("fields", "code,product_name,brands,nutriments");
  url.searchParams.set("sort_by", "unique_scans_n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": OFF_USER_AGENT },
      signal: ctrl.signal,
    });
    if (!resp.ok) return [];
    const body = (await resp.json()) as { products?: OffProduct[] };
    const out: FoodSearchHit[] = [];
    for (const p of body.products ?? []) {
      const code = p.code;
      const name = (p.product_name || p.generic_name || "").trim();
      const n = p.nutriments ?? {};
      // Skip products with no name or no usable energy — they can't be logged.
      if (!code || !name) continue;
      if (n["energy-kcal_100g"] == null && n["energy_100g"] == null) continue;
      const hit: FoodSearchHit = {
        source: "off",
        id: String(code),
        description: name.slice(0, 140),
        dataType: "OFF",
      };
      if (p.brands) hit.brand = String(p.brands).split(",")[0].trim().slice(0, 80);
      out.push(hit);
      if (out.length >= size) break;
    }
    return out;
  } catch {
    return []; // timeout / network — degrade silently to FDC-only
  } finally {
    clearTimeout(timer);
  }
}

/** Interleave FDC and OFF results (so both databases stay visible even
 *  when one fills the page), de-duping by name+brand, capped to `size`. */
function mergeHits(fdc: FoodSearchHit[], off: FoodSearchHit[], size: number): FoodSearchHit[] {
  const out: FoodSearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: FoodSearchHit | undefined) => {
    if (!h || out.length >= size) return;
    const key = `${h.description.toLowerCase()}|${(h.brand ?? "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(h);
  };
  const max = Math.max(fdc.length, off.length);
  for (let i = 0; i < max && out.length < size; i++) {
    push(fdc[i]);
    push(off[i]);
  }
  return out;
}

/** Build the serving list for an Open Food Facts product. OFF nutriments
 *  are per-100g; we add a per-serving row when `serving_quantity` (grams)
 *  is present. Mirrors buildServings()'s "drop unknown macros" rule. */
function buildOffServings(p: OffProduct): ServingOption[] {
  const n = p.nutriments ?? {};
  const KJ_TO_KCAL = 4.184;
  const kcal100 = n["energy-kcal_100g"]
    ?? (n["energy_100g"] != null ? n["energy_100g"] / KJ_TO_KCAL : null);
  if (kcal100 == null) return [];
  const protein100 = n.proteins_100g;
  const carbs100 = n.carbohydrates_100g;
  const fat100 = n.fat_100g;
  const macrosAt = (ratio: number) => ({
    protein: Math.round((protein100 ?? 0) * ratio),
    ...(carbs100 != null ? { carbs: Math.round(carbs100 * ratio) } : {}),
    ...(fat100 != null ? { fat: Math.round(fat100 * ratio) } : {}),
  });
  const out: ServingOption[] = [{
    label: "100 g",
    grams: 100,
    kcal: Math.round(kcal100),
    ...macrosAt(1),
    kind: "per100g",
  }];
  const sq = typeof p.serving_quantity === "string"
    ? parseFloat(p.serving_quantity)
    : p.serving_quantity;
  if (typeof sq === "number" && Number.isFinite(sq) && sq > 0) {
    const ratio = sq / 100;
    const label = (p.serving_size || `${Math.round(sq)} g`).slice(0, 60);
    out.push({
      label,
      grams: sq,
      kcal: Math.round(kcal100 * ratio),
      ...macrosAt(ratio),
      kind: "portion",
    });
  }
  return out;
}

async function fetchOffDetail(code: string): Promise<FoodDetail> {
  const url = `${OFF_PRODUCT_URL}/${encodeURIComponent(code)}.json`
    + "?fields=code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments";
  let resp: Response;
  try {
    resp = await fetch(url, { headers: { "User-Agent": OFF_USER_AGENT } });
  } catch (err) {
    console.error("OFF detail network error:", err);
    throw new HttpsError("unavailable", "Food database unreachable.", { code: ErrorCode.FOOD_DETAIL_FAILED });
  }
  if (!resp.ok) {
    throw new HttpsError("not-found", "Food not found.", { code: ErrorCode.FOOD_NOT_FOUND });
  }
  const body = (await resp.json()) as { status?: number; product?: OffProduct };
  if (!body.product || body.status === 0) {
    throw new HttpsError("not-found", "Food not found.", { code: ErrorCode.FOOD_NOT_FOUND });
  }
  const p = body.product;
  const servings = buildOffServings(p);
  if (servings.length === 0) {
    throw new HttpsError("internal", "No nutrition data available for this food.", { code: ErrorCode.FOOD_NO_NUTRITION });
  }
  const detail: FoodDetail = {
    source: "off",
    id: code,
    description: (p.product_name || p.generic_name || "").slice(0, 140),
    servings,
  };
  if (p.brands) detail.brand = String(p.brands).split(",")[0].trim().slice(0, 80);
  return detail;
}

export const searchFoods = onCall(
  { secrets: [fdcApiKey], maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const uid = request.auth.uid;

    const { query, pageSize } = (request.data ?? {}) as { query?: unknown; pageSize?: unknown };
    if (typeof query !== "string" || query.trim().length < 2) {
      throw new HttpsError(
        "invalid-argument",
        "query must be a string of at least 2 characters.",
        { code: ErrorCode.FOOD_QUERY_INVALID },
      );
    }
    const normalized = normalizeQuery(query);
    const size = typeof pageSize === "number" && pageSize > 0
      ? Math.min(Math.floor(pageSize), SEARCH_PAGE_SIZE_MAX)
      : 20;

    // Cache check happens BEFORE the rate-limit gate so repeat searches
    // skip both the upstream FDC call AND the per-uid throttle window.
    // The rate limit exists to defend the FDC quota; a cache hit doesn't
    // touch FDC, so there's nothing to defend.
    //
    // Doc id is a SHA-1 of `${size}|${normalized}` to keep the id
    // bounded-length regardless of multibyte input. Collisions on a
    // 160-bit hash are not a concern at this scale.
    const cacheKey = createHash("sha1").update(`v2|${size}|${normalized}`).digest("hex");
    const cacheRef = db.collection("foodSearchCache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() as { cachedAt?: Timestamp; hits?: FoodSearchHit[] };
      const cachedAt = data.cachedAt?.toMillis() ?? 0;
      if (cachedAt && Date.now() - cachedAt < SEARCH_CACHE_TTL_MS && Array.isArray(data.hits)) {
        return { hits: data.hits, cached: true };
      }
    }

    // Cache miss → enforce rate limit, then query both databases in
    // parallel and merge. FDC needs a key (skipped if unset); OFF is
    // key-less, so search keeps working even before the USDA key is set.
    await enforceFoodRateLimit("foodSearchRateLimit", uid, SEARCH_MIN_INTERVAL_MS);

    const key = fdcKeyOrNull();
    const [fdcHits, offHits] = await Promise.all([
      key ? searchFdc(normalized, size, key) : Promise.resolve<FoodSearchHit[]>([]),
      searchOff(normalized, size),
    ]);
    const hits = mergeHits(fdcHits, offHits, size);

    // Best-effort cache write. Never block the response on cache failure.
    void cacheRef.set({
      cachedAt: Timestamp.now(),
      query: normalized,
      hits,
    }).catch((err) => console.warn("food search cache write failed:", err));

    return { hits, cached: false };
  },
);

export const getFoodDetail = onCall(
  { secrets: [fdcApiKey], maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const uid = request.auth.uid;

    // Source-aware args. New clients send { source, id }; older clients
    // send { fdcId } — treat that as an FDC lookup for back-compat.
    const data = (request.data ?? {}) as { source?: unknown; id?: unknown; fdcId?: unknown };
    let source: FoodSource;
    let id: string;
    if (data.source === "off" && typeof data.id === "string" && data.id.length > 0) {
      source = "off";
      id = data.id.slice(0, 64);
    } else if (data.source === "fdc" && typeof data.id === "string" && /^\d+$/.test(data.id)) {
      source = "fdc";
      id = data.id;
    } else if (typeof data.fdcId === "number" && Number.isFinite(data.fdcId) && data.fdcId > 0) {
      source = "fdc";
      id = String(Math.floor(data.fdcId));
    } else {
      throw new HttpsError("invalid-argument", "Provide { source, id }.", { code: ErrorCode.FOOD_QUERY_INVALID });
    }

    // Cache check before rate limit (see searchFoods comment). Namespaced
    // by source so FDC ids and OFF barcodes can't collide.
    const cacheRef = db.collection("foodDetailCache").doc(`${source}:${id}`);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const cached = cacheSnap.data() as { detail?: FoodDetail };
      if (cached.detail) return { detail: cached.detail, cached: true };
    }

    // Cache miss → enforce per-uid detail rate limit (separate collection
    // from search so the search→tap handoff doesn't collide on a single
    // window — see the constant declarations near the top).
    await enforceFoodRateLimit("foodDetailRateLimit", uid, DETAIL_MIN_INTERVAL_MS);

    let detail: FoodDetail;
    if (source === "off") {
      detail = await fetchOffDetail(id);
    } else {
      const url = new URL(`${FDC_BASE}/food/${id}`);
      url.searchParams.set("api_key", fdcKeyValue());
      let resp: Response;
      try {
        resp = await fetch(url.toString());
      } catch (err) {
        console.error("FDC detail network error:", err);
        throw new HttpsError("unavailable", "Food database unreachable.", { code: ErrorCode.FOOD_DETAIL_FAILED });
      }
      if (resp.status === 404) {
        throw new HttpsError("not-found", "Food not found.", { code: ErrorCode.FOOD_NOT_FOUND });
      }
      if (resp.status === 429) {
        throw new HttpsError("resource-exhausted", "FDC rate limit hit.", { code: ErrorCode.RATE_LIMITED });
      }
      if (!resp.ok) {
        console.error("FDC detail non-OK:", resp.status, await resp.text().catch(() => ""));
        throw new HttpsError("internal", "Food detail fetch failed.", { code: ErrorCode.FOOD_DETAIL_FAILED });
      }
      const raw = (await resp.json()) as FdcFoodDetail;
      detail = {
        source: "fdc",
        id: String(raw.fdcId),
        description: (raw.description ?? "").slice(0, 140),
        servings: buildServings(raw),
      };
      const brand = raw.brandName || raw.brandOwner;
      if (brand) detail.brand = brand.slice(0, 80);
      if (detail.servings.length === 0) {
        throw new HttpsError(
          "internal",
          "No nutrition data available for this food.",
          { code: ErrorCode.FOOD_NO_NUTRITION },
        );
      }
    }

    void cacheRef.set({ detail, cachedAt: Timestamp.now() }).catch((err) =>
      console.warn("food detail cache write failed:", err));

    return { detail, cached: false };
  },
);
