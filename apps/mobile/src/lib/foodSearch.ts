import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

// Thin client over the searchFoods / getFoodDetail Cloud Functions. Wire
// shapes mirror the PWA's FoodSearchService (src/app/services/food-search.service.ts)
// byte-for-byte — both hit the same us-central1 callables. The functions own
// FDC key management, caching, and rate limiting; the client just renders.

export type FoodSource = 'fdc' | 'off';

export interface FoodSearchHit {
  source: FoodSource;
  /** Stable id within the source (FDC fdcId as string, or OFF barcode). */
  id: string;
  description: string;
  brand?: string;
  dataType?: string;
}

export interface ServingOption {
  label: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs?: number;
  fat?: number;
  kind: 'per100g' | 'portion';
}

export interface FoodDetail {
  source: FoodSource;
  id: string;
  description: string;
  brand?: string;
  servings: ServingOption[];
}

// Pre-OFF wire shapes keyed only by numeric `fdcId`; tolerate an old
// function response during a hosting-ahead-of-functions deploy.
type LegacyOrNewHit = FoodSearchHit & { fdcId?: number };
type LegacyOrNewDetail = FoodDetail & { fdcId?: number };

function normalizeHit(h: LegacyOrNewHit): FoodSearchHit {
  if (h.source && h.id != null) return h;
  return { source: 'fdc', id: String(h.fdcId), description: h.description, brand: h.brand, dataType: h.dataType };
}

function normalizeDetail(d: LegacyOrNewDetail): FoodDetail {
  if (d.source && d.id != null) return d;
  return { source: 'fdc', id: String(d.fdcId), description: d.description, brand: d.brand, servings: d.servings };
}

export async function searchFoods(query: string, pageSize = 20): Promise<FoodSearchHit[]> {
  const fn = httpsCallable<{ query: string; pageSize?: number }, { hits: LegacyOrNewHit[]; cached: boolean }>(
    functions,
    'searchFoods',
  );
  const { data } = await fn({ query, pageSize });
  return (data.hits ?? []).map(normalizeHit);
}

export async function getFoodDetail(source: FoodSource, id: string): Promise<FoodDetail> {
  // Send `fdcId` alongside source/id so an older (pre-OFF) getFoodDetail
  // still resolves FDC items if hosting deploys ahead of functions.
  const payload: { source: FoodSource; id: string; fdcId?: number } = { source, id };
  if (source === 'fdc') payload.fdcId = Number(id);
  const fn = httpsCallable<typeof payload, { detail: LegacyOrNewDetail; cached: boolean }>(functions, 'getFoodDetail');
  const { data } = await fn(payload);
  return normalizeDetail(data.detail);
}

/** Sort servings by the user's unit preference, mirroring the PWA picker:
 *  'us' → household measures first, per-100g last; 'metric' → per-100g first. */
export function sortServings(servings: ServingOption[], unitSystem: 'us' | 'metric' = 'us'): ServingOption[] {
  const rank = (s: ServingOption) =>
    unitSystem === 'metric'
      ? s.kind === 'per100g' ? 0 : 1
      : s.kind === 'per100g' ? 1 : 0;
  return [...servings].sort((a, b) => rank(a) - rank(b));
}
