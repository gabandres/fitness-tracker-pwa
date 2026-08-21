import { httpsCallable } from 'firebase/functions';
import { makeFoodSearch } from '@macrolog/core';
import { functions } from './firebase';
import { localGetDetail, localSearch } from './localFoodSearch';

// Thin adapter over the core food-search client. The wire types, normalize, and
// serving-sort live once in @macrolog/core (shared with the PWA); here we only
// supply the RN transport (httpsCallable) and re-export the surface FoodSearch.tsx
// already imports. The functions own FDC key management, caching, rate limiting.
//
// SINCE TIER D, text search does not use that transport at all — see below.

export type { FoodDbSource, FoodSearchHit, ServingOption, FoodDetail } from '@macrolog/core';
export { sortServings } from '@macrolog/core';
export { warmFoodIndex } from './localFoodSearch';

const client = makeFoodSearch(
  <Res>(name: 'searchFoods' | 'getFoodDetail', payload: Record<string, unknown>) =>
    httpsCallable<Record<string, unknown>, Res>(functions, name)(payload).then((r) => r.data),
);

/**
 * Text search — ON DEVICE, no network (`localFoodSearch.ts` explains why the
 * server round trip bought nothing).
 *
 * Async on purpose despite being synchronous underneath: `FoodSearch.tsx` and
 * `MealText.tsx` both `await` this behind a stale-request guard, and making it
 * sync would mean changing those call sites for no gain — and would move the
 * one-time index decode into a render pass. Keeping the promise also leaves the
 * server path one line away if this ever needs to be reverted.
 */
export const searchFoods = async (query: string, pageSize = 20) => localSearch(query, pageSize);

/**
 * Detail lookup. Bundled USDA foods resolve locally; **Open Food Facts barcodes
 * still go to the server**, because an OFF product is a live lookup that is not
 * and cannot be in the bundled dataset.
 *
 * The local path is a fallback in practice — `searchFoods` already ships
 * `servings` with every hit, so `FoodSearch.tsx` opens the portion picker
 * without calling this at all. It still matters for a hit that arrived without
 * them (an older cached entry, or a preset resolved by id).
 */
export const getFoodDetail: typeof client.getDetail = async (source, id) => {
  const local = localGetDetail(source, id);
  return local ?? client.getDetail(source, id);
};
