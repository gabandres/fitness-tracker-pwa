import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import { indexFoods, loadFoods, resetCache, type UsdaFood } from "../src/usda-db";
import {
  classifyTokens,
  resolveItem,
  resolveItems,
  resolvePhrase,
  totalsOf,
  type FoodState,
} from "../src/photo-resolve";

/**
 * Two layers, deliberately, and the second one is the one that matters.
 *
 * Fixtures pin the rules in isolation. But every ranking bug this module has
 * had was a bug about the REAL dataset's naming — "Vegetarian, fillet",
 * "Fish, pollock", "Milk, dry, whole" — and no fixture would have contained
 * those rows to be fooled by. So the bulk of this file resolves real phrases
 * against the real committed data and asserts the food that comes back.
 *
 * The ingest is deterministic, so these are stable; a failure here means either
 * a ranking regression or a bad regeneration of the dataset, and both are things
 * that must not reach production quietly.
 */

const food = (over: Partial<UsdaFood> & { id: string; desc: string }): UsdaFood => ({
  dataType: "sr_legacy_food",
  per100: { kcal: 100, protein: 10, carb: 5, fat: 2 },
  portions: [],
  ...over,
});

describe("classifyTokens", () => {
  it("drops filler and quantity words, keeping the food", () => {
    const { clauses, prep } = classifyTokens("a large plate of 2 white rice");
    expect(clauses).toEqual([["white", "rice"]]);
    expect(prep).toEqual([]);
  });

  it("separates preparation from the food itself", () => {
    const { clauses, prep } = classifyTokens("grilled chicken breast");
    expect(clauses).toEqual([["chicken", "breast"]]);
    expect(prep).toEqual(["grilled"]);
  });

  it("splits at connectives so the dish and its garnish are distinct clauses", () => {
    const { clauses } = classifyTokens("grilled salmon with lemon");
    expect(clauses).toEqual([["salmon"], ["lemon"]]);
  });

  it("keeps 'whole', which USDA files under ('Milk, whole')", () => {
    expect(classifyTokens("whole milk").clauses).toEqual([["whole", "milk"]]);
  });

  it("treats knife work as filler, not as part of the food's identity", () => {
    // "shredded" as a core token relaxes to the rarer word and returns
    // "Cheese, parmesan, shredded".
    expect(classifyTokens("shredded lettuce").clauses).toEqual([["lettuce"]]);
  });
});

