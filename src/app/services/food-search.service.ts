import { Injectable, inject } from '@angular/core';
import { makeFoodSearch, type FoodDbSource, type FoodSearchClient } from '@macrolog/core';
import { CallableGateway } from './callable.gateway';

// The wire types + normalize + serving-sort now live once in @macrolog/core
// (shared with the Expo app). Re-export them here so existing importers keep
// importing from this service. `FoodSource` remains available as an alias for
// the pre-rename name used across the food-search UI.
export type {
  FoodSearchHit,
  ServingOption,
  FoodDetail,
  FoodDbSource,
} from '@macrolog/core';
export type FoodSource = FoodDbSource;

/**
 * Thin Angular adapter over the core food-search client. Supplies the
 * `CallableGateway` as the injected transport; all wire logic (payload
 * assembly, normalization, legacy tolerance) lives in `@macrolog/core`.
 */
@Injectable({ providedIn: 'root' })
export class FoodSearchService {
  private readonly callables = inject(CallableGateway);

  private readonly client: FoodSearchClient = makeFoodSearch(
    <Res>(name: 'searchFoods' | 'getFoodDetail', payload: Record<string, unknown>) =>
      this.callables.call<Record<string, unknown>, Res>(name, payload),
  );

  search(query: string, pageSize = 20) {
    return this.client.search(query, pageSize);
  }

  getDetail(source: FoodDbSource, id: string) {
    return this.client.getDetail(source, id);
  }
}
