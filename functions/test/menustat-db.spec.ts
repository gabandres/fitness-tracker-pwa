import { describe, expect, it, beforeAll } from "vitest";
import { fileURLToPath } from "node:url";
import {
  indexMenuItems,
  loadRestaurantFoods,
  matchChain,
  menuStatDetail,
  queryNamesChain,
  resetMenuCache,
  scoreItem,
  searchMenuStat,
  toServings,
  type MenuStatFile,
  type MenuStatItem,
} from "../src/menustat-db";

// Pure tests — no emulator needed. Same two layers as `usda-db.spec.ts`:
//   1. hand-built fixtures, which pin the matching and mapping rules exactly;
//   2. the REAL committed dataset, because a bad regeneration of
//      `functions/data/restaurant-foods.json` is the failure most likely to
//      reach production unnoticed, and no fixture can stand in for it.

const item = (over: Partial<MenuStatItem> & { id: string; chain: string; desc: string }): MenuStatItem => ({
  cat: "Entrees",
  kcal: 500,
  protein: 25,
  carb: 40,
  fat: 20,
  grams: 200,
  label: "200 g",
  ...over,
});

const file = (items: MenuStatItem[], year = 2022): MenuStatFile => ({ year, source: "MenuStat", items });

describe("matchChain", () => {
  const index = indexMenuItems(
    file([
      item({ id: "1", chain: "Taco Bell", desc: "Bean Burrito" }),
      item({ id: "2", chain: "The Cheesecake Factory", desc: "Original" }),
      item({ id: "3", chain: "Jack in the Box", desc: "Chicken Sandwich" }),
      item({ id: "4", chain: "Chick Fil A", desc: "Grilled Nuggets" }),
    ]),
  );

  it("matches a chain named in full", () => {
    expect(matchChain(index, ["taco", "bell"])?.chain).toBe("Taco Bell");
  });

  it("matches a chain typed without its punctuation or spaces", () => {
    // How people actually type these. "Chick Fil A" is stored with spaces.
    expect(matchChain(index, ["chickfila"])?.chain).toBe("Chick Fil A");
  });

  it("matches a chain whose leading article the user dropped", () => {
    // The whole reason `chainForms` emits two forms — without it this chain
    // goes unrecognised and its items lose their page.
    expect(matchChain(index, ["cheesecake", "factory"])?.chain).toBe("The Cheesecake Factory");
    expect(matchChain(index, ["the", "cheesecake", "factory"])?.chain).toBe("The Cheesecake Factory");
  });

  it("keeps a MEDIAL 'the', which is not an article to drop", () => {
    expect(matchChain(index, ["jack", "in", "the", "box"])?.chain).toBe("Jack in the Box");
    expect(matchChain(index, ["jackinthebox"])?.chain).toBe("Jack in the Box");
  });

  it("returns the leftover query words so the caller can tell browse from find", () => {
    expect(matchChain(index, ["taco", "bell", "burrito"])?.rest).toEqual(["burrito"]);
    expect(matchChain(index, ["taco", "bell"])?.rest).toEqual([]);
  });

  it("returns null when no chain is named — the common case", () => {
    expect(matchChain(index, ["banana"])).toBeNull();
    expect(matchChain(index, ["chicken", "breast"])).toBeNull();
  });
});

describe("scoreItem", () => {
  const index = indexMenuItems(
    file([
      item({ id: "1", chain: "Taco Bell", desc: "Bean Burrito", cat: "Entrees" }),
      item({ id: "2", chain: "Taco Bell", desc: "Mild Sauce Packet", cat: "Toppings & Ingredients" }),
    ]),
  );
  const [burrito, sauce] = index.items;

  it("requires every query token to match somewhere", () => {
    expect(scoreItem(burrito, ["burrito"], "Taco Bell")).not.toBeNull();
    expect(scoreItem(burrito, ["quesadilla"], "Taco Bell")).toBeNull();
  });

  it("rejects an item from a different chain once a chain is named", () => {
    expect(scoreItem(burrito, ["burrito"], "Chipotle")).toBeNull();
  });

  it("demotes toppings and condiments below real food", () => {
    const a = scoreItem(burrito, [], "Taco Bell");
    const b = scoreItem(sauce, [], "Taco Bell");
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a as number).toBeGreaterThan(b as number);
  });

  it("scores a chain-name match on an unnamed query BELOW an item-name match", () => {
    // "chicken sandwich" must lead with a sandwich, not with an arbitrary item
    // from a chain that happens to have "Chicken" in its name.
    const named = indexMenuItems(
      file([
        item({ id: "1", chain: "Church's Chicken", desc: "Coleslaw" }),
        item({ id: "2", chain: "Wingstop", desc: "Chicken Sandwich" }),
      ]),
    );
    const [slaw, sandwich] = named.items;
    const a = scoreItem(sandwich, ["chicken"], null) as number;
    const b = scoreItem(slaw, ["chicken"], null) as number;
    expect(a).toBeGreaterThan(b);
  });
});

