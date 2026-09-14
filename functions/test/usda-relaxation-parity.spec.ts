import { describe, expect, it } from "vitest";
import {
  buildUsdaDetail,
  indexFoods,
  searchUsda,
  type UsdaFood,
} from "../src/usda-db";
import {
  buildFoodDetail,
  loadFoodIndex,
  searchFoodIndex,
  type CompactFoodIndex,
} from "../../packages/core/src/usda-search";

/**
 * The half of the USDA ranking mirror the golden fixture cannot reach.
 *
 * ## What is already held — and this spec does NOT repeat it
 *
 * `functions/src/usda-db.ts` and `packages/core/src/usda-search.ts` are the
 * same ~100 lines of scoring rules written twice, because `functions/` is not a
 * workspace (ADR-0012). `packages/core/src/__fixtures__/usda-search-golden.json`
 * pins them: `scripts/build-food-golden.mjs` runs the SERVER over 24 curated
 * queries and records the exact ordered ids, core's own suite asserts core
 * reproduces it, `apps/mobile/src/__tests__/food-index-parity.test.ts` asserts
 * the phone does over the real shipped index, and `npm run doctor` re-runs
 * `--check` against the server. That is a genuine two-sided pin over real data,
 * and duplicating any of it here would be a second thing to keep in step for no
 * gain. The scoring rules are NOT re-tested below.
 *
 * ## The drift it structurally misses, and why "structurally"
 *
 * `searchUsda` / `searchFoodIndex` have a SECOND pass. When the strict all-words
 * match returns nothing, both relax the query — drop the words the database
 * cannot honour and retry on the head noun, unless the query names a restaurant
 * chain, in which case both return empty rather than answer a Starbucks
 * question with a generic latte (ADR-0027).
 *
 * That branch runs ONLY on an empty strict result. Every one of the fixture's
 * 24 queries matches strictly — that is what makes them useful ranking cases —
 * so the relaxation pass is not merely uncovered by the fixture, it is
 * unreachable by it, and no amount of extending the corpus with real foods
 * changes that without destroying what the corpus is for.
 * `packages/core/src/usda-search.test.ts` says as much in the comment on its
 * own fallback tests: "the fallback runs only on an EMPTY strict result, which
 * is what keeps every ranking pinned by the golden fixture unchanged."
 *
 * Both sides test this branch — separately, each against its own expectations,
 * neither able to see the other. Core's cases live in `usda-search.test.ts`,
 * the server's chain-refusal case in `functions/test/usda-db.spec.ts:370`. They
 * are not the same cases. Nothing compares the two.
 *
 * A second thing the fixture drops: it records `{ id, description }` per hit
 * and nothing else. The `servings` array rides along on every hit and is built
 * by `buildUsdaDetail` / `buildFoodDetail` — same rounding, same "(148 g)"
 * label suffix, same 12-row cap, per their headers. A divergence there ships
 * different portion macros for the same food from the two backends and the
 * fixture is blind to all of it.
 *
 * ## Why a synthetic corpus here, when the fixture uses the real one
 *
 * The opposite reasoning from `restaurant-chain-parity.spec.ts`, deliberately.
 * There, the server's chain list only EXISTS once the real corpus is indexed,
 * so a fixture would have tested an invented list. Here both sides take their
 * food list as an argument, and what is being held is a BRANCH that real data
 * makes hard to enter on purpose. A hand-built corpus is the only way to sit a
 * query in the gap between "matched nothing" and "unknown word", which is
 * exactly where the relaxation lives. Real-data ranking stays the fixture's
 * job.
 *
 * Emulator-free. It does read `functions/data/restaurant-foods.json`, because
 * the server's chain-refusal guard calls `loadRestaurantFoods()` itself.
 */

const SIZE = 10;

