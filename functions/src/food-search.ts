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
 *   - Open Food Facts, live — **BARCODE ONLY since 2026-08-19**. Branded and
 *     packaged items, reached by `getFoodDetail` with `source: 'off'`. It is no
 *     longer queried for TEXT search: OFF caps search at 10 req/min against
 *     100 req/min for barcode GETs, and debounced typeahead behind one shared
 *     egress IP cannot live inside that. See the note on `searchOff`.
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
import { assessMacros, isLoggableFood } from "./food-plausibility";
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

export interface FoodSearchHit {
  /** Which database the hit came from — drives getFoodDetail dispatch. */
  source: FoodDbSource;
  /** Stable id within the source: FDC's numeric fdcId (stringified) or an
   *  Open Food Facts barcode. */
  id: string;
  description: string;
  brand?: string;
  dataType?: string;
  /** Set when the plausibility check flagged the numbers but did not reject
   *  them (`@macrolog/core/food-plausibility`) — fibre and sugar-alcohol
   *  products land here legitimately, as do sparse crowd entries. Ranked below
   *  clean results and surfaced to the user rather than hidden. */
  suspect?: boolean;
  /** The portion picker, shipped with the hit so tapping a result needs no
   *  second round trip. Both backends already hold what this needs when the
   *  hit is built and used to discard it, costing the client a separately-cold
   *  `getFoodDetail`. OPTIONAL ON PURPOSE — a hit from an older cache entry or
   *  an older deploy carries none, and the client falls back. */
  servings?: ServingOption[];
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
// OFF is free, key-less, and CORS-enabled, and it is strong exactly where the
// bundled USDA data is weak: branded and international packaged goods. It is
// used for BARCODE LOOKUPS ONLY. Text search used to merge OFF hits with the
// USDA ones; that was removed on 2026-08-19 because OFF allows 10 req/min for
// search against 100 req/min for barcode GETs, and a typeahead funnelled
// through one shared egress IP spends the smaller budget almost immediately.
// OFF asks API users to send a descriptive UA.
const OFF_USER_AGENT = "MacroLog/1.0 (https://ignia.fit)";
const OFF_SEARCH_URL = "https://world.openfoodfacts.org/cgi/search.pl";
const OFF_PRODUCT_URL = "https://world.openfoodfacts.org/api/v2/product";
/**
 * How long the branded (Open Food Facts) leg may hold up a search response.
 *
 * This was 3500 ms, and `searchFoods` awaits it before returning ANYTHING —
 * including the USDA hits, which are an in-memory scan that finishes in
 * milliseconds. So the generic-food half, which is what "banana" or "chicken
 * breast" resolves against, was held hostage by a third-party call for up to
 * 3.5 s on every uncached query, warm instance or cold.
 *
 * OFF is also the wrong shape for this call site, and the ceiling is the reason:
 * their documented limit is **10 requests/minute for search** (100/min for
 * product GETs by barcode), and exceeding it risks an IP ban
 * (https://openfoodfacts.github.io/openfoodfacts-server/api/). This app calls it
 * from debounced typeahead, through ONE shared Cloud Functions egress IP for all
 * users, so the budget is consumed globally and quickly. Probed 2026-08-19:
 * 1308 ms for a good response, and two of three queries came back as an HTML
 * error page after 1837 ms and 273 ms — i.e. paying full latency for nothing,
 * which is what throttling looks like from here.
 *
 * 800 ms was the cap that bounded the damage. THAT DECISION HAS SINCE BEEN MADE:
 * text search no longer calls OFF at all, so this now governs only the barcode
 * detail fetch, where it is a generous ceiling on a single user-initiated GET
 * rather than a tax on every keystroke.
 *
 * A timed-out leg sets `failed`, which suppresses the search cache write, so a
 * throttled response could never be cached and served for the 7-day TTL.
 */
const OFF_TIMEOUT_MS = 800;

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

/** kcal per 100 g from an OFF nutriments block, converting from kilojoules when
 *  that is all the product carries. `null` when it carries neither.
 *
 *  Note this is the LEGITIMATE kJ path — `energy_100g` is documented as
 *  kilojoules. The defect `assessMacros` catches is different: a kJ figure
 *  entered into `energy-kcal_100g`, which no amount of unit handling can
 *  detect, only arithmetic against the macros. */
function offKcalPer100g(n: OffNutriments): number | null {
  const KJ_TO_KCAL = 4.184;
  const kcal = n["energy-kcal_100g"];
  if (kcal != null && Number.isFinite(kcal)) return kcal;
  const kj = n["energy_100g"];
  if (kj != null && Number.isFinite(kj)) return kj / KJ_TO_KCAL;
  return null;
}

function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, " ").slice(0, SEARCH_QUERY_MAX_LEN);
}


