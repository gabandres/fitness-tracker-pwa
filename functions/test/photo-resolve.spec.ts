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

  it("matches the whole query, not just its head noun", () => {
    // From the first real production scan: "tomato sauce" returned
    // "Sauce, steak, tomato based" (95 kcal/100 g) because steak sauce is a
    // sauce and its name is shorter. Every sauce matches "sauce".
    const sauce = resolved("tomato sauce", "cooked");
    expect(sauce).toMatch(/^Tomato sauce/i);
    expect(sauce).not.toMatch(/steak/i);
    // Second production scan, same wrong food by a different route: the model
    // said "tomato-based sauce", and "based" as a core token made steak sauce an
    // EXACT three-token match that no ranking tweak could outscore.
    expect(resolved("tomato-based sauce", "cooked")).toMatch(/^Tomato sauce/i);
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

describe("resolvePhrase does not return a food the phrase never asked for", () => {
  let foods: ReturnType<typeof loadFoods>;

  beforeAll(() => {
    resetCache();
    foods = loadFoods(fileURLToPath(new URL("../data/usda-foods.json", import.meta.url)));
  });

  // `scoreFood` matches substrings, which is right for typeahead and wrong once
  // the whole phrase is known: "apple" is a substring of "snapple", and this
  // used to return "Beverages, SNAPPLE, tea, ... peach, diet" for a piece of
  // fruit. The word-match guard now runs on the exact pass, not just the
  // relaxed one.
  it("matches on whole words, so an apple is not a SNAPPLE", () => {
    const m = resolvePhrase(foods, "green apple");
    expect(m).not.toBeNull();
    expect(m!.desc.toLowerCase()).not.toContain("snapple");
    expect(m!.desc.toLowerCase()).toContain("apple");
  });

  // ── The head noun must name the food, not merely appear in it ────────────
  //
  // `scoreFood` matches substrings and `matchesAsWord` forgives a
  // two-character suffix, both on purpose, so in a 13k-row index there is
  // always SOMETHING that carries every word the user said. Before the
  // identity guard these three were the answer, and each one is a different
  // food from the one asked for.
  it("refuses a food whose identity is not what the phrase named", () => {
    const butter = resolvePhrase(foods, "unsalted butter");
    expect(butter).not.toBeNull();
    // Was: "Pretzels, soft, ready-to-eat, unsalted, buttered" — every token
    // present, and a pretzel.
    expect(butter!.desc.toLowerCase()).not.toContain("pretzel");
    expect(butter!.desc.toLowerCase()).toContain("butter");

    const milk = resolvePhrase(foods, "skim milk");
    expect(milk).not.toBeNull();
    // Was: "Yogurt, plain, skim milk" — "milk" is present, as a modifier of
    // the yogurt it is made from.
    expect(milk!.desc.toLowerCase()).not.toContain("yogurt");

    // Parentheticals are stripped before the identity segments are read, or a
    // brand name inside one ("Kellogg's Nutri-Grain YOGURT Bar") counts as the
    // food's identity.
    const parfait = resolvePhrase(foods, "yogurt with granola");
    expect(parfait).not.toBeNull();
    expect(parfait!.desc.toLowerCase()).toContain("yogurt");
  });

  // The guard is anchored PAST cut words, and this is the half that a naive
  // version gets wrong: anchoring on the literal last token made "bacon
  // strips" abstain outright and sent a cooked chicken breast to a raw row.
  // Both are asserted elsewhere in this file; these pin the anchoring itself.
  it("anchors the identity guard on the food, not on the cut", () => {
    for (const phrase of ["bacon strips", "salmon fillet", "chicken breast"]) {
      expect(resolvePhrase(foods, phrase, "cooked"), phrase).not.toBeNull();
    }
  });

  // "Bacon strip, meatless" is the ONLY row carrying both "bacon" and "strip",
  // so no ranking penalty could ever beat it — a demotion needs something to
  // reorder against. An analogue the query did not ask for is disqualified.
  it("does not return a meat analogue for a meat phrase", () => {
    for (const phrase of ["bacon strips", "bacon"]) {
      const m = resolvePhrase(foods, phrase, "cooked");
      expect(m, phrase).not.toBeNull();
      expect(m!.desc.toLowerCase(), phrase).not.toContain("meatless");
    }
  });

  /**
   * The LAST family in the #76 header: a correct genus that acquires a
   * qualifier nobody asked for. Measured and fixed 2026-08-31.
   *
   * These were never ranking near-misses in the usual sense. Every `Coffee, X`
   * row clears `leadingSegmentsCover` for `coffee`, so the base score is
   * SATURATED and the only term left is `usda-db`'s brevity reward — which
   * ordered `Coffee, Cuban` (13 chars) above `Coffee, brewed` (14) by exactly
   * 0.333 points. No weight on that term fixes it, because `Cuban` really is
   * shorter. What was missing was any signal for "this row names a variety the
   * query did not ask for".
   *
   * Three signals now supply it, all in `photo-resolve.ts`, all PENALTIES OR
   * BONUSES AND NEVER FILTERS — the first attempt at the analogue guard was a
   * filter and made `bacon` resolve to nothing, so a demotion that cannot empty
   * the candidate set is the shape this has to take.
   */
  it("prefers the plain form over an unasked-for named variety", () => {
    // Title case after the first word is USDA's proper-noun marker: a
    // nationality, a style, a cultivar. Lower-case qualifiers describe form.
    for (const phrase of ["coffee", "black coffee"]) {
      const m = resolvePhrase(foods, phrase);
      expect(m, phrase).not.toBeNull();
      expect(m!.desc, phrase).not.toMatch(/Cuban|Turkish|Latte/);
    }
  });

  it("still reaches a named variety when the phrase names it", () => {
    // The waiver is what makes the penalty safe to apply broadly.
    expect(resolvePhrase(foods, "greek yogurt")?.desc).toMatch(/Greek/i);
    expect(resolvePhrase(foods, "cuban coffee")?.desc).toMatch(/Cuban/i);
  });

  /**
   * Sizing regression. At 25 points the variety penalty overrode the raw-state
   * preference and sent `walnuts` from `Nuts, walnuts, English, halves, raw` to
   * `Walnuts, honey roasted` — `English` is the default cultivar, not an
   * unwanted variety. It is 5 points for this reason: a tie-breaker sized like
   * a real signal stops being a tie-breaker and starts overruling evidence.
   */
  it("does not let the variety penalty override the state preference", () => {
    const m = resolvePhrase(foods, "walnuts", "raw");
    expect(m).not.toBeNull();
    expect(m!.desc.toLowerCase()).not.toMatch(/honey roasted|candied/);
  });

  /**
   * USDA's explicitly-unspecified rows are the RIGHT answer to a bare phrase,
   * and `scoreFood` docks them 25 for vagueness — correct for a typeahead list,
   * backwards for a photo. `Beef, bacon, cooked` (219) was beating `Bacon, NS as
   * to type of meat, cooked` (218.333) on that penalty alone. The model said
   * "bacon" and named no animal; the unspecified-type average is the honest
   * match, and returning BEEF bacon for a photo of pork bacon is not.
   */
  it("prefers USDA's unspecified-type row over an arbitrary specific one", () => {
    const bacon = resolvePhrase(foods, "bacon", "cooked");
    expect(bacon).not.toBeNull();
    expect(bacon!.desc.toLowerCase()).not.toMatch(/^beef/);

    // Same mechanism, and these were the worst of the measured set: a bare
    // "taco" returned `Taco, fish` and "cheeseburger" returned `Cheeseburger,
    // from school cafeteria`.
    expect(resolvePhrase(foods, "taco", "cooked")?.desc.toLowerCase()).not.toContain("fish");
    expect(resolvePhrase(foods, "cheeseburger", "cooked")?.desc.toLowerCase()).not.toContain(
      "cafeteria",
    );
  });

  /**
   * USDA writes `skin eaten` / `skin not eaten` as matched pairs and
   * `VAGUE_MARKERS` docks both 25, so the pair was separated only by the four
   * characters of `not ` — brevity handed it to the skin-on row every time.
   * Eating the skin roughly doubles the fat on a breast, and the phrase said
   * nothing about skin.
   */
  it("does not add skin the phrase never mentioned", () => {
    for (const phrase of ["grilled chicken breast", "chicken thigh"]) {
      const m = resolvePhrase(foods, phrase, "cooked");
      expect(m, phrase).not.toBeNull();
      expect(m!.desc.toLowerCase(), phrase).not.toMatch(/(?<!not )skin eaten/);
    }
  });

  // ...but a phrase that ASKS for the analogue must still find it.
  it("still resolves analogues when the phrase asks for one", () => {
    expect(resolvePhrase(foods, "veggie burger", "cooked")?.desc.toLowerCase()).toContain("veggie");
    expect(resolvePhrase(foods, "vegetarian chili", "cooked")?.desc.toLowerCase()).toContain(
      "vegetarian",
    );
  });

  /**
   * Regression, measured in production 2026-08-26 and fixed the same day.
   *
   * `stateBonus` is a RANKING signal (+30 cooked / −15 raw), and a ranking
   * signal cannot beat a row that is the only one carrying the query's tokens.
   * "Chicken, breast, boneless, skinless, raw" is the only row holding both
   * `skinless` and `boneless`, so one extra word the USER typed flipped a
   * cooked plate onto a raw row:
   *
   *     cooked | chicken breast          -> Chicken breast, stewed, skin eaten
   *     cooked | skinless chicken breast -> Chicken, breast, boneless, skinless, RAW
   *
   * Raw chicken breast is ~120 kcal/100 g against ~165–195 cooked, so a 200 g
   * portion read 224 kcal instead of ~330. `state` exists to prevent exactly
   * this, and it was being overruled by an adjective.
   *
   * The fix disqualifies rather than demotes, on the strict pass only — the
   * same shape as the analogue guard, for the same reason.
   */
  it.each([
    "skinless chicken breast",
    "boneless skinless chicken breast",
  ])("does not send a cooked %s to a raw row", (phrase) => {
    const desc = resolvePhrase(foods, phrase, "cooked")?.desc ?? "";
    expect(desc).toMatch(/cooked|grilled|roasted|braised|stewed|baked/i);
    expect(desc).not.toMatch(/raw/i);
  });

  /**
   * The guard must not fire on a row whose "raw" marker is an INGREDIENT FORM.
   * `RAW_MARKERS` includes `dry`/`dried`/`mature seeds`, and USDA routinely puts
   * those on a row that is then explicitly cooked. Filtering on the raw marker
   * alone sent "black beans" to *Black beans, from canned, fat added* — caught
   * by the case list above, and pinned here so the reason survives.
   */
  it("keeps a cooked row that also carries an ingredient-form word", () => {
    expect(resolvePhrase(foods, "black beans", "cooked")?.desc).toMatch(/mature seeds, cooked/i);
    expect(resolvePhrase(foods, "lentils", "cooked")?.desc).toMatch(/mature seeds, cooked/i);
  });

  /**
   * And the strict pass must never turn an answer into a `null`. Many foods
   * have no cooked row at all; the filter runs first and the ORIGINAL pass runs
   * after it, so a filtered-empty candidate set falls back rather than
   * abstaining. This is the failure the analogue guard shipped once already.
   */
  it("still answers for foods that have no cooked row", () => {
    for (const phrase of ["banana", "almonds", "spinach", "lettuce", "raw honey"]) {
      expect(resolvePhrase(foods, phrase, "cooked"), phrase).not.toBeNull();
    }
  });

  // Regression: the word-match guard was first written as a check on the WINNER
  // rather than a filter on the candidates. That returns null for every
  // single-token phrase, because the relaxed pass needs >= 2 tokens to shorten
  // — "bacon" resolved to nothing at all. Filter before ranking, never after.
  it("still resolves single-token phrases", () => {
    for (const phrase of ["bacon", "banana", "rice", "butter", "coffee"]) {
      expect(resolvePhrase(foods, phrase, "cooked"), phrase).not.toBeNull();
    }
  });
});

/** Index a fixture list the same way `loadFoods` indexes the real dataset. */
function loadFixtures(fs: UsdaFood[]): ReturnType<typeof loadFoods> {
  return indexFoods(fs);
}

/**
 * `measured` is the one flag in this pipeline that makes a CLAIM ABOUT THE
 * PHYSICAL WORLD — "this weight came off your scale" — rather than a claim
 * about our own confidence. Everything else here can be wrong and merely be
 * wrong; this one can be wrong and be a lie, so the guard on it is tested.
 *
 * ADR-0029 item 2, and item 4: the review UI renders measured and estimated
 * differently, which is the whole reason the flag must not survive a value
 * change.
 */
describe("measured grams (ADR-0029 item 2)", () => {
  const foods = loadFixtures([
    { id: "1", desc: "Rice, white, cooked", dataType: "sr_legacy_food", per100: { kcal: 130, protein: 2.7, carb: 28, fat: 0.3 }, portions: [] },
  ]);

  it("carries the flag through a USDA match", () => {
    const r = resolveItem(foods, { name: "white rice", grams: 180, state: "cooked", measured: true });
    expect(r.source).toBe("usda");
    expect(r.measured).toBe(true);
  });

  it("carries the flag through the model fallback, because the WEIGHT is what was measured", () => {
    // Nothing in the fixture index matches, so the macros come from the model.
    // The scale reading is still a real measurement of a real portion — the two
    // provenances are independent and collapsing them would lose this case.
    const r = resolveItem(foods, {
      name: "mofongo", grams: 200, state: "cooked", measured: true,
      kcal: 380, protein: 4, carbs: 50, fat: 18,
    });
    expect(r.source).toBe("model");
    expect(r.measured).toBe(true);
  });

  it("is ABSENT rather than false on an ordinary estimate", () => {
    // Absent, not `false`: a client predating this field and one looking at an
    // estimate must read the same thing.
    const r = resolveItem(foods, { name: "white rice", grams: 180, state: "cooked", measured: false });
    expect(r.measured).toBeUndefined();
    expect("measured" in r).toBe(false);
  });

  it("does NOT survive a clamp, because the badge would name a number the scale never showed", () => {
    // MAX_GRAMS is 5,000. A "measured 6200 g" ships as 5,000 either way; what
    // it must not ship as is 5,000 *labelled a measurement*.
    const r = resolveItem(foods, { name: "white rice", grams: 6200, state: "cooked", measured: true });
    expect(r.grams).toBe(5000);
    expect(r.measured).toBeUndefined();
  });

  it("DOES survive rounding to the nearest gram — that is still the measurement", () => {
    // The line is between "the same quantity, written to the precision we
    // display" and "a different quantity". 180.4 g shown as 180 g is the
    // former; 6,200 g shown as 5,000 g is the latter. A guard that killed the
    // flag on rounding would mean almost no real scale reading ever kept it,
    // since scales read to a decimal.
    const r = resolveItem(foods, { name: "white rice", grams: 180.4, state: "cooked", measured: true });
    expect(r.grams).toBe(180);
    expect(r.measured).toBe(true);
  });

  it("does not survive a sub-minimum portion", () => {
    const r = resolveItem(foods, { name: "white rice", grams: 0, state: "cooked", measured: true });
    expect(r.measured).toBeUndefined();
  });

  it("leaves every other field byte-identical to the unmeasured item", () => {
    // The flag is provenance. It must not move a macro, a gram or a confidence
    // — the same property `cardio-energy-independence.test.ts` pins for kcal.
    const base = { name: "white rice", grams: 180, state: "cooked" } as const;
    const plain = resolveItem(foods, { ...base });
    const flagged = resolveItem(foods, { ...base, measured: true });
    expect({ ...flagged, measured: undefined }).toEqual({ ...plain, measured: undefined });
  });
});
