import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { loadRestaurantFoods, matchChain } from "../src/menustat-db";
import { words } from "../src/usda-db";
import {
  RESTAURANT_CHAINS,
  matchRestaurantChain,
  queryNamesRestaurantChain,
} from "../../packages/core/src/restaurant-chains";

/**
 * The phone and the server must agree on what counts as "naming a chain".
 *
 * ADR-0027 split restaurant search in two: the 4.3 MB / 25,126-item corpus
 * stays on the server, and the phone bundles only the 91 chain NAMES (~2 KB) to
 * decide whether a query is worth a round trip. `matchRestaurantChain` in
 * `packages/core/src/restaurant-chains.ts` makes that decision; `matchChain` in
 * `functions/src/menustat-db.ts` makes the same decision again on arrival.
 * `functions/` is not a workspace and cannot import the package (ADR-0012), so
 * the two are hand-mirrored and both headers say so.
 *
 * The drift is silent and ONE-DIRECTIONAL, which is what makes it survive. If
 * the phone declines to route a query the server would have answered, the user
 * sees the on-device USDA results — a plausible, non-empty, wrong answer. No
 * error, no empty state, nothing to report. The reverse (the phone routes and
 * the server declines) merely wastes a call and falls back.
 *
 * ## WHY BEHAVIOURAL AND NOT A SOURCE DIFF
 *
 * The `food-search-parity` spec compares normalized declaration text, because
 * what it protects there is a TYPE — two declarations that are supposed to be
 * character-for-character the same thing. That is the wrong instrument here,
 * and it would have been the easy mistake to make:
 *
 *   - The signatures genuinely differ, by design.
 *     `matchRestaurantChain(query: string)` tokenizes internally because the
 *     phone hands it raw user input; `matchChain(index, queryWords)` takes a
 *     prepared index and pre-tokenized words because the server already did
 *     both for the search path it sits inside. Neither is wrong.
 *   - The chain lists have DIFFERENT PROVENANCE. Core's is a literal array in
 *     `restaurant-chains.data.ts`; the server's is derived at index time from
 *     the distinct `chain` values in the corpus itself. There is no text to
 *     compare — the server never spells the names out.
 *   - The shared logic is a rule, not a shape: tight-form first, then
 *     word-wise, longest form first, minimum tight length 4, leading "the"
 *     stripped but medial "the" kept. A rule is checked by running it.
 *
 * So this runs both over a table of queries and requires the same verdict and
 * the same leftover tokens. It also pins the DATA half — the two chain sets —
 * because identical algorithms over different lists still disagree, and that is
 * the more likely drift: the corpus gets regenerated with a new chain and the
 * bundled list is not updated, so the one chain nobody can search for is the
 * new one.
 *
 * Emulator-free. It does read the real 4.3 MB corpus, because the server's
 * chain list only exists once that file is indexed — a synthetic fixture would
 * be testing the algorithm against a list this spec invented, which is exactly
 * the half that cannot drift.
 */

const DATA = fileURLToPath(new URL("../data/restaurant-foods.json", import.meta.url));
let index: ReturnType<typeof loadRestaurantFoods>;

beforeAll(() => {
  index = loadRestaurantFoods(DATA);
});

/**
 * Queries chosen to hit every branch both implementations share, plus the ones
 * that have actually caused trouble.
 */
const QUERIES = [
  // Plain word-wise matches.
  "taco bell",
  "olive garden",
  "taco bell burrito",
  "mcdonalds big mac",
  // Tight form — how people really type these.
  "chickfila",
  "chickfila sandwich",
  "mcdonalds",
  "dominos pizza",
  "littlecaesars",
  // Leading "the" stripped.
  "cheesecake factory",
  "the cheesecake factory",
  "capital grille",
  // Medial "the" kept — the case the strip rule must not eat.
  "jack in the box",
  "jack in the box fries",
  "on the border",
  // Punctuation and case, which tokenizing has to erase identically.
  "McDonald's",
  "WENDY'S",
  "  papa   john's  ",
  "in-n-out",
  "steak 'n shake",
  "chuck e. cheese",
  // Near-misses that must NOT match.
  "banana",
  "chicken breast",
  "",
  "   ",
  "taco",
  "bell pepper",
  "garden salad",
  // The minimum-tight-length-4 guard and short names.
  "ihop",
  "kfc",
  "kfc bowl",
  "bj",
  // A chain name buried inside a longer query.
  "leftover panda express orange chicken",
  // Two chains named at once — both must pick the same one, and which one is
  // decided by the longest-form-first sort, not by luck.
  "taco bell and wendys",
];

