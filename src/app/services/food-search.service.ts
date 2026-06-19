import { Injectable, inject } from '@angular/core';
import { CallableGateway } from './callable.gateway';

/** Which food database a result came from. */
export type FoodSource = 'fdc' | 'off';

/** Slim hit returned by the typeahead search. Wire-compatible with the
 *  `FoodSearchHit` interface in functions/src/food-search.ts — keep them
 *  in sync (no shared package between the two projects). */
export interface FoodSearchHit {
  source: FoodSource;
  /** Stable id within the source (FDC fdcId as string, or OFF barcode). */
  id: string;
  description: string;
  brand?: string;
  dataType?: string;
}

/** One row in the portion picker — pre-computed kcal/protein so the
 *  client just picks a row, no math required. `kind` discriminates the
 *  canonical per-100g row from household measures (cup/tbsp/slice), so
 *  the unit-preference sort doesn't need to parse the label. */
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
  source: FoodSource;
  id: string;
  description: string;
  brand?: string;
  servings: ServingOption[];
}

/** Pre-OFF wire shapes keyed only by numeric `fdcId`. Kept so the client
 *  tolerates an old function response during a hosting-ahead-of-functions
 *  deploy; drop once both have shipped the source/id contract. */
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

/**
 * Thin wrapper around the searchFoods / getFoodDetail Cloud Functions.
 * The functions handle FDC API key management, caching, and rate-limit
 * enforcement — clients just call and render.
 */
@Injectable({ providedIn: 'root' })
export class FoodSearchService {
  private readonly callables = inject(CallableGateway);

  async search(query: string, pageSize = 20): Promise<FoodSearchHit[]> {
    const { hits } = await this.callables.call<
      { query: string; pageSize?: number },
      { hits: LegacyOrNewHit[]; cached: boolean }
    >('searchFoods', { query, pageSize });
    return (hits ?? []).map(normalizeHit);
  }

  async getDetail(source: FoodSource, id: string): Promise<FoodDetail> {
    // Send `fdcId` alongside source/id so an older (pre-OFF) getFoodDetail
    // still resolves FDC items if hosting deploys ahead of functions.
    const payload: { source: FoodSource; id: string; fdcId?: number } = { source, id };
    if (source === 'fdc') payload.fdcId = Number(id);
    const { detail } = await this.callables.call<
      typeof payload,
      { detail: LegacyOrNewDetail; cached: boolean }
    >('getFoodDetail', payload);
    return normalizeDetail(detail);
  }
}
