import {
  translateFoodTerm,
  buildFoodDetail,
  findFoodById,
  loadFoodIndex,
  searchFoodIndex,
  type CompactFoodIndex,
  type FoodDbSource,
  type FoodDetail,
  type FoodSearchHit,
  type IndexedFood,
} from '@macrolog/core';
// A deep import because the barrel's usda-search block is curated and this is
// the one caller of the sliced warm-up (package.json lists the subpath).
import { prepareFoodIndex } from '@macrolog/core/usda-search';

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
 * Locally it is an inverted index (`usda-search.ts`, "Speed"): ~1–3 ms a
 * keystroke for a typical query in Hermes on a Mac, where the linear scan it
 * replaced was 20–60 ms (and ~20–40 ms on the LG G6 QA device). No network at
 * all — so search works with the radio off, which is the same property the
 * barcode cache gained.
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
 * The one-time cost is building the search index, and it is never paid at app
 * boot: {@link warmFoodIndex} spreads it across idle callbacks once Today has
 * settled. It used to be ONE task — `loadFoodIndex` deriving every food's
 * word/stem/segment arrays, 252 ms in Hermes on a Mac and several hundred on
 * a mid-range phone — and idle scheduling only chose when that task started,
 * not how long it held the JS thread, so a tap in that window stalled. Now
 * `loadFoodIndex` derives nothing (~6 ms) and `prepareFoodIndex` builds the
 * index in slices of {@link WARM_SLICE_FOODS} foods (≤7 ms each on the Mac,
 * ~67 ms in all).
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

/** Foods indexed per step. ~5 ms of Hermes on a Mac, so a step on a slow
 *  phone still fits inside the idle period it was given. */
const WARM_SLICE_FOODS = 1000;
/** Steps per idle callback, at most — when the deadline says there is room.
 *  Bounded so a generous `timeRemaining()` cannot rebuild the one long task. */
const WARM_MAX_STEPS = 2;
/** Stop taking steps once less than this is left of the idle period. */
const WARM_MIN_REMAINING_MS = 8;

type IdleDeadline = { timeRemaining?: () => number };

let warming = false;
let warm = false;

function onIdle(cb: (deadline?: IdleDeadline) => void): void {
  const g = globalThis as { requestIdleCallback?: (cb: (d?: IdleDeadline) => void) => number };
  if (g.requestIdleCallback) g.requestIdleCallback(cb);
  else setTimeout(cb, 0);
}

/**
 * Build the search index in idle time, a slice per idle callback, so the JS
 * thread is never held for longer than the idle period it was offered.
 *
 * Called once Today has settled, and again when a search surface mounts in case
 * that has not happened yet; any later call while a warm is running or done is
 * a no-op. Never at module load. The first slice only evaluates the bundled
 * JSON and wraps it; the rest index {@link WARM_SLICE_FOODS} foods at a time.
 *
 * A search that arrives before this finishes is still CORRECT: `searchFoodIndex`
 * completes the remaining slices synchronously before answering, because
 * answering from a partial index would silently leave foods out. The warm is
 * what makes that path rare, not what makes it right.
 *
 * Never throws: a failed warm is not an error — the next real search retries
 * and, if it fails again, surfaces a real message instead of a silent one here.
 */
export function warmFoodIndex(): void {
  if (warming || warm) return;
  warming = true;
  const step = (deadline?: IdleDeadline) => {
    try {
      if (!index) {
        getIndex();
      } else {
        let steps = 0;
        do {
          warm = prepareFoodIndex(index, WARM_SLICE_FOODS);
          steps++;
        } while (
          !warm &&
          steps < WARM_MAX_STEPS &&
          (deadline?.timeRemaining?.() ?? 0) > WARM_MIN_REMAINING_MS
        );
      }
      if (warm) warming = false;
      else onIdle(step);
    } catch {
      warming = false;
    }
  };
  onIdle(step);
}

/** True once the search index is fully built — for tests and instrumentation. */
export function isFoodIndexWarm(): boolean {
  return warm;
}

/**
 * Text search, entirely on device. Never touches the network.
 *
 * Spanish and Portuguese food names are rewritten to the English term the
 * index actually holds before searching (issue #106). The parser has spoken
 * those languages since ADR-0013 while the corpus never has, so
 * "mantequilla de mani" parsed perfectly and then matched nothing.
 *
 * The rewrite lives HERE and not in `searchFoodIndex` on purpose: the ranker is
 * mirrored byte-for-byte in `functions/src/usda-db.ts` and pinned by the golden
 * fixture, and this is a client affordance rather than a ranking rule. It is
 * also mobile-only by ADR-0022 — the web logging app is frozen for features.
 * `translateFoodTerm` returns its input untouched when nothing matches, so
 * every English query is byte-identical to before.
 */
export function localSearch(query: string, pageSize = 20): FoodSearchHit[] {
  return searchFoodIndex(getIndex(), translateFoodTerm(query), pageSize);
}

/**
 * Detail for a bundled USDA food, or `null` when this source is not ours.
 *
 * Returning `null` rather than throwing keeps the decision at the call site:
 * `'off'` ids are barcodes and legitimately need the network, and an exception
 * here would turn a normal fallback into an error path.
 */
export function localGetDetail(source: FoodDbSource, id: string): FoodDetail | null {
  if (source !== 'fdc') return null;
  const food = findFoodById(getIndex(), id);
  return food ? buildFoodDetail(food) : null;
}