describe("resolvePhrase — rules, on fixtures", () => {
  const idx = (fs: UsdaFood[]) => loadFixtures(fs);

  it("prefers the cooked row when the photo showed cooked food", () => {
    const foods = idx([
      food({ id: "raw", desc: "Rice, white, long grain, raw", per100: { kcal: 370, protein: 7, carb: 80, fat: 1 } }),
      food({ id: "ckd", desc: "Rice, white, long grain, cooked", per100: { kcal: 130, protein: 2, carb: 28, fat: 0 } }),
    ]);
    expect(resolvePhrase(foods, "white rice", "cooked")?.id).toBe("ckd");
  });

  it("prefers the raw row when the photo showed raw food", () => {
    const foods = idx([
      food({ id: "raw", desc: "Carrots, raw" }),
      food({ id: "ckd", desc: "Carrots, cooked, boiled" }),
    ]);
    expect(resolvePhrase(foods, "carrots", "raw")?.id).toBe("raw");
  });

  it("applies no state preference at all when the state is unknown", () => {
    const foods = idx([
      food({ id: "raw", desc: "Carrots, raw" }),
      food({ id: "ckd", desc: "Carrots, cooked" }),
    ]);
    // Falls back to searchUsda's own ranking, which rewards PLAIN — the tuned
    // typeahead behaviour, rather than a guess in either direction.
    expect(resolvePhrase(foods, "carrots", "unknown")?.id).toBe("raw");
  });

  it("does not penalise a food for a preparation the model itself named", () => {
    const foods = idx([
      food({ id: "raw", desc: "Plantains, raw" }),
      food({ id: "fry", desc: "Plantains, green, fried" }),
    ]);
    expect(resolvePhrase(foods, "fried plantains", "cooked")?.id).toBe("fry");
  });

  it("lets a named preparation outrank the generic cooked preference", () => {
    const foods = idx([
      food({ id: "can", desc: "Fish, tuna, canned" }),
      food({ id: "ckd", desc: "Fish, tuna, cooked" }),
    ]);
    expect(resolvePhrase(foods, "canned tuna", "cooked")?.id).toBe("can");
  });

  it("refuses a relaxed match that only lands on a cut word", () => {
    const foods = idx([
      food({ id: "veg", desc: "Vegetarian, fillet" }),
      food({ id: "fish", desc: "Fish, salmon, cooked" }),
    ]);
    expect(resolvePhrase(foods, "salmon fillet", "cooked")?.id).toBe("fish");
  });

  it("refuses a relaxed match that is only a prefix", () => {
    // "pollo" is a prefix of "pollock". Returning null here is the right answer:
    // the caller keeps the model's own numbers instead of a confident wrong one.
    const foods = idx([food({ id: "p", desc: "Fish, pollock, Alaska, raw" })]);
    expect(resolvePhrase(foods, "arroz con pollo", "cooked")).toBeNull();
  });

  it("keeps the head noun when a compound has to be shortened", () => {
    const foods = idx([
      food({ id: "cher", desc: "Cherries, raw" }),
      food({ id: "tom", desc: "Tomatoes, raw" }),
    ]);
    expect(resolvePhrase(foods, "cherry tomatoes", "raw")?.id).toBe("tom");
  });

  it("resolves the dish, not the garnish, when the whole phrase fails", () => {
    const foods = idx([
      food({ id: "lem", desc: "Lemon, raw" }),
      food({ id: "sal", desc: "Fish, salmon, grilled" }),
    ]);
    expect(resolvePhrase(foods, "grilled salmon with lemon", "cooked")?.id).toBe("sal");
  });

  it("demotes convenience products against the plain cut", () => {
    const foods = idx([
      food({ id: "deli", desc: "Chicken breast, oven-roasted, fat-free, sliced" }),
      food({ id: "plain", desc: "Chicken, breast, meat only, cooked, roasted" }),
    ]);
    expect(resolvePhrase(foods, "grilled chicken breast", "cooked")?.id).toBe("plain");
  });

  it("demotes a branded menu item but not USDA's own boilerplate", () => {
    const branded = idx([
      food({ id: "mcd", desc: "McDONALD'S, Bacon Ranch Salad with Grilled Chicken" }),
      food({ id: "gen", desc: "Salad, chicken, cooked" }),
    ]);
    expect(resolvePhrase(branded, "chicken salad", "cooked")?.id).toBe("gen");

    const boilerplate = idx([
      food({ id: "oj", desc: "Orange juice, raw (Includes foods for USDA's Food Distribution Program)" }),
      food({ id: "conc", desc: "Orange juice, frozen concentrate" }),
    ]);
    expect(resolvePhrase(boilerplate, "orange juice", "raw")?.id).toBe("oj");
  });

  it("returns null rather than guessing when nothing matches", () => {
    const foods = idx([food({ id: "1", desc: "Rice, white, cooked" })]);
    expect(resolvePhrase(foods, "mofongo", "cooked")).toBeNull();
  });
});

