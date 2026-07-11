/**
 * Food-search wire module — the shared client for the `searchFoods` /
 * `getFoodDetail` Cloud Functions, consumed by BOTH frontends. The functions
 * own FDC key management, caching, and rate limiting; this module owns the wire
 * types, the legacy-tolerant normalization, the `fdcId`-legacy payload, and the
 * unit-preference serving sort.
 *
 * The transport (Angular `CallableGateway` / RN `httpsCallable`) is injected per
 * frontend via {@link makeFoodSearch} — this module never imports firebase
 * (ADR-0012).
 *
 * WIRE CONTRACT: `FoodDbSource`, `FoodSearchHit`, `ServingOption`, and
 * `FoodDetail` are mirrored by hand in `functions/src/food-search.ts` under the
 * SAME names (that project deploys independently and can't import this un-built
 * workspace package). Keep the two byte-for-byte in sync; the db-source union is
 * `FoodDbSource` on BOTH sides so a rename can't silently drift them.
 */

/**
 * Which food *database* a result came from. Deliberately distinct from the
 * CustomFood *capture* `FoodSource` ('barcode' | 'label' | 'text' | 'manual')
 * in `./types` — same idea, different axis, so it gets its own name.
 */
export type FoodDbSource = 'fdc' | 'off';

/** Slim hit returned by the typeahead search. */
export interface FoodSearchHit {
  source: FoodDbSource;
  /** Stable id within the source (FDC fdcId as string, or OFF barcode). */
  id: string;
  description: string;
  brand?: string;
  dataType?: string;
}

/**
 * One row in the portion picker — pre-computed kcal/protein so the client just
 * picks a row, no math required. `kind` discriminates the canonical per-100g
 * row from household measures (cup/tbsp/slice), so the unit-preference sort
 * doesn't need to parse the label.
 */
export interface ServingOption {
  label: string;
  grams: number;
  kcal: number;
  protein: number;
  /** Absent on detail-cache entries written before the macro expansion. */
  carbs?: number;
  fat?: number;
  kind: 'per100g' | 'portion';
}

export interface FoodDetail {
  source: FoodDbSource;
  id: string;
  description: string;
  brand?: string;
  servings: ServingOption[];
}

/**
 * Pre-OFF wire shapes keyed only by numeric `fdcId`. Kept so the client
 * tolerates an old function response during a hosting-ahead-of-functions
 * deploy; drop once both have shipped the source/id contract.
 */
type LegacyOrNewHit = FoodSearchHit & { fdcId?: number };
type LegacyOrNewDetail = FoodDetail & { fdcId?: number };

export function normalizeHit(h: LegacyOrNewHit): FoodSearchHit {
  if (h.source && h.id != null) return h;
  return { source: 'fdc', id: String(h.fdcId), description: h.description, brand: h.brand, dataType: h.dataType };
}

export function normalizeDetail(d: LegacyOrNewDetail): FoodDetail {
  if (d.source && d.id != null) return d;
  return { source: 'fdc', id: String(d.fdcId), description: d.description, brand: d.brand, servings: d.servings };
}

/**
 * Sort servings by the user's unit preference: 'us' → household measures first,
 * per-100g last; 'metric' → per-100g first.
 */
export function sortServings(servings: ServingOption[], unitSystem: 'us' | 'metric' = 'us'): ServingOption[] {
  const rank = (s: ServingOption) =>
    unitSystem === 'metric'
      ? (s.kind === 'per100g' ? 0 : 1)
      : (s.kind === 'per100g' ? 1 : 0);
  return [...servings].sort((a, b) => rank(a) - rank(b));
}

/**
 * Transport an adapter injects: name a first-party callable + payload → its
 * unwrapped `.data`. Web passes `CallableGateway.call`; mobile wraps
 * `httpsCallable(...)(payload).then(r => r.data)`.
 */
export type FoodSearchTransport = <Res>(
  name: 'searchFoods' | 'getFoodDetail',
  payload: Record<string, unknown>,
) => Promise<Res>;

export interface FoodSearchClient {
  search(query: string, pageSize?: number): Promise<FoodSearchHit[]>;
  getDetail(source: FoodDbSource, id: string): Promise<FoodDetail>;
}

/**
 * Build a food-search client over an injected transport. Owns the wire
 * orchestration — payload assembly (incl. the `fdcId`-legacy field) and the
 * normalize mapping — so each frontend supplies only a one-line adapter.
 */
export function makeFoodSearch(call: FoodSearchTransport): FoodSearchClient {
  return {
    async search(query, pageSize = 20) {
      const data = await call<{ hits?: LegacyOrNewHit[]; cached: boolean }>('searchFoods', { query, pageSize });
      return (data.hits ?? []).map(normalizeHit);
    },
    async getDetail(source, id) {
      // Send `fdcId` alongside source/id so an older (pre-OFF) getFoodDetail
      // still resolves FDC items if hosting deploys ahead of functions.
      const payload: Record<string, unknown> = { source, id };
      if (source === 'fdc') payload['fdcId'] = Number(id);
      const data = await call<{ detail: LegacyOrNewDetail; cached: boolean }>('getFoodDetail', payload);
      return normalizeDetail(data.detail);
    },
  };
}