/** One corpus, expressed once, handed to each side in its own input shape. */
const FOODS: UsdaFood[] = [
  {
    id: "honey",
    desc: "Honey",
    dataType: "foundation_food",
    per100: { kcal: 304, protein: 0.3, carb: 82.4, fat: 0 },
    portions: [
      { label: "1 tbsp", grams: 21 },
      { label: "1 tsp", grams: 7 },
    ],
  },
  {
    id: "puree",
    desc: "Tomato puree, canned",
    dataType: "sr_legacy_food",
    per100: { kcal: 38, protein: 1.65, carb: 8.98, fat: 0.21 },
    portions: [{ label: "1 cup", grams: 250 }],
  },
  {
    id: "pb",
    desc: "Peanut butter",
    dataType: "sr_legacy_food",
    per100: { kcal: 588, protein: 25.1, carb: 19.6, fat: 50.4 },
    portions: [{ label: "2 tbsp", grams: 32 }],
  },
  {
    id: "butter",
    desc: "Butter, tub",
    dataType: "sr_legacy_food",
    per100: { kcal: 717, protein: 0.85, carb: 0.06, fat: 81.1 },
    portions: [{ label: "1 pat", grams: 5 }],
  },
  {
    id: "milk",
    desc: "Milk, whole",
    dataType: "foundation_food",
    per100: { kcal: 61, protein: 3.15, carb: 4.8, fat: 3.25 },
    portions: [{ label: "1 cup", grams: 244 }],
  },
  {
    id: "yog",
    desc: "Yogurt, Greek, plain, nonfat",
    dataType: "foundation_food",
    per100: { kcal: 59, protein: 10.2, carb: 3.6, fat: 0.39 },
    portions: [{ label: "1 container", grams: 170 }],
  },
  {
    id: "avocado",
    desc: "Avocado, raw",
    dataType: "foundation_food",
    per100: { kcal: 160, protein: 2, carb: 8.53, fat: 14.7 },
    portions: [{ label: "1 fruit", grams: 201 }],
  },
  {
    id: "thigh",
    desc: "Chicken, thigh, raw",
    dataType: "sr_legacy_food",
    per100: { kcal: 209, protein: 17.3, carb: 0, fat: 15.2 },
    portions: [{ label: "1 thigh", grams: 82 }],
  },
  {
    id: "latte",
    desc: "Coffee, Latte",
    dataType: "survey_fndds_food",
    per100: { kcal: 55, protein: 3, carb: 5.3, fat: 2.2 },
    portions: [{ label: "1 cup", grams: 240 }],
  },
  {
    id: "burrito",
    desc: "Burrito, bean",
    dataType: "survey_fndds_food",
    per100: { kcal: 206, protein: 7.4, carb: 30.2, fat: 6.2 },
    portions: [{ label: "1 burrito", grams: 198 }],
  },
  {
    // Twelve portions plus the per-100 g row: the MAX_SERVINGS cap, which the
    // fixture cannot see because it drops `servings` entirely.
    id: "many",
    desc: "Cereal, ready-to-eat, with many household measures listed for it",
    dataType: "sr_legacy_food",
    per100: { kcal: 379, protein: 7.5, carb: 84.1, fat: 2.4 },
    portions: Array.from({ length: 14 }, (_, i) => ({
      label: `measure ${i + 1}`,
      grams: 10 + i,
    })),
  },
  {
    // 160+ characters, to sit either side of MAX_DESCRIPTION (140).
    id: "long",
    desc:
      "Beverages, carbonated, cola, with an unusually long descriptor tail " +
      "that keeps going well past any sensible truncation point for a picker row",
    dataType: "survey_fndds_food",
    per100: { kcal: 37, protein: 0, carb: 9.6, fat: 0 },
    portions: [{ label: "1 can", grams: 368 }],
  },
];

/** The same corpus in the phone's positional bundle format. */
function toCompact(foods: UsdaFood[]): CompactFoodIndex {
  const dataTypes = [...new Set(foods.map((f) => f.dataType))];
  const labels = [...new Set(foods.flatMap((f) => f.portions.map((p) => p.label)))];
  return {
    v: 1,
    dataTypes,
    labels,
    foods: foods.map((f) => [
      f.id,
      f.desc,
      dataTypes.indexOf(f.dataType),
      f.per100.kcal,
      f.per100.protein,
      f.per100.carb,
      f.per100.fat,
      f.portions.flatMap((p) => [labels.indexOf(p.label), p.grams]),
    ]),
  };
}

const serverIndex = indexFoods(FOODS);
const clientIndex = loadFoodIndex(toCompact(FOODS));

/**
 * Queries that leave the strict pass EMPTY — the only way into the relaxation
 * branch — plus the guards on either side of it.
 */
