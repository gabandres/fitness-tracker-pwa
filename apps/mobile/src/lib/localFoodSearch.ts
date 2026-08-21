import {
  buildFoodDetail,
  findFoodById,
  loadFoodIndex,
  searchFoodIndex,
  type CompactFoodIndex,
  type FoodDetail,
  type FoodSearchHit,
  type IndexedFood,
} from '@macrolog/core';

/**
 * Text food search, answered ON DEVICE from a bundled index (Tier D).
 *
 * ## What this replaces and why
 *
 * `searchFoods` is a Cloud Function that answers from the SAME bundled USDA
 * dataset this file loads (ADR-0018 retired the live FDC API), and since
 * 2026-08-19 it does not consult Open Food Facts for text either — OFF's 10
 * req/min search limit could not survive debounced typeahead behind one egress
 * IP. So the round trip buys literally nothing but latency:
 *
 *   - **392 ms warm** (304–484), **2,141 ms cold**. Traffic is low, so the
 *     FIRST search of a session is usually the cold one.
 *   - plus the client's own 350 ms debounce, plus a per-uid rate limit, plus a
 *     Firestore cache read on every query.
 *
 * Locally the same scan is 2–4 ms on a workstation and ~20–40 ms on the LG G6
 * QA device, with no network at all — so search now works with the radio off,
 * which is the same property the barcode cache gained.
 *
 * ## What still needs the network
 *
 * **Barcode.** `getFoodDetail(source: 'off', …)` resolves an Open Food Facts
 * product by barcode and is a genuine network lookup — it is not in this
 * dataset and cannot be. Only the `'fdc'` source is served locally, and
 * {@link localGetDetail} says so by falling through rather than guessing.
 *
 * ## Cost, and where it lands
 *
 * The index is ~1.4 MB of JSON in the bundle (334 KB gzipped over the wire) and
 * it is a **Metro-bundled asset**, so it ships over the air like any JS change
 * — no binary needed (see `AGENTS.md`).
 *
 * The resident cost is the decoded index, and it is deliberately paid **lazily,
 * on the first search rather than at startup**. `loadFoodIndex` precomputes the
 * matcher's word/stem/segment arrays for all 13,272 foods; that is the
 * ~70–140 ms (G6) that makes every subsequent keystroke cheap, and doing it
 * during app boot would trade a latency win on a screen the user may never open
 * for a slower cold start on the screen everybody sees.
 */

let index: IndexedFood[] | null = null;

/**
 * Decode the bundled index, once.
 *
 * `require` rather than a static `import` on purpose: Metro would otherwise
 * evaluate the 1.4 MB module as part of this file's own module graph, which
 * pulls the whole cost back into startup and defeats the laziness above.
 *
 * **Requiring the `.json` is also the SMALLEST option — measured, not assumed.**
 * The obvious optimisation is to ship the index as one big escaped string and
 * `JSON.parse` it, on the theory that Hermes stores a single string more
 * cheaply than a 13,272-element array literal. It does not. Android bundle,
 * same data, same day:
 *
 *   | variant                    | .hbc bytes | vs baseline |
 *   |----------------------------|-----------:|------------:|
 *   | no index (baseline)        | 11,095,849 |           — |
 *   | `require` the .json        | 13,140,531 |   +2.0 MB   |
 *   | JSON string + `JSON.parse` | 13,961,046 |   +2.9 MB   |
 *
 * So the string trick costs an extra 820 KB. Do not re-try it.
 */
function getIndex(): IndexedFood[] {
  if (!index) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const raw = require('../../assets/food-index.json') as CompactFoodIndex;
    index = loadFoodIndex(raw);
  }
  return index;
}

/**
 * Warm the index without blocking anything.
 *
 * Call when a search surface is about to open (the add sheet mounting), NOT at
 * app start. `InteractionManager` is deliberately not used here — the caller
 * decides when idle time exists; this only guarantees the work happens at most
 * once and never throws into a render.
 */
export function warmFoodIndex(): void {
  try {
    getIndex();
  } catch {
    // A failed warm is not an error: the next real search will retry and, if it
    // fails again, surface a real message instead of a silent one here.
  }
}

/** True once the index is decoded — for tests and instrumentation only. */
export function isFoodIndexWarm(): boolean {
  return index !== null;
}

/** Text search, entirely on device. Never touches the network. */
export function localSearch(query: string, pageSize = 20): FoodSearchHit[] {
  return searchFoodIndex(getIndex(), query, pageSize);
}

/**
 * Detail for a bundled USDA food, or `null` when this source is not ours.
 *
 * Returning `null` rather than throwing keeps the decision at the call site:
 * `'off'` ids are barcodes and legitimately need the network, and an exception
 * here would turn a normal fallback into an error path.
 */
export function localGetDetail(source: string, id: string): FoodDetail | null {
  if (source !== 'fdc') return null;
  const food = findFoodById(getIndex(), id);
  return food ? buildFoodDetail(food) : null;
}
