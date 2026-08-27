import {
  type FoodDbSource, type FoodDetail, type FoodSearchHit,
  type ParsedFoodItem, type ResolvedMealItem,
  generalisesFood, headAnchoredGeneralisations, rankResolutionHits, resolveMealItem,
} from '@macrolog/core';

/**
 * Turn one parsed utterance item into a scaled draft row — the loop `MealText`
 * used to hold inline.
 *
 * It lives here, and not in `@macrolog/core`, for the same reason
 * `translateFoodTerm` does (see `localFoodSearch.ts`): the ranker in core is
 * mirrored byte-for-byte in `functions/src/usda-db.ts` and pinned by the golden
 * fixture, while this is a client resolution POLICY over that ranker. It is
 * also mobile-only by ADR-0022. The two pure predicates it leans on
 * (`headAnchoredGeneralisations`, `generalisesFood`) do live in core, where
 * they are unit-tested.
 *
 * Extracted so the composed behaviour can be tested against the REAL shipped
 * index — `__tests__/meal-resolution.test.ts` — instead of a test re-writing
 * the loop and then agreeing with itself.
 */

/**
 * The two lookups this needs, injected rather than imported.
 *
 * `foodSearch.ts` pulls in `./firebase` at module scope, so importing it here
 * would drag Firebase initialisation into every test of this policy — and the
 * policy has nothing to do with transport. `MealText` passes the live pair; the
 * test passes the bundled index directly.
 */
export interface ResolutionDeps {
  search: (query: string, pageSize?: number) => Promise<FoodSearchHit[]>;
  detail: (source: FoodDbSource, id: string) => Promise<FoodDetail>;
}

export async function resolveOneItem(
  item: ParsedFoodItem,
  deps: ResolutionDeps,
): Promise<ResolvedMealItem | null> {
  // Search wider than shown, then auto-pick a USDA generic so bare terms
  // ("eggs") don't resolve to a branded/high-fat product (see core).
  const hits = await deps.search(item.food, 10);
  // The best-ranked generic is often the one WITHOUT a portion table — only
  // 37% of Foundation foods carry one — so an utterance whose unit it cannot
  // answer falls through to the next candidate instead of settling for a
  // guess. Lazy on purpose: the loop stops at the first confident resolution,
  // so the common case is still one lookup.
  let r: ResolvedMealItem | null = null;
  let specific = '';
  for (const hit of rankResolutionHits(hits, { unit: item.unit, raw: item.raw }).slice(0, 3)) {
    const d = await deps.detail(hit.source, hit.id);
    const candidate = resolveMealItem(item, d.servings);
    if (candidate && candidate.calories > 0 && !candidate.assumed) return candidate;
    if (r === null && candidate) specific = hit.description ?? '';
    r ??= candidate;
  }
  // Still only a guess: every candidate is a food the corpus knows and cannot
  // portion. "1/2 hass avocado" is the shape — `Avocado, Hass, peeled, raw`
  // has no portion row at all, so a bare count becomes half of 100 g and is
  // flagged, while `Avocado, raw` carries the `1 fruit (150 g)` row the user
  // needs and is never a candidate, because "hass" is not in it and `scoreFood`
  // is an AND. So retry against the head noun alone.
  if (r?.assumed) return (await generalised(item, specific, deps)) ?? r;
  return r;
}

/**
 * Second pass: search each head-anchored generalisation, and accept only a
 * CONFIDENT resolution whose food generalises `specific` rather than replacing
 * it. Returns null when nothing qualifies, so the caller keeps its honest
 * `assumed` row instead of a confident wrong one.
 *
 * The guard is not decoration. Measured against the shipped index, retrying on
 * `assumed` ALONE fixed the avocado and broke four other utterances — greek
 * yogurt became whole milk, a bell pepper became a hot pepper, a boneless
 * skinless thigh became a fried coated one, and two roma tomatoes became
 * 8 kcal. `generalisesFood` in core carries that table and the reasoning.
 */
async function generalised(
  item: ParsedFoodItem,
  specific: string,
  deps: ResolutionDeps,
): Promise<ResolvedMealItem | null> {
  for (const query of headAnchoredGeneralisations(item.food)) {
    const hits = await deps.search(query, 10);
    for (const hit of rankResolutionHits(hits, { unit: item.unit, raw: item.raw }).slice(0, 3)) {
      if (!generalisesFood(specific, hit.description ?? '', item.food)) continue;
      const d = await deps.detail(hit.source, hit.id);
      const candidate = resolveMealItem(item, d.servings);
      if (candidate && candidate.calories > 0 && !candidate.assumed) return candidate;
    }
  }
  return null;
}
