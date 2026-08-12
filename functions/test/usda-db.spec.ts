import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import {
  buildUsdaDetail,
  findById,
  indexFoods,
  loadFoods,
  normalizeQuery,
  resetCache,
  scoreFood,
  searchUsda,
  type UsdaFood,
} from "../src/usda-db";

// Pure tests — no emulator needed. Two layers:
//   1. hand-built fixtures, which pin the ranking and mapping rules exactly;
//   2. the REAL committed dataset, which is the thing users actually search,
//      and which no fixture can stand in for. The ingest is deterministic, so
//      asserting against it is stable — and it catches a bad regeneration,
//      which is the failure mode most likely to reach production unnoticed.

const food = (over: Partial<UsdaFood> & { id: string; desc: string }): UsdaFood => ({
  dataType: "sr_legacy_food",
  per100: { kcal: 100, protein: 10, carb: 5, fat: 2 },
  portions: [],
  ...over,
});

describe("normalizeQuery", () => {
  it("lowercases, trims, and collapses whitespace", () => {
    expect(normalizeQuery("  Chicken   BREAST \n")).toBe("chicken breast");
  });
});

describe("scoreFood", () => {
  const idx = (f: UsdaFood) => indexFoods([f])[0];

  it("requires every token to match", () => {
    const chicken = idx(food({ id: "1", desc: "Chicken, breast, raw" }));
    expect(scoreFood(chicken, ["chicken", "breast"], "chicken breast")).not.toBeNull();
    // "beef" appears nowhere, so the food is not a match at all.
    expect(scoreFood(chicken, ["chicken", "beef"], "chicken beef")).toBeNull();
  });

  it("ranks whole word above word-prefix above mid-word substring", () => {
    const whole = idx(food({ id: "1", desc: "Rice, white" }));
    const prefix = idx(food({ id: "2", desc: "Ricecake, plain" }));
    const infix = idx(food({ id: "3", desc: "Enriched-rice blend" }));
    const s = (f: ReturnType<typeof idx>) => scoreFood(f, ["rice"], "rice")!;
    expect(s(whole)).toBeGreaterThan(s(prefix));
    expect(s(prefix)).toBeGreaterThan(s(infix));
  });

  it("demotes vague FNDDS entries", () => {
    const plain = idx(food({ id: "1", desc: "Milk, whole", dataType: "survey_fndds_food" }));
    const vague = idx(food({ id: "2", desc: "Milk, NFS", dataType: "survey_fndds_food" }));
    expect(scoreFood(plain, ["milk"], "milk")!).toBeGreaterThan(
      scoreFood(vague, ["milk"], "milk")!,
    );
  });

  it("prefers a lab-analyzed source when the text match is equal", () => {
    const base = { desc: "Butter, salted", per100: { kcal: 717, protein: 1, carb: 0, fat: 81 } };
    const foundation = idx(food({ id: "1", ...base, dataType: "foundation_food" }));
    const survey = idx(food({ id: "2", ...base, dataType: "survey_fndds_food" }));
    expect(scoreFood(foundation, ["butter"], "butter")!).toBeGreaterThan(
      scoreFood(survey, ["butter"], "butter")!,
    );
  });
});

describe("searchUsda", () => {
  const foods = indexFoods([
    food({ id: "10", desc: "Bananas, raw" }),
    food({ id: "11", desc: "Babyfood, bananas with tapioca" }),
    food({ id: "12", desc: "Banana bread, prepared from recipe, made with margarine" }),
    food({ id: "13", desc: "Chicken, breast, raw" }),
  ]);

  it("puts the plain generic food first", () => {
    expect(searchUsda(foods, "banana", 5)[0].description).toBe("Bananas, raw");
  });

  it("respects the size cap", () => {
    expect(searchUsda(foods, "banana", 2)).toHaveLength(2);
  });

  it("excludes non-matches rather than ranking them low", () => {
    const hits = searchUsda(foods, "banana", 10);
    expect(hits.map((h) => h.id)).not.toContain("13");
  });

  it("returns nothing for a query with no word characters", () => {
    expect(searchUsda(foods, "!!!", 5)).toEqual([]);
  });

  it("is stable: equal-scoring foods keep a deterministic order", () => {
    const tied = indexFoods([
      food({ id: "200", desc: "Kale, raw" }),
      food({ id: "100", desc: "Kale, raw" }),
    ]);
    expect(searchUsda(tied, "kale", 5).map((h) => h.id)).toEqual(["100", "200"]);
  });

  it("emits the fdc wire source so the client dispatch is unchanged", () => {
    expect(searchUsda(foods, "banana", 1)[0].source).toBe("fdc");
  });
});

