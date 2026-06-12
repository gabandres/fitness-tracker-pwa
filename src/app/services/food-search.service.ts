import { Injectable, inject } from '@angular/core';
import { CallableGateway } from './callable.gateway';

/** Slim hit returned by the typeahead search. Wire-compatible with the
 *  `FoodSearchHit` interface in functions/src/food-search.ts — keep them
 *  in sync (no shared package between the two projects). */
export interface FoodSearchHit {
  fdcId: number;
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
  fdcId: number;
  description: string;
  brand?: string;
  servings: ServingOption[];
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
      { hits: FoodSearchHit[]; cached: boolean }
    >('searchFoods', { query, pageSize });
    return hits ?? [];
  }

  async getDetail(fdcId: number): Promise<FoodDetail> {
    const { detail } = await this.callables.call<
      { fdcId: number },
      { detail: FoodDetail; cached: boolean }
    >('getFoodDetail', { fdcId });
    return detail;
  }
}
