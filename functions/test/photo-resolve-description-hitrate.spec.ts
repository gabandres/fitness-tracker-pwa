import { describe, expect, it, beforeAll } from "vitest";
import { indexFoods, loadFoods, resetCache } from "../src/usda-db";
import { resolvePhrase } from "../src/photo-resolve";

/**
 * ADR-0029 / #76 — MEASUREMENT, and the result inverted the ADR's assumption.
 *
 * ADR-0029 flagged the risk as "a front-of-pack phrase may not RESOLVE against
 * the bundled USDA index", which would make the description field look
 * supported while producing a wrong macro. Measured 2026-08-26, both groups
 * below resolve at 100%. The index never abstains.
 *
 * That is the worse outcome, not the better one. The failure mode is not a
 * miss, it is a confident wrong match, and nothing downstream can tell the
 * difference:
 *
 *   "Dave's Killer Bread 21 whole grains"  -> Millet, whole grain
 *   "Uncle Ben's original converted rice"  -> Rice, black, unenriched, raw
 *   "Ben & Jerry's chocolate fudge ..."    -> Ice cream, vanilla
 *   "Tyson grilled chicken breast strips"  -> Chicken breast, rotisserie,
 *                                             skin eaten   (inflates fat)
 *
 * And the load-bearing one is in the CONTROL group, with no brand at all:
 *
 *   "unsalted butter" -> Pretzels, soft, ready-to-eat, unsalted, buttered
 *
 * So this is not a branded-text problem. It is `resolvePhrase`'s relaxed
 * shortening pass having no abstain path: it keeps dropping tokens until
 * something scores, and "something" is always available in a 13k-row index.
 *
 * PARTIALLY ADDRESSED 2026-08-26, and the pretzel CLOSED 2026-08-27. Three of
 * the classes above are now fixed and pinned in `photo-resolve.spec.ts`:
 * substring matches ("green apple" -> SNAPPLE), meat analogues ("bacon" ->
 * meatless), and the pretzel — `unsalted butter` now returns `Butter, tub`.
 *
 * **This comment's own diagnosis of the pretzel was WRONG, and the correction
 * is worth keeping.** It said the cause was "the relaxed shortening pass having
 * no abstain path". Measured, the pretzel is an EXACT-pass hit: `matchesAsWord`
 * accepts `buttered` for `butter` under its two-character suffix tolerance, so
 * the phrase never reaches relaxation at all. A guard bolted onto the
 * shortening loop would have changed nothing. What fixed it is `headIsIdentity`
 * in `photo-resolve.ts` — the head noun must appear in the first two comma
 * segments of the USDA description, the ones that say what the food IS —
 * applied to every pass. Measured over an 80-phrase corpus: 4 changes, 0
 * regressions.
 *
 * What is still NOT fixed is the other family, and it is the one that needs the
 * ranker retuned rather than filtered: a correct genus that acquires a
 * qualifier nobody asked for. `black coffee` -> `Coffee, CUBAN`, `greek yogurt`
 * -> `Yogurt, Greek, plain, WHOLE MILK`, `bacon` -> `Bacon, TURKEY`,
 * `grilled chicken breast` -> `Chicken breast, rotisserie, SKIN EATEN`.
 *
 * Consequence for #76: a description field must NOT auto-apply macros from
 * this resolver. Either give the resolver an abstain result, or keep the
 * review screen as the thing that catches it. Scale-reading and repeat
 * detection do not depend on this and can ship without it.
 *
 * No threshold is asserted. The numbers are the finding, and pinning them
 * would turn a measurement into a gate that a dataset regeneration breaks.
 */

/** Front-of-pack phrases, brand-led, as a photo of a package would yield. */
const BRANDED = [
  "Kirkland greek yogurt",
  "Chobani vanilla greek yogurt",
  "Quaker old fashioned oats",
  "Barilla penne pasta",
  "Skippy creamy peanut butter",
  "Tyson grilled chicken breast strips",
  "Dave's Killer Bread 21 whole grains",
  "Cheerios honey nut cereal",
  "Fairlife whole milk",
  "Jif natural peanut butter spread",
  "Land O Lakes unsalted butter",
  "Philadelphia cream cheese",
  "Hellmann's real mayonnaise",
  "Heinz tomato ketchup",
  "Kraft shredded cheddar cheese",
  "Ben & Jerry's chocolate fudge brownie ice cream",
  "Campbell's chicken noodle soup",
  "Ore-Ida golden crinkles french fried potatoes",
  "Uncle Ben's original converted rice",
  "Morningstar Farms veggie burger",
];

/** The same foods with the brand removed — the control group. */
const GENERIC = [
  "greek yogurt",
  "vanilla greek yogurt",
  "old fashioned oats",
  "penne pasta",
  "creamy peanut butter",
  "grilled chicken breast",
  "whole grain bread",
  "honey nut cereal",
  "whole milk",
  "peanut butter",
  "unsalted butter",
  "cream cheese",
  "mayonnaise",
  "tomato ketchup",
  "shredded cheddar cheese",
  "chocolate ice cream",
  "chicken noodle soup",
  "french fried potatoes",
  "white rice",
  "veggie burger",
];

type Indexed = ReturnType<typeof indexFoods>;
let foods: Indexed;

beforeAll(async () => {
  resetCache();
  foods = indexFoods(await loadFoods());
});

function measure(label: string, phrases: string[]) {
  const hits: Array<[string, string]> = [];
  const misses: string[] = [];
  for (const p of phrases) {
    const m = resolvePhrase(foods, p);
    if (m) hits.push([p, m.desc]);
    else misses.push(p);
  }
  const pct = Math.round((hits.length / phrases.length) * 100);
  console.log(`\n=== ${label}: ${hits.length}/${phrases.length} resolved (${pct}%) ===`);
  for (const [p, d] of hits) console.log(`  HIT   ${p.padEnd(48)} -> ${d}`);
  for (const p of misses) console.log(`  MISS  ${p}`);
  return { hits, misses, pct };
}

describe("#76 description-field hit rate against the bundled USDA index", () => {
  it("measures branded front-of-pack phrases", () => {
    const r = measure("BRANDED (front-of-pack, brand-led)", BRANDED);
    // No threshold on purpose — see the header. Only sanity: it ran.
    expect(r.hits.length + r.misses.length).toBe(BRANDED.length);
  });

  it("measures the generic control group", () => {
    const r = measure("GENERIC (brand stripped — control)", GENERIC);
    expect(r.hits.length + r.misses.length).toBe(GENERIC.length);
  });
});