describe("buildUsdaDetail", () => {
  it("always leads with the canonical per-100g row", () => {
    const d = buildUsdaDetail(food({ id: "1", desc: "Oats, raw" }));
    expect(d.servings[0]).toEqual({
      label: "100 g",
      grams: 100,
      kcal: 100,
      protein: 10,
      carbs: 5,
      fat: 2,
      kind: "per100g",
    });
  });

  it("scales macros proportionally and labels the gram weight", () => {
    const d = buildUsdaDetail(
      food({
        id: "1",
        desc: "Egg, whole, raw",
        per100: { kcal: 143, protein: 12.4, carb: 1, fat: 10 },
        portions: [{ label: "1 egg", grams: 50 }],
      }),
    );
    expect(d.servings[1]).toEqual({
      label: "1 egg (50 g)",
      grams: 50,
      kcal: 72, // 143 × 0.5 → 71.5, rounded
      protein: 6,
      carbs: 1,
      fat: 5,
      kind: "portion",
    });
  });

  it("drops zero and negative gram weights", () => {
    const d = buildUsdaDetail(
      food({
        id: "1",
        desc: "Soup",
        portions: [
          { label: "Quantity not specified", grams: 0 },
          { label: "1 cup", grams: 240 },
        ],
      }),
    );
    expect(d.servings.map((s) => s.label)).toEqual(["100 g", "1 cup (240 g)"]);
  });

  it("de-dupes repeated labels and caps at 12 rows", () => {
    const d = buildUsdaDetail(
      food({
        id: "1",
        desc: "Many portions",
        portions: Array.from({ length: 20 }, (_, i) => ({ label: `p${i}`, grams: 10 + i })),
      }),
    );
    expect(d.servings).toHaveLength(12);
    expect(new Set(d.servings.map((s) => s.label)).size).toBe(12);
  });

  it("truncates an over-long description to the wire limit", () => {
    const d = buildUsdaDetail(food({ id: "1", desc: "x".repeat(300) }));
    expect(d.description).toHaveLength(140);
  });
});

