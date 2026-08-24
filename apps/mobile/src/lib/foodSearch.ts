import { httpsCallable } from 'firebase/functions';
import { makeFoodSearch, queryNamesRestaurantChain } from '@macrolog/core';
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
 * Text search — ON DEVICE by default, no network (`localFoodSearch.ts` explains
 * why the server round trip bought nothing for generic food).
 *
 * **One exception: a query that names a chain restaurant goes to the server.**
 * The MenuStat corpus (ADR-0027) is 25,216 items / 4.3 MB and deliberately does
 * NOT ship to the phone — only the 91 chain names do, as a router. So "olive
 * garden" or "chickfila" pays a round trip and gets restaurant results; "banana"
 * stays local, instant, and works with the radio off.
 *
 * If that call fails — offline, or the callable is down — we fall back to the
 * local index rather than surfacing an error. A user who typed a chain name
 * still gets whatever generic matches exist, which is what they had before this
 * feature existed. Degrading to the old behaviour beats an empty screen.
 *
 * Async on purpose: `FoodSearch.tsx` and `MealText.tsx` both `await` this behind
 * a stale-request guard, and the local path being synchronous underneath is an
 * implementation detail.
 */
export const searchFoods = async (query: string, pageSize = 20) => {
  if (queryNamesRestaurantChain(query)) {
    try {
      const hits = await client.search(query, pageSize);
      if (hits.length) return hits;
    } catch {
      // Fall through to the local index — see the note above.
    }
  }
  return localSearch(query, pageSize);
};

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