describe("toServings", () => {
  it("emits a per-100g row alongside the portion when a weight exists", () => {
    const [i] = indexMenuItems(file([item({ id: "1", chain: "X", desc: "Y", grams: 200, kcal: 500, protein: 25 })])).items;
    const servings = toServings(i);
    expect(servings).toHaveLength(2);
    expect(servings[0]).toMatchObject({ kind: "portion", grams: 200, kcal: 500, protein: 25 });
    expect(servings[1]).toMatchObject({ kind: "per100g", grams: 100, kcal: 250, protein: 13 });
  });

  it("emits ONLY the portion when MenuStat published no weight", () => {
    // The load-bearing case: 60% of the corpus. Synthesizing a per-100g row
    // here would be inventing a number nobody published.
    const [i] = indexMenuItems(
      file([item({ id: "1", chain: "X", desc: "Y", grams: 0, label: "1 serving", kcal: 500, protein: 25 })]),
    ).items;
    const servings = toServings(i);
    expect(servings).toHaveLength(1);
    expect(servings[0]).toMatchObject({ kind: "portion", grams: 0, label: "1 serving" });
  });
});

describe("searchMenuStat", () => {
  const index = indexMenuItems(
    file([
      item({ id: "1", chain: "Taco Bell", desc: "Bean Burrito" }),
      item({ id: "2", chain: "Taco Bell", desc: "Crunchy Taco" }),
      item({ id: "3", chain: "Chipotle", desc: "Burrito Bowl" }),
      item({ id: "4", chain: "Applebee's", desc: "Fries Basket", note: "Kids Sides" }),
    ]),
  );

  it("confines results to the named chain", () => {
    const hits = searchMenuStat(index, "taco bell burrito", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ source: "menu", brand: "Taco Bell", description: "Bean Burrito" });
  });

  it("searches across chains when none is named", () => {
    const brands = searchMenuStat(index, "burrito", 10).map((h) => h.brand).sort();
    expect(brands).toEqual(["Chipotle", "Taco Bell"]);
  });

  it("matches the note, which is searchable but not displayed", () => {
    const hits = searchMenuStat(index, "applebees fries kids", 10);
    expect(hits).toHaveLength(1);
    expect(hits[0].description).toBe("Fries Basket");
  });

  it("carries the snapshot year in dataType so a stale figure names its age", () => {
    expect(searchMenuStat(index, "chipotle", 1)[0].dataType).toBe("restaurant_menu_2022");
  });

  it("returns nothing for an empty query rather than the whole corpus", () => {
    expect(searchMenuStat(index, "", 10)).toEqual([]);
  });
});

describe("menuStatDetail", () => {
  const index = indexMenuItems(file([item({ id: "42", chain: "Taco Bell", desc: "Bean Burrito" })]));

  it("resolves by id", () => {
    expect(menuStatDetail(index, "42")).toMatchObject({ source: "menu", id: "42", brand: "Taco Bell" });
  });

  it("returns null for an id this snapshot does not hold", () => {
    expect(menuStatDetail(index, "999")).toBeNull();
  });
});

describe("the committed dataset", () => {
  const dataPath = fileURLToPath(new URL("../data/restaurant-foods.json", import.meta.url));
  let index: ReturnType<typeof loadRestaurantFoods>;

  beforeAll(() => {
    resetMenuCache();
    index = loadRestaurantFoods(dataPath);
  });

  it("is the 2022 snapshot and is not obviously truncated", () => {
    expect(index.year).toBe(2022);
    expect(index.items.length).toBeGreaterThan(24000);
  });

  it("holds every chain the owner named (issue #67, measurement 3)", () => {
    // These fifteen are why this dataset shipped. A regeneration that loses one
    // is a regression against the ticket, not a cosmetic diff.
    const wanted = [
      "Panda Express", "Wendy's", "Church's Chicken", "Denny's", "IHOP",
      "The Cheesecake Factory", "Wingstop", "Chipotle", "Qdoba", "Taco Bell",
      "Starbucks", "Panera Bread", "Olive Garden", "Chili's", "Chick Fil A",
    ];
    const present = new Set(index.items.map((i) => i.chain));
    expect(wanted.filter((c) => !present.has(c))).toEqual([]);
  });

  it("carries calories and protein on every item — the whole ingest filter", () => {
    const bad = index.items.filter((i) => !Number.isFinite(i.kcal) || !Number.isFinite(i.protein));
    expect(bad).toEqual([]);
  });

  it("never emits a negative gram weight, and uses 0 for 'not published'", () => {
    expect(index.items.filter((i) => i.grams < 0)).toEqual([]);
    expect(index.items.some((i) => i.grams === 0)).toBe(true);
  });

  it("answers a real chain query with that chain's items", () => {
    const hits = searchMenuStat(index, "chickfila chicken sandwich", 5);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.brand === "Chick Fil A")).toBe(true);
    expect(hits.some((h) => /chicken sandwich/i.test(h.description))).toBe(true);
  });

  it("recognises the chains people type without punctuation", () => {
    for (const q of ["chickfila", "mcdonalds", "wendys", "dennys", "chilis", "cheesecake factory"]) {
      expect(queryNamesChain(index, q), q).toBe(true);
    }
  });

  it("does NOT claim a chain for an ordinary food query", () => {
    // The guard that keeps restaurant results from swamping generic search —
    // and, on mobile, keeps a plain query from paying a network round trip.
    for (const q of ["banana", "chicken breast", "greek yogurt", "olive oil", "rice"]) {
      expect(queryNamesChain(index, q), q).toBe(false);
    }
  });
});
