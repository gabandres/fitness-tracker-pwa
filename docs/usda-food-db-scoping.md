# Curated USDA food DB — scoping

**Status:** scoped & decided; build gated on one owner-run ingest (multi-GB download can't run from the agent env). **$0 runtime**, CC0 data.
**Goal:** replace the *live USDA FDC API dependency* behind text food-search with a **bundled, curated dataset** — killing the per-search external API call + key + rate limit, and cutting OpenFoodFacts junk-entry complaints with government-verified data. Foundation for a future micronutrient panel.

## Why (the wedge)
Today `searchFoods` / `getFoodDetail` (`functions/src/food-search.ts`, 703 lines) hit the **live FDC API** server-side (FDC key mgmt + caching + rate limiting all in the CF). That's a runtime external dependency with a rate ceiling and quality variance. MacroFactor/Cronometer market "verified data" as trust; we can ship the same CC0 USDA data ourselves at $0. (Barcode stays on OpenFoodFacts — that path is untouched.)

## Dataset decision (from primary-source research, `docs/competitive-feature-scan.md` sibling research)
Ship **SR Legacy + Foundation Foods only**:

| Dataset | ~Foods | Raw CSV | Why in / out |
|---|---|---|---|
| **SR Legacy** | ~7,800 | 54 MB | **IN** — broad generic-food coverage *with household portions + gram weights* (`food_portion.gram_weight`). Frozen (2018), fine for generic foods. |
| **Foundation** | ~few hundred | 32 MB | **IN** — highest-quality lab-analyzed; portion-poor (mostly 100g), so it **augments/overrides** overlapping SR items, not stands alone. |
| Branded | ~2M | 2.9 GB | **OUT** — label-quality (crowdsourced-grade), huge; leave to live OpenFoodFacts/barcode. |
| FNDDS/Survey | ~10k | 1.6 GB | **OUT** — "as-eaten" mixed dishes; large, not our generic-food need. |

**License:** CC0 1.0 (public domain). No permission needed; attribution *requested* not required → add "Data: USDA FoodData Central" credit line in-app. **No restriction on shipping inside the app/functions binary.**

**Size after filtering** to the 4 macro nutrients (kcal 1008 / protein 1003 / fat 1004 / carb 1005) + portions across ~8k foods: **single-digit MB** (research estimate <3 MB). Bundle-friendly.

## Architecture — swap the data source, keep the wire contract
The shared client (`packages/core/src/food-search.ts` `makeFoodSearch`) and both frontends (`apps/mobile/src/lib/foodSearch.ts`, web `CallableGateway`) stay **byte-for-byte unchanged** — same `FoodDbSource`/`FoodSearchHit`/`ServingOption`/`FoodDetail` wire types. We only change what backs the two callables.

**Recommended: CF-hosted bundle (not on-device).** The dataset ships as a compact JSON asset inside the `functions/` deploy; the CF loads it into memory on cold start and searches in-memory. Rationale:
- Keeps the **one shared code path** for web + mobile (parity is a project rule) — an on-device SQLite bundle would work for the Expo app but not the web PWA, forking the search path.
- $0: no FDC API calls, no new infra (no Firestore reads, no extra service).
- Cold-start cost is a one-time ~2–3 MB parse; warm invocations are instant.
- Add `FoodDbSource: 'usda'` alongside `'fdc' | 'off'` (or reuse `'fdc'` since it *is* FDC data — recommend reuse to avoid a wire migration; the id becomes the `fdc_id`).

Search = case-insensitive token match over `description` (+ a simple hit-ranking reusing the existing `food-search` ranking precedent). Detail = look up by `fdc_id`, return pre-computed `ServingOption[]` (per-100g row + household portions), exactly the current shape.

*(Alternative considered — on-device SQLite via `expo-sqlite` for true offline: rejected for v1 because it forks web/mobile and adds a bundle-loading path; revisit if offline search becomes a requirement.)*

## Build plan (3 steps)
1. **Ingest (owner-run once)** — `scripts/ingest-usda.mjs` (written; see header). Downloads SR Legacy + Foundation CSVs, filters `food` + `food_nutrient` (macros) + `food_portion` + `measure_unit`, joins, emits `functions/data/usda-foods.json`. Deterministic; run it and commit the artifact (or gitignore + build-step it). **This is the only step the agent can't run** (multi-GB download).
2. **CF search backend** — behind a flag, back `searchFoods`/`getFoodDetail` with the bundled JSON instead of the FDC API. Keep the FDC API path as fallback for terms with no local hit (optional), or cut it entirely.
3. **Attribution + tests** — "Data: USDA FoodData Central" credit; unit-test the search/rank + detail-shape mapping in `packages/core` (pure), like the existing `food-search.test.ts`.

## Open decisions (small; lock before step 2)
- **Reuse `'fdc'` source vs add `'usda'`** — recommend **reuse** (it is FDC data; avoids a wire-contract migration across both frontends).
- **Keep FDC-live as fallback** for zero-local-hit queries, or go fully offline-of-API? Recommend **fully local** (the whole point is dropping the dependency); measure miss-rate first via the ingest coverage.
- **Ingest artifact: committed vs build-generated.** <3 MB committed is simplest; revisit if it bloats the repo.
