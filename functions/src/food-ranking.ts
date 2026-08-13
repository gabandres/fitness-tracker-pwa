/**
 * How merged food-search results are ordered.
 *
 * Its own module for the reason `usda-db.ts` is: `food-search.ts` calls
 * `getFirestore()` at module scope for its result cache, so anything living
 * there cannot be imported by a unit test without an emulator. Ranking is pure,
 * it is the part most likely to be tuned, and it is the part a regression would
 * be hardest to notice — so it belongs where it can be tested for free.
 */
import type { FoodSearchHit } from "./food-search";
import { trustForDataType, trustRank } from "./food-plausibility";

/**
 * Merge the USDA and OFF result lists, best-quality first, de-duped by
 * name+brand and capped to `size`.
 *
 * ## What changed and why
 *
 * This used to interleave strictly round-robin — one USDA, one OFF, repeat —
 * so that "both databases stay visible even when one fills the page". Keeping
 * both visible is right; paying for it at position 2 is not. The old shape put
 * a crowd-sourced entry in the second slot of every search, even when five
 * lab-analyzed rows had matched better, and position 2 is the one a user taps
 * without reading.
 *
 * The rule now is: rank by how much the number can be trusted, then preserve
 * each source's own ordering within a tier. `TIER_QUOTA` still guarantees the
 * community results a place in the page, because the branded coverage only
 * exists there — a keto bar or a store-brand yogurt has no USDA row at all,
 * and a purity-first ranking that buried OFF entirely would make the search
 * worse for exactly the products people scan.
 */
export function mergeHits(fdc: FoodSearchHit[], off: FoodSearchHit[], size: number): FoodSearchHit[] {
  const out: FoodSearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: FoodSearchHit | undefined): boolean => {
    if (!h || out.length >= size) return false;
    const key = `${h.description.toLowerCase()}|${(h.brand ?? "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    out.push(h);
    return true;
  };

  // Rank within a source is the source's own — the USDA scorer's order and
  // OFF's scan-popularity order are both meaningful and neither is re-derived
  // here. `idx` keeps the sort stable inside a tier.
  const scored = [
    ...fdc.map((h, idx) => ({ h, idx, tier: qualityTier(h) })),
    ...off.map((h, idx) => ({ h, idx, tier: qualityTier(h) })),
  ];
  scored.sort((a, b) => b.tier - a.tier || a.idx - b.idx);

  // Reserve part of the page for community results, so branded products stay
  // reachable when a generic query also matches a pile of USDA rows.
  const communityQuota = Math.max(1, Math.floor(size * TIER_QUOTA));
  const community = scored.filter((x) => x.h.source === "off");
  const curated = scored.filter((x) => x.h.source !== "off");

  let taken = 0;
  for (const x of curated) {
    if (out.length >= size - Math.min(communityQuota, community.length)) break;
    if (push(x.h)) taken++;
  }
  for (const x of community) if (push(x.h)) taken++;
  // Anything still short (one source ran dry) is filled from whatever is left,
  // in quality order.
  for (const x of scored) push(x.h);
  return out;
}

/** Fraction of a results page held open for community (OFF) entries. */
const TIER_QUOTA = 0.4;

/** Higher sorts first: a clean lab row, then curated, then anything the
 *  plausibility check flagged. */
export function qualityTier(h: FoodSearchHit): number {
  const base = trustRank(trustForDataType(h.dataType)) * 2;
  return h.suspect ? base - 1 : base;
}