describe("resolveItem", () => {
  const foods = loadFixtures([
    food({ id: "rice", desc: "Rice, white, cooked", per100: { kcal: 130, protein: 2.4, carb: 28, fat: 0.3 } }),
  ]);

  it("scales the matched food's macros by the model's portion", () => {
    const r = resolveItem(foods, { name: "white rice", grams: 200, state: "cooked", confidence: "high" });
    expect(r.source).toBe("usda");
    expect(r.fdcId).toBe("rice");
    expect(r.calories).toBe(260);
    expect(r.protein).toBe(4.8);
    expect(r.confidence).toBe(0.9);
    // The user sees WHICH food the numbers came from, not just that they are grounded.
    expect(r.matchedDescription).toBe("Rice, white, cooked");
  });

  it("keeps the model's own numbers when nothing resolves, and says so", () => {
    const r = resolveItem(foods, {
      name: "mofongo",
      grams: 250,
      state: "cooked",
      confidence: "high",
      kcal: 950,
      protein: 10,
      carbs: 120,
      fat: 45,
    });
    expect(r.source).toBe("model");
    expect(r.fdcId).toBeUndefined();
    expect(r.calories).toBe(950);
    expect(r.protein).toBe(10);
    // Confidence is capped: the model's confidence was about recognition, and
    // recognition is exactly what failed.
    expect(r.confidence).toBeLessThanOrEqual(0.5);
  });

  it("never throws on malformed model output", () => {
    const r = resolveItem(foods, { name: "", grams: Number.NaN } as never);
    expect(r.name).toBe("Food");
    expect(r.grams).toBe(0);
    expect(r.calories).toBe(0);
    expect(r.source).toBe("model");
  });

  it("clamps an absurd portion instead of trusting it", () => {
    const r = resolveItem(foods, { name: "white rice", grams: 9_999_999, state: "cooked" });
    expect(r.grams).toBe(5_000);
  });

  it("falls back rather than scaling a zero-gram portion", () => {
    const r = resolveItem(foods, { name: "white rice", grams: 0, state: "cooked", kcal: 42 });
    expect(r.source).toBe("model");
    expect(r.calories).toBe(42);
  });
});

describe("totalsOf", () => {
  it("sums the items the client will render", () => {
    const foods = loadFixtures([
      food({ id: "a", desc: "Rice, white, cooked", per100: { kcal: 130, protein: 2.4, carb: 28, fat: 0.3 } }),
    ]);
    const items = resolveItems(foods, [
      { name: "white rice", grams: 100, state: "cooked" },
      { name: "white rice", grams: 100, state: "cooked" },
    ]);
    expect(totalsOf(items)).toEqual({ calories: 260, protein: 4.8, carbs: 56, fat: 0.6 });
  });

  it("re-rounds the sum, so float error never reaches the wire", () => {
    const foods = loadFixtures([
      food({ id: "a", desc: "Chicken, cooked", per100: { kcal: 206, protein: 25.7, carb: 0, fat: 11 } }),
      food({ id: "b", desc: "Rice, white, cooked", per100: { kcal: 96, protein: 2, carb: 21, fat: 0.2 } }),
    ]);
    const items = resolveItems(foods, [
      { name: "chicken", grams: 150, state: "cooked" },
      { name: "white rice", grams: 180, state: "cooked" },
    ]);
    // Summing one-decimal values in binary floats produces 42.199999999999996.
    for (const v of Object.values(totalsOf(items))) {
      expect(String(v)).toMatch(/^-?\d+(\.\d)?$/);
    }
  });
});

