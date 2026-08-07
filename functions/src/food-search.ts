/**
 * Food database search + detail lookup.
 *
 * Two callables:
 *   - searchFoods(query, pageSize?) → slim hit list for the typeahead.
 *   - getFoodDetail(source, id)     → full nutrient + portion payload
 *                                     pre-processed into the shape the
 *                                     client renders directly.
 *
 * Two databases back them:
 *   - USDA, from the dataset BUNDLED with this deploy (`./usda-db`). Generic
 *     and whole foods. No network call, no API key, no rate ceiling, and
 *     nothing upstream that can be down.
 *   - Open Food Facts, live. Branded and international packaged items, where
 *     OFF's crowdsourced coverage beats anything shippable in a bundle. Still
 *     proxied through here because OFF is a network dependency worth caching
 *     and rate-limiting.
 *
 * This replaced the live FDC API on both paths. That API needed a key
 * (`USDA_FDC_API_KEY`), was capped at 1,000 req/hour, had no CORS headers, and
 * could fail. The bundled data is the same CC0 source, so the swap costs
 * nothing in provenance and removes all four problems — see
 * `docs/adr/0018-bundled-usda-food-db.md`.
 */
import { createHash } from "node:crypto";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { ErrorCode } from "./error-codes";
import { buildUsdaDetail, findById, loadFoods, searchUsda } from "./usda-db";

const db = getFirestore();
const SEARCH_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // 7 days
// A cached detail never goes stale: bundled USDA rows change only when the
// dataset is regenerated (which mints new ids), and an OFF product is
// re-fetched under its own barcode. So the detail cache has no TTL.
// Per-uid spam guards. Search and detail use SEPARATE collections so
// the common "search → tap result" handoff (which happens in 50-300 ms)
// doesn't trip the detail call's limiter on the search's still-warm
// timestamp. Detail also runs at a shorter interval because it's
// idempotent + cached on the second call.
const SEARCH_MIN_INTERVAL_MS = 500;
const DETAIL_MIN_INTERVAL_MS = 200;
const SEARCH_QUERY_MAX_LEN = 80;
const SEARCH_PAGE_SIZE_MAX = 25;

// ─── Wire contract (mirrors the client) ─────────────────────────
// `FoodDbSource` + the three response shapes below are the wire contract with
// the client at `packages/core/src/food-search.ts`, which redefines them under
// the SAME names. functions/ deploys independently (rootDir: ./src, not a
// workspace) and can't import the un-built @macrolog/core package, so the
// contract is mirrored by hand — keep the two byte-for-byte in sync. The enum
// is `FoodDbSource` on BOTH sides (was `FoodSource` here) so a source-axis
// rename can't silently drift them apart, which it already had.
type FoodDbSource = 'fdc' | 'off';

interface FoodSearchHit {
  /** Which database the hit came from — drives getFoodDetail dispatch. */
  source: FoodDbSource;
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
  source: FoodDbSource;
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

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
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

/** Interleave USDA and OFF results (so both databases stay visible even
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
  { maxInstances: 10 },
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
    // The version prefix is part of the key so a backend swap invalidates every
    // cached page. Bumped to v3 when the bundled USDA DB replaced the live FDC
    // API: a v2 entry can name a Branded fdcId that only the old API could
    // resolve, and serving one would hand the client an id whose detail lookup
    // is now guaranteed to 404.
    const cacheKey = createHash("sha1").update(`v3|${size}|${normalized}`).digest("hex");
    const cacheRef = db.collection("foodSearchCache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() as { cachedAt?: Timestamp; hits?: FoodSearchHit[] };
      const cachedAt = data.cachedAt?.toMillis() ?? 0;
      if (cachedAt && Date.now() - cachedAt < SEARCH_CACHE_TTL_MS && Array.isArray(data.hits)) {
        return { hits: data.hits, cached: true };
      }
    }

    // Cache miss → enforce the rate limit, then merge both databases. The USDA
    // half is a local in-memory scan, so only the OFF call can be slow or fail;
    // `searchOff` returns [] on any error, which now degrades to a still-useful
    // result rather than an empty one.
    await enforceFoodRateLimit("foodSearchRateLimit", uid, SEARCH_MIN_INTERVAL_MS);

    const usdaHits = searchUsda(loadFoods(), normalized, size) as FoodSearchHit[];
    const offHits = await searchOff(normalized, size);
    const hits = mergeHits(usdaHits, offHits, size);

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
  { maxInstances: 10 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const uid = request.auth.uid;

    // Source-aware args. New clients send { source, id }; older clients
    // send { fdcId } — treat that as an FDC lookup for back-compat.
    const data = (request.data ?? {}) as { source?: unknown; id?: unknown; fdcId?: unknown };
    let source: FoodDbSource;
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
      // Bundled lookup — no network, so the only failure is "not in the
      // dataset". That can happen for an id minted by the old live-FDC backend
      // (a Branded item, say) which a client still holds; the cache above
      // answers those it already knows, and this is the honest answer for the
      // rest. Nothing persisted references an fdcId, so no stored log breaks.
      const food = findById(loadFoods(), id);
      if (!food) {
        throw new HttpsError("not-found", "Food not found.", { code: ErrorCode.FOOD_NOT_FOUND });
      }
      detail = buildUsdaDetail(food) as FoodDetail;
    }

    void cacheRef.set({ detail, cachedAt: Timestamp.now() }).catch((err) =>
      console.warn("food detail cache write failed:", err));

    return { detail, cached: false };
  },
);