describe("restaurant chain matching — client/server parity", () => {
  it("bundles exactly the chains the corpus contains", () => {
    // Core's list is hand-maintained; the server's falls out of the data. A
    // chain in the corpus but not the list is unreachable from the phone.
    const corpus = [...new Set(index.items.map((i) => i.chain))].sort();
    const bundled = [...RESTAURANT_CHAINS].sort();
    expect(
      bundled,
      `packages/core/src/restaurant-chains.data.ts and the distinct chains in ` +
        `functions/data/restaurant-foods.json disagree. A chain the corpus has and ` +
        `the phone does not is a chain no mobile user can search for.`,
    ).toEqual(corpus);
  });

  it.each(QUERIES)("agrees on %j", (query) => {
    // Raw string to the client, server-tokenized words to the server — each
    // side runs the whole path it really runs. `rest` is compared as well as
    // `chain`, because the leftover tokens are what the server ranks items on:
    // agreeing on the chain while disagreeing on what is left of the query
    // would hand "olive garden breadstick" a different result set.
    const client = matchRestaurantChain(query);
    const server = matchChain(index, tokensOf(query));

    expect(client?.chain ?? null, "chain").toBe(server?.chain ?? null);
    expect(client?.rest ?? null, "leftover tokens").toEqual(server?.rest ?? null);
  });

  it("agrees on the boolean the client actually branches on", () => {
    // `queryNamesRestaurantChain` is the one the mobile search path calls; it
    // could be given its own shortcut and stop tracking `matchRestaurantChain`.
    for (const q of QUERIES) {
      expect(queryNamesRestaurantChain(q), q).toBe(matchChain(index, tokensOf(q)) !== null);
    }
  });

  it("matches every bundled chain name typed verbatim", () => {
    // Table-driven cases only cover the chains someone thought to list. This
    // covers all 91, in both directions at once: a name the phone recognises
    // and the server does not, or the reverse, fails here.
    const disagree: string[] = [];
    for (const name of RESTAURANT_CHAINS) {
      const client = matchRestaurantChain(name);
      const server = matchChain(index, tokensOf(name));
      if (client?.chain !== server?.chain) {
        disagree.push(`${name}: client=${client?.chain ?? "null"} server=${server?.chain ?? "null"}`);
      }
    }
    expect(disagree).toEqual([]);
  });

  it("matches every bundled chain name typed without punctuation", () => {
    // The tight path, over all 91. "chickfila", "mcdonalds", "papajohns" —
    // this is the branch the minimum-length-4 guard lives on, and it is the
    // one a mirrored edit is most likely to get subtly different.
    const disagree: string[] = [];
    for (const name of RESTAURANT_CHAINS) {
      const tight = name.toLowerCase().replace(/[^a-z0-9]/g, "");
      const client = matchRestaurantChain(tight);
      const server = matchChain(index, tokensOf(tight));
      if (client?.chain !== server?.chain) {
        disagree.push(`${tight}: client=${client?.chain ?? "null"} server=${server?.chain ?? "null"}`);
      }
    }
    expect(disagree).toEqual([]);
  });

  it("exercises both branches and the no-match case — a green suite that tested nothing would look identical", () => {
    const verdicts = QUERIES.map((q) => matchRestaurantChain(q));
    expect(verdicts.some((v) => v === null), "no non-matching query in the table").toBe(true);
    expect(verdicts.some((v) => v !== null && v.rest.length > 0), "no query with leftovers").toBe(true);
    expect(verdicts.some((v) => v !== null && v.rest.length === 0), "no bare-chain query").toBe(true);
  });
});

/**
 * Tokenize the way the SERVER does, because that is what `matchChain` is
 * really given: `searchMenuStat` and `queryNamesChain` both call it as
 * `matchChain(index, words(query))` with `words` from `functions/src/usda-db`.
 *
 * Deliberately NOT a tokenizer of this file's own, and deliberately not core's
 * either. `matchRestaurantChain` tokenizes internally with core's mirrored
 * `words`, so each side here runs its own copy end to end — which means a
 * divergence between the two `words` implementations surfaces as a chain
 * disagreement above instead of being hidden by handing both sides identical
 * pre-tokenized input.
 */
const tokensOf = (query: string): string[] => words(query);