/** Open Food Facts typeahead search. Sorted by scan popularity so the
 *  household-name products surface first. Times out fast and returns []
 *  on any failure so it never stalls or breaks the merged search.
 *
 *  UNCALLED SINCE THE BARCODE-ONLY CUT (2026-08-19) and kept on purpose,
 *  for two concrete reasons rather than sentiment. First, the OFF-subset
 *  ingest that would restore branded TEXT search is scoped work, and this
 *  is the shape its filter has to produce. Second, reinstating the merged
 *  search is two lines, which matters while the tradeoff is still being
 *  judged. Delete it if the ingest lands or the cut is made permanent --
 *  a retained function with no caller and no expiry is how dead code
 *  starts reading as live behaviour. `mergeHits` was NOT kept here; it
 *  lives and is tested in ./food-ranking. */
/** Hits, plus whether the upstream call actually completed. The distinction is
 *  load-bearing at the cache write below — see {@link OffResult}. */
interface OffResult {
  hits: FoodSearchHit[];
  /** True when OFF could not be reached or refused the request. NOT the same
   *  as "no products matched", which is a legitimate empty result. */
  failed: boolean;
}

async function searchOff(query: string, size: number): Promise<OffResult> {
  const url = new URL(OFF_SEARCH_URL);
  url.searchParams.set("search_terms", query);
  url.searchParams.set("search_simple", "1");
  url.searchParams.set("action", "process");
  url.searchParams.set("json", "1");
  url.searchParams.set("page_size", String(Math.min(size, SEARCH_PAGE_SIZE_MAX)));
  // `serving_size,serving_quantity` are here so the search response can carry a
  // full portion picker (see FoodSearchHit.servings) — they are the only two
  // fields the detail endpoint asked for that this one did not, and adding them
  // costs nothing: same request, same upstream, two more keys in the projection.
  url.searchParams.set(
    "fields",
    "code,product_name,generic_name,brands,serving_size,serving_quantity,nutriments",
  );
  url.searchParams.set("sort_by", "unique_scans_n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OFF_TIMEOUT_MS);
  try {
    const resp = await fetch(url.toString(), {
      headers: { "User-Agent": OFF_USER_AGENT },
      signal: ctrl.signal,
    });
    if (!resp.ok) return { hits: [], failed: true };
    const body = (await resp.json()) as { products?: OffProduct[] };
    const out: FoodSearchHit[] = [];
    for (const p of body.products ?? []) {
      const code = p.code;
      const name = (p.product_name || p.generic_name || "").trim();
      const n = p.nutriments ?? {};
      // Skip products with no name or no usable energy — they can't be logged.
      if (!code || !name) continue;
      const kcal100 = offKcalPer100g(n);
      if (kcal100 == null) continue;

      // Judge the numbers before showing them. This is crowd data: anyone can
      // type a value, and the dominant defect is a unit error rather than a
      // subtle inaccuracy — kilojoules in the kcal field arrive as 4.184x the
      // truth. Until now the only check was that SOME energy value existed, so
      // a 418 kcal yogurt was indistinguishable from a 100 kcal one.
      const verdict = assessMacros({
        kcal: kcal100,
        protein: n.proteins_100g,
        carb: n.carbohydrates_100g,
        fat: n.fat_100g,
      });
      if (verdict.verdict === "reject") continue;

      const hit: FoodSearchHit = {
        source: "off",
        id: String(code),
        description: name.slice(0, 140),
        dataType: "OFF",
      };
      // Carried to the client so the list can say where a number came from, and
      // used below to rank a questionable entry under a clean one.
      if (verdict.verdict === "suspect") hit.suspect = true;
      if (p.brands) hit.brand = String(p.brands).split(",")[0].trim().slice(0, 80);
      // Reuses the detail path's builder, so a serving list from search and one
      // from `getFoodDetail` are the same rows by construction rather than by
      // two implementations agreeing. It re-runs `isLoggableFood`, which this
      // loop has already passed, and returns [] if it somehow disagrees — in
      // which case the hit simply ships without servings and the client falls
      // back, exactly as it does for an older deploy.
      const servings = buildOffServings(p);
      if (servings.length > 0) hit.servings = servings;
      out.push(hit);
      if (out.length >= size) break;
    }
    return { hits: out, failed: false };
  } catch {
    // Timeout / network — degrade to USDA-only for THIS response, but say so,
    // so the degraded page is not written to a 7-day cache.
    return { hits: [], failed: true };
  } finally {
    clearTimeout(timer);
  }
}


/** Build the serving list for an Open Food Facts product. OFF nutriments
 *  are per-100g; we add a per-serving row when `serving_quantity` (grams)
 *  is present. Mirrors buildServings()'s "drop unknown macros" rule. */
function buildOffServings(p: OffProduct): ServingOption[] {
  const n = p.nutriments ?? {};
  const kcal100 = offKcalPer100g(n);
  if (kcal100 == null) return [];
  const protein100 = n.proteins_100g;
  const carbs100 = n.carbohydrates_100g;
  const fat100 = n.fat_100g;
  // The same gate as search, applied again here — a detail can be opened by id
  // (a barcode scan, a stale client, a saved food) without ever passing through
  // the search filter, and this is the last point before the number becomes a
  // logged meal. Returning no servings surfaces as FOOD_NO_NUTRITION, which is
  // an honest failure; showing a 418 kcal yogurt is not.
  if (!isLoggableFood({ kcal: kcal100, protein: protein100, carb: carbs100, fat: fat100 })) {
    return [];
  }
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
    // Bumped to v4 when hits gained `servings`: a v3 entry is still *correct*
    // (the client falls back to getFoodDetail on a hit without them), but it is
    // slow, and a 7-day TTL would keep every already-cached query paying the
    // extra cold callable for a week after the fix deployed.
    const cacheKey = createHash("sha1").update(`v4|${size}|${normalized}`).digest("hex");
    const cacheRef = db.collection("foodSearchCache").doc(cacheKey);
    const cacheSnap = await cacheRef.get();
    if (cacheSnap.exists) {
      const data = cacheSnap.data() as { cachedAt?: Timestamp; hits?: FoodSearchHit[] };
      const cachedAt = data.cachedAt?.toMillis() ?? 0;
      if (cachedAt && Date.now() - cachedAt < SEARCH_CACHE_TTL_MS && Array.isArray(data.hits)) {
        return { hits: data.hits, cached: true };
      }
    }

    // Cache miss → rate limit, then answer from the bundled USDA dataset alone.
    //
    // TEXT SEARCH NO LONGER CALLS OPEN FOOD FACTS. Barcode still does, and that
    // split is the whole point: OFF publishes a limit of 100 req/min for product
    // GETs by barcode and **10 req/min for SEARCH**
    // (https://openfoodfacts.github.io/openfoodfacts-server/api/), with IP bans
    // for exceeding it. A barcode scan is one user-initiated GET and fits
    // comfortably. Debounced typeahead, funnelled through a single Cloud
    // Functions egress IP shared by every user, does not fit at all — it was
    // spending a global 10/min budget a few keystrokes at a time.
    //
    // The measurement that settled it (2026-08-19): three probes returned
    // 1308 ms with results, and 1837 ms and 273 ms as HTML error pages — i.e.
    // two of three paid full latency and returned nothing, which is what being
    // throttled looks like from the caller. And `searchFoods` AWAITED that
    // before returning the USDA hits, which are an in-memory scan already
    // finished in milliseconds. So the generic-food half — what "banana" or
    // "chicken breast" resolves against — was held up by a branded lookup that
    // was usually failing.
    //
    // What this costs: branded/packaged products no longer appear in TEXT
    // results. They remain reachable by barcode (`getFoodDetail` with
    // `source: 'off'`), by photo scan, and as custom foods or presets.
    //
    // Restoring branded text search means ingesting a filtered OFF subset into
    // the bundled format the way ADR-0018 did for USDA — which is also what OFF
    // themselves tell heavy consumers to do, via the nightly dumps and 14-day
    // delta exports. `searchOff` and `OFF_TIMEOUT_MS` are deliberately KEPT for
    // that, and because reinstating this is one line if the tradeoff is judged
    // wrong.
    await enforceFoodRateLimit("foodSearchRateLimit", uid, SEARCH_MIN_INTERVAL_MS);

    const hits = searchUsda(loadFoods(), normalized, size) as FoodSearchHit[];
    const off = { hits: [] as FoodSearchHit[], failed: false };

    // Best-effort cache write — but NOT when the OFF leg failed.
    //
    // The cache has a 7-day TTL, so caching a degraded page makes a brief
    // upstream outage last a week per query: the branded results silently
    // vanish and keep being served as though they were the real answer. Open
    // Food Facts returned 502/503 on every endpoint while this was being
    // written, which is exactly the window that would have poisoned the cache
    // for every new query a user typed.
    //
    // Skipping the write costs one repeated USDA scan (in-memory, free) and
    // makes the outage last exactly as long as the outage.
    if (!off.failed) {
      void cacheRef.set({
        cachedAt: Timestamp.now(),
        query: normalized,
        hits,
      }).catch((err) => console.warn("food search cache write failed:", err));
    }

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