// ─── Against the real committed dataset ───────────────────────────
describe("the bundled dataset", () => {
  let foods: ReturnType<typeof loadFoods>;

  beforeAll(() => {
    resetCache();
    foods = loadFoods(fileURLToPath(new URL("../data/usda-foods.json", import.meta.url)));
  });

  it("loads every food with usable macros", () => {
    expect(foods.length).toBeGreaterThan(12_000);
    for (const f of foods) {
      expect(f.per100.kcal).toBeGreaterThan(0);
      // A negative macro is nonsense to render; the ingest clamps carbohydrate
      // "by difference", which goes slightly below zero on some meat rows.
      for (const v of Object.values(f.per100)) expect(v).toBeGreaterThanOrEqual(0);
    }
  });

  it("has unique ids, so detail lookup is unambiguous", () => {
    expect(new Set(foods.map((f) => f.id)).size).toBe(foods.length);
  });

  it("never renders an FNDDS numeric portion code as a label", () => {
    // FNDDS keeps display text in `portion_description` and an internal code in
    // `modifier`; reading the wrong column yields labels like "10205".
    const codes = foods.flatMap((f) => f.portions.filter((p) => /^\d{4,}$/.test(p.label)));
    expect(codes).toEqual([]);
  });

  it("contains all three source datasets", () => {
    const types = new Set(foods.map((f) => f.dataType));
    expect(types).toEqual(
      new Set(["foundation_food", "sr_legacy_food", "survey_fndds_food"]),
    );
  });

  // The plain form of the food, not a derivative, a dish that mentions it, or a
  // lab-grade outlier. Each of these was wrong at some point while the ranking
  // was being tuned, so they are regression locks, not decoration.
  it.each([
    ["egg", /^Egg, whole, raw/],          // was "Egg, yolk, dried" (654 kcal)
    ["banana", /^Bananas?, raw$/],
    ["milk", /^Milk, whole$/],            // was "Milk, sheep, fluid"
    ["spinach", /^Spinach, raw$/],        // was "Spinach, creamed"
    ["broccoli", /^Broccoli, raw$/],      // was "Broccoli slaw salad"
    ["beef", /^Beef, /],                  // was "Beef jerky"
    ["oats", /^Oats, /],
    ["apple", /^Apple, raw$/],
    ["olive oil", /^Olive oil$/],
    ["peanut butter", /^Peanut butter$/],
    // USDA inverts English compounds, so these only work via the head-segment
    // rule: the query's LAST word is the descriptor list's head.
    ["cheddar cheese", /^Cheese, [Cc]heddar/],   // was "Cheese spread, American…"
    ["white rice", /^Rice, white/],              // was "Beans and white rice"
    ["brown rice", /^Rice, brown/],
    ["ground beef", /^Beef, .*ground/],          // was "Spanish rice with ground beef"
    ["cottage cheese", /cottage cheese|Cheese, cottage/i],
    ["sweet potato", /^Sweet potato/],
    // Filed under a genus head, so the match is the SECOND segment.
    ["tuna", /^Fish, tuna/],                     // was "Tuna salad sandwich wrap"
    ["salmon", /^Fish, salmon/],                 // was "Salmon, sockeye, canned"
    // USDA spells one food two ways — a compound head ("Chicken breast, …") or
    // spread across leading segments ("Chicken, breast, …"). Ranking the
    // compound higher put deli slices above actual chicken breast.
    ["chicken breast", /^Chicken, breast/],      // was "Chicken breast, …, sliced"
    // Matching the whole query must beat matching only its head noun, by more
    // than a shorter description can win back. Every sauce matches "sauce".
    ["tomato sauce", /^Tomato sauce/],           // was "Sauce, steak, tomato based"
  ])("ranks the plain form first for %j", (query, expected) => {
    const [top] = searchUsda(foods, query, 5);
    expect(top, `no hit for "${query}"`).toBeDefined();
    expect(top.description).toMatch(expected);
  });

  // People type the singular; USDA files the plural. Without folding, the
  // singular only matched as a word prefix and lost badly — "carrot" returned
  // "Carrot, dehydrated" and "onion" returned "Bread, onion".
  it.each([
    ["carrot", /^Carrots, raw$/],
    ["onion", /^Onions, /],
    ["tomato", /^Tomatoes, raw$/],
    ["blueberry", /^Blueberries, raw$/],   // -ies → -y
    ["strawberry", /^Strawberries, raw$/],
    ["peach", /^Peach(es)?, /],            // -es after ch
  ])("folds the plural USDA files under for %j", (query, expected) => {
    expect(searchUsda(foods, query, 1)[0].description).toMatch(expected);
  });

  it("gives the singular and plural query the same top hit", () => {
    for (const [a, b] of [["carrot", "carrots"], ["egg", "eggs"], ["blueberry", "blueberries"]]) {
      expect(searchUsda(foods, a, 1)[0].id, `"${a}" vs "${b}"`).toBe(
        searchUsda(foods, b, 1)[0].id,
      );
    }
  });

  it("keeps a bare ingredient query off multi-ingredient dishes", () => {
    // Connectives ("with"/"and"/"or") mark a composite dish; commas mark a
    // descriptor list. The top few hits for an ingredient should be the food.
    for (const q of ["chicken breast", "white rice", "tuna"]) {
      const [top] = searchUsda(foods, q, 1);
      expect(top.description, `"${q}" returned a dish`).not.toMatch(/\b(with|and)\b/i);
    }
  });

  it("resolves a real food end to end, search → detail", () => {
    const [hit] = searchUsda(foods, "egg", 1);
    const detail = buildUsdaDetail(findById(foods, hit.id)!);
    expect(detail.id).toBe(hit.id);
    expect(detail.servings[0].kind).toBe("per100g");
    // A whole raw egg is ~140-160 kcal/100 g; this pins the ingest's units.
    expect(detail.servings[0].kcal).toBeGreaterThan(120);
    expect(detail.servings[0].kcal).toBeLessThan(180);
  });

  it("agrees with USDA reference values for a well-known food", () => {
    const chicken = foods.find((f) => f.desc === "Chicken, breast, boneless, skinless, raw");
    expect(chicken).toBeDefined();
    expect(chicken!.per100.protein).toBeGreaterThan(20);
    expect(chicken!.per100.kcal).toBeGreaterThan(90);
    expect(chicken!.per100.kcal).toBeLessThan(140);
  });

  it("answers a typeahead query fast enough to run per keystroke", () => {
    const start = Date.now();
    for (const q of ["chi", "chick", "chicken", "chicken b", "chicken br"]) {
      searchUsda(foods, q, 20);
    }
    // Five keystrokes over 13k foods. Generous bound: this guards against an
    // accidental O(n²), not against normal machine variance.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("finds a match for the everyday foods a new user types first", () => {
    const staples = [
      "milk", "bread", "apple", "oatmeal", "yogurt", "salmon", "beef",
      "potato", "spinach", "almonds", "coffee", "cheddar cheese", "olive oil",
    ];
    for (const q of staples) {
      expect(searchUsda(foods, q, 3).length, `no hit for "${q}"`).toBeGreaterThan(0);
    }
  });

  // ── Restaurant / chain menu coverage (N6) ─────────────────────
  //
  // `UX_AUDIT.md` §S15 files N6 as "a real table-stakes gap (MFP ships it
  // free)", to be done after N2 by reusing its bundling mechanism. Measured on
  // 2026-08-12, that premise is mostly already false: FNDDS carries chain menu
  // items, and N2 bundled FNDDS, so the gap closed as a side effect of a
  // different ticket. The dataset holds 61 McDonald's rows, 28 Burger King, 24
  // KFC, 19 Wendy's, 19 Pizza Hut, 13 Taco Bell, 12 Subway, 10 Domino's.
  //
  // These are locks, not decoration. The coverage is INCIDENTAL — nothing in
  // the ingest asks for restaurant data, it arrives inside FNDDS — so a future
  // `--no-survey` run, or a decision to trim the dataset for size, would delete
  // every chain item with no other signal. That is exactly the kind of silent
  // regression this repo keeps paying for.
  it.each([
    ["big mac", /big mac/i],
    ["whopper", /whopper/i],
    ["taco bell burrito", /taco bell/i],
    ["mcdonalds fries", /mcdonald/i],
    ["kfc chicken", /kfc/i],
    ["pizza hut pizza", /pizza hut/i],
  ])("still finds the chain menu item for %j", (query, expected) => {
    const [top] = searchUsda(foods, query, 5);
    expect(top, `no hit for "${query}"`).toBeDefined();
    expect(top.description).toMatch(expected);
  });

  it("documents which chains are NOT covered, so the gap is a fact and not a guess", () => {
    // The residual half of N6. FNDDS's survey cycle predates or under-samples
    // these, and they are drink- and build-your-own-heavy, which the survey
    // does not model well. Filling them needs a licensed menu source — the
    // chains' own published data — and NOT a guess: inventing macros for a
    // Starbucks latte would be fabricating health data, which is worse than
    // returning nothing.
    //
    // If this test starts FAILING, a source was added and N6's remaining half
    // can be closed. That is the only reason it asserts on absence.
    for (const q of ["starbucks latte", "chipotle burrito bowl"]) {
      expect(searchUsda(foods, q, 3).length, `now covered: "${q}"`).toBe(0);
    }
  });
});
