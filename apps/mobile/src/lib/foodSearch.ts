import { httpsCallable } from 'firebase/functions';
import { makeFoodSearch } from '@macrolog/core';
import { functions } from './firebase';

// Thin adapter over the core food-search client. The wire types, normalize, and
// serving-sort live once in @macrolog/core (shared with the PWA); here we only
// supply the RN transport (httpsCallable) and re-export the surface FoodSearch.tsx
// already imports. The functions own FDC key management, caching, rate limiting.

export type { FoodDbSource, FoodSearchHit, ServingOption, FoodDetail } from '@macrolog/core';
export { sortServings } from '@macrolog/core';

const client = makeFoodSearch(
  <Res>(name: 'searchFoods' | 'getFoodDetail', payload: Record<string, unknown>) =>
    httpsCallable<Record<string, unknown>, Res>(functions, name)(payload).then((r) => r.data),
);

export const searchFoods = client.search;
export const getFoodDetail = client.getDetail;