// ─── Against the real committed dataset ───────────────────────────
//
// Every case below is a phrase a vision model plausibly emits for a real photo.
// The assertions are on the FOOD that comes back, because that is what decides
// the macros — asserting a kcal number would just restate the dataset.
describe("the real dataset", () => {
  let foods: ReturnType<typeof loadFoods>;

  beforeAll(() => {
    resetCache();
    foods = loadFoods(fileURLToPath(new URL("../data/usda-foods.json", import.meta.url)));
  });

  const resolved = (phrase: string, state: FoodState) => resolvePhrase(foods, phrase, state)?.desc ?? null;

  it.each([
    // The staples, where raw-vs-cooked is a 3x error and nothing on screen would
    // have shown it. These are the whole reason `state` exists.
    ["white rice", "cooked", /cooked/i],
    ["brown rice", "cooked", /cooked/i],
    ["black beans", "cooked", /cooked/i],
    ["lentils", "cooked", /cooked/i],
    ["pasta", "cooked", /cooked/i],
    ["quinoa", "cooked", /cooked/i],
    ["ground beef", "cooked", /cooked/i],
    // ...and the mirror case: a food normally eaten raw must NOT be pushed to a
    // cooked or a dried row. "Milk, dry, whole" is 8x "Milk, whole".
    ["banana", "raw", /^Banana, raw/i],
    ["whole milk", "raw", /^Milk, whole/i],
    ["avocado", "raw", /^Avocado, raw/i],
    ["shredded lettuce", "raw", /^Lettuce, raw/i],
    ["cherry tomatoes", "raw", /^Tomatoes, raw/i],
    ["red onion", "raw", /^Onions, red, raw/i],
  ])("%s (%s) resolves to %s", (phrase, state, expected) => {
    expect(resolved(phrase, state as FoodState)).toMatch(expected);
  });

  it("resolves a cut to real meat, not to a same-shaped product", () => {
    // "Vegetarian, fillet" is the trap here, and it is a real row.
    expect(resolved("salmon fillet", "cooked")).toMatch(/salmon/i);
    // Deli slices are 79 kcal / 16.8 g protein against 165 / 31 for the cut.
    expect(resolved("grilled chicken breast", "cooked")).toMatch(/chicken breast|chicken, /i);
    expect(resolved("grilled chicken breast", "cooked")).not.toMatch(/sliced|roll/i);
  });

  it("resolves the dish rather than its garnish", () => {
    expect(resolved("grilled salmon with lemon", "cooked")).toMatch(/salmon/i);
  });

  it("honours a named preparation over the generic cooked preference", () => {
    expect(resolved("canned tuna", "cooked")).toMatch(/canned/i);
    expect(resolved("fried plantains", "cooked")).toMatch(/plantain.*fried/i);
  });

  it("returns null for dishes USDA does not carry, instead of a wrong match", () => {
    // These are exactly the Puerto Rican staples the estimation prompt carries
    // reference values for, so the model fallback is informed rather than blind.
    for (const dish of ["mofongo", "tostones", "pernil", "pan sobao", "arroz con pollo"]) {
      expect(resolved(dish, "cooked")).toBeNull();
    }
  });

  it("ignores portion words wrapped around the food", () => {
    expect(resolved("a large plate of white rice", "cooked")).toBe(resolved("white rice", "cooked"));
    expect(resolved("medium serving of black beans", "cooked")).toBe(resolved("black beans", "cooked"));
  });

  it("resolves a whole plate end to end, with grounded macros", () => {
    const items = resolveItems(foods, [
      { name: "grilled chicken breast", grams: 150, state: "cooked", confidence: "high" },
      { name: "white rice", grams: 180, state: "cooked", confidence: "medium" },
      { name: "black beans", grams: 120, state: "cooked", confidence: "medium" },
    ]);
    expect(items.every((i) => i.source === "usda")).toBe(true);
    const total = totalsOf(items);
    // A plate like this is 500-900 kcal. The point of the assertion is the ORDER
    // OF MAGNITUDE: the pre-USDA design and the raw-row bug both land outside it.
    expect(total.calories).toBeGreaterThan(450);
    expect(total.calories).toBeLessThan(950);
    // Protein is the app's core metric and the one LLMs were >60% wrong on.
    expect(total.protein).toBeGreaterThan(35);
    expect(total.protein).toBeLessThan(70);
  });
});

/** Index a fixture list the same way `loadFoods` indexes the real dataset. */
function loadFixtures(fs: UsdaFood[]): ReturnType<typeof loadFoods> {
  return indexFoods(fs);
}