const QUERIES = [
  // Relaxes: the modifier is unknown, the head noun is not.
  "pure honey",
  "natural peanut butter",
  "organic whole milk",
  "hass avocado",
  "boneless skinless chicken thigh",
  "fresh raw avocado",
  // Refused: naming a chain is not a modifier to drop (ADR-0027).
  "starbucks latte",
  "chipotle burrito bowl",
  "mcdonalds milk",
  "taco bell burrito",
  // Never reaches the branch: strict already matched.
  "greek yogurt",
  "honey",
  "peanut butter",
  "milk whole",
  // Never reaches the branch: a single token, or nothing known at all.
  "zzzz",
  "zzzz qqqq",
  "",
  "   ",
  // Relaxation that must NOT rescue a query into a wrong food: "pure" is a
  // substring of "puree", and the first version of this answered a honey
  // query with tomato puree.
  "pure",
  "puree honey",
];

describe("USDA query-relaxation parity — the branch the golden fixture cannot enter", () => {
  it.each(QUERIES)("returns the same hits, in the same order, for %j", (query) => {
    const server = searchUsda(serverIndex, query, SIZE);
    const client = searchFoodIndex(clientIndex, query, SIZE);

    expect(
      client.map((h) => h.id),
      `functions/src/usda-db.ts and packages/core/src/usda-search.ts relax ${JSON.stringify(query)} ` +
        `differently. The golden fixture cannot see this: every query in it matches strictly, ` +
        `so the fallback pass never runs there.`,
    ).toEqual(server.map((h) => h.id));
  });

  it.each(QUERIES)("returns the same SERVINGS payload for %j", (query) => {
    // The fixture records { id, description } and drops `servings`. Every hit
    // carries pre-scaled portion macros, and a rounding or cap divergence
    // ships different numbers for the same food depending on which backend
    // answered — with the ids and descriptions still matching perfectly.
    const server = searchUsda(serverIndex, query, SIZE);
    const client = searchFoodIndex(clientIndex, query, SIZE);
    expect(client).toEqual(server);
  });

  it("enters the relaxation branch, refuses it, and skips it — across the table", () => {
    // A parity table that never actually reached the branch would be green and
    // worthless, which is the exact failure mode this whole spec exists to
    // fix. So assert the three outcomes are all present.
    const strictOnly = searchUsda(serverIndex, "greek yogurt", SIZE);
    expect(strictOnly.map((h) => h.id)).toEqual(["yog"]);

    // Relaxed: nothing matches "pure" AND "honey"; the head noun survives.
    expect(searchUsda(serverIndex, "pure honey", SIZE).map((h) => h.id)).toEqual(["honey"]);
    expect(searchFoodIndex(clientIndex, "pure honey", SIZE).map((h) => h.id)).toEqual(["honey"]);

    // Refused: "latte" alone would have matched, and both decline to answer.
    expect(searchUsda(serverIndex, "starbucks latte", SIZE)).toEqual([]);
    expect(searchFoodIndex(clientIndex, "starbucks latte", SIZE)).toEqual([]);
  });

  it("builds the same detail for every food — rounding, cap and labels", () => {
    // `buildUsdaDetail` and `buildFoodDetail` are a mirror in their own right;
    // their headers promise "same rounding, same '(148 g)' label suffix, same
    // 12-row cap, so a client cannot tell which backend answered". Nothing
    // was checking that claim.
    for (const food of FOODS) {
      const client = buildFoodDetail(clientIndex.find((f) => f.id === food.id)!);
      const server = buildUsdaDetail(food);
      expect(client, `detail for ${food.id}`).toEqual(server);
    }
  });

  it("caps and truncates identically on the two rows built to probe it", () => {
    // Guards the guard: if MAX_SERVINGS or MAX_DESCRIPTION were raised above
    // what these rows exercise, the comparison above would stop testing the
    // cap and silently become a comparison of two uncapped lists.
    const many = buildUsdaDetail(FOODS.find((f) => f.id === "many")!);
    expect(many.servings.length, "the 14-portion row no longer exercises the cap").toBeLessThan(15);
    const long = searchUsda(serverIndex, "carbonated cola", SIZE)[0];
    expect(long?.description.length, "the long descriptor no longer exercises truncation")
      .toBeLessThan(FOODS.find((f) => f.id === "long")!.desc.length);
  });
});
