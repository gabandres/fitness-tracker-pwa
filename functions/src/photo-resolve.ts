/**
 * Resolve a vision model's food *phrase* to a bundled-USDA food, and compute
 * that item's macros from its portion.
 *
 * This is the second half of ADR-0015 §1's split vision architecture. The model
 * does recognition + portion only ("grilled chicken breast, ~150 g"); this
 * module turns that into grounded macros, because general LLM vision showed
 * **>60% error on protein** — the app's core metric — when asked for the
 * numbers directly.
 *
 * ## Why `searchUsda` is not enough on its own
 *
 * `searchUsda` is tuned for a **typeahead query a human types**: short, already
 * close to USDA's own vocabulary, and — critically — it requires *every* token
 * to appear in the food's description, returning `null` otherwise. A vision
 * model does not emit "chicken breast". It emits "grilled chicken breast with
 * skin", "white rice with sofrito", "two scrambled eggs". Fed straight to
 * `searchUsda`, most of those match **nothing at all**, because "grilled" or
 * "with" or "sofrito" appears in no USDA description.
 *
 * So this module keeps `usda-db`'s ranking signals — they are good and were
 * tuned against the real dataset — and changes what is *required*:
 *
 *  - **Core tokens must match.** The nouns that say which food this is.
 *  - **Preparation tokens are optional.** "grilled", "fried", "raw" score a
 *    bonus when the food's description agrees and cost nothing when it does not.
 *    USDA spells cooking methods inconsistently and often not at all, so
 *    requiring them would reject the right food for a spelling difference.
 *  - **Filler is dropped entirely.** Connectives, articles, quantity words.
 *
 * Two of `usda-db`'s penalties are also *conditioned on the query*, which is
 * the main behavioural difference from typeahead ranking:
 *
 *  - The PROCESSED penalty is waived for the processed words the query itself
 *    used. Someone typing "plantain" wants the raw one; a model that says
 *    "fried plantains" is describing tostones, and penalising "Plantains,
 *    fried" for containing "fried" would return the raw plantain it explicitly
 *    is not.
 *  - The PLAIN bonus applies only when the query names no preparation at all.
 *    A bare "chicken breast" should land on the plain form; "grilled chicken
 *    breast" should not be pulled toward "raw".
 *
 * ## A photo is of COOKED food, and that is worth more than any other rule here
 *
 * The single largest error this module can make is not picking the wrong food —
 * it is picking the right food in the wrong state. USDA files the canonical
 * entry for a staple **raw**, and `searchUsda` deliberately rewards that,
 * because someone typing "rice" wants the canonical row. But a photo shows a
 * plate, the model measures the portion **on that plate**, and dry rice is
 * `369 kcal/100 g` against about `130` cooked. Resolving "white rice" to the raw
 * row therefore overstates the meal by roughly **3×** — silently, with a
 * confident-looking USDA provenance attached.
 *
 * So in photo context the raw/cooked preference is inverted: cooked forms are
 * rewarded and raw markers penalised, unless the model itself said the food was
 * raw or fresh. The penalty is small and the bonus is what does the work, which
 * matters for foods that are *eaten* raw — nothing outranks "Banana, raw", so it
 * still wins; "Rice, white, long grain, regular, cooked" now outranks its raw
 * sibling, which is the entire point.
 *
 * ## Relaxation picks the most informative subset, not the leftmost
 *
 * If every core token together matches nothing, progressively smaller
 * *contiguous* token runs are tried, stopping at the first length that matches
 * at all. Among equally long candidates the winner is the one whose tokens are
 * **rarest in the dataset**, not the leftmost or the last.
 *
 * That tiebreak is load-bearing. "salmon fillet" matches no single USDA food, so
 * it degrades to one token — and "fillet" alone returns "Vegetarian, fillet"
 * while "salmon" returns the fish. Both are single tokens with similar scores;
 * only rarity says which one carried the meaning. Dropping from the front and
 * keeping the head noun (the rule USDA's inverted compounds suggest) picks
 * "fillet" and is wrong here; keeping the last token is wrong for "grilled
 * salmon with lemon", which degrades to "lemon".
 *
 * A relaxed match must also clear a score floor and match its rarest token as a
 * whole word rather than a substring. Without that, "arroz con pollo" resolves
 * to **"Fish, pollock"** — "pollo" is a prefix of "pollock". Falling back to the
 * model's own numbers is the correct answer for a dish USDA does not carry, and
 * a wrong confident match is worse than an honest approximation.
 *
 * ## Everything here is pure
 *
 * No I/O, no network, no clock. That is deliberate: it is the only reason the
 * ranking can be tested against the **real committed dataset** rather than
 * fixtures, and the real-data assertions in `test/photo-resolve.spec.ts` are
 * what catch ranking bugs. Fixtures caught none of them last time.
 */
import { scoreFood, stem as stemOf, words as wordsOf, type IndexedFood, type UsdaFood } from "./usda-db";

/** Grams below which a portion is treated as noise rather than a portion. */
const MIN_GRAMS = 1;
/** Grams above which the model is almost certainly hallucinating a portion. */
const MAX_GRAMS = 5_000;

/**
 * Words that carry no information about *which* food this is. Dropped before
 * matching rather than demoted — a token that appears in no USDA description
 * would otherwise fail the "every core token must match" rule and sink the
 * whole phrase.
 *
 * Includes the connectives `usda-db` treats as a COMPOSITE signal: in a USDA
 * *description* "with" means a multi-ingredient dish, but in a model's *phrase*
 * it is just English.
 */
const FILLER = new Set([
  "a", "an", "the", "of", "in", "on", "and", "or", "with", "without", "plus",
  "some", "side", "sides", "serving", "servings", "portion", "portions",
  "piece", "pieces", "slice", "slices", "plate", "plateful", "bowl", "cup",
  "cups", "tbsp", "tsp", "oz", "ounce", "ounces", "gram", "grams", "g", "ml",
  "approx", "approximately", "about", "around", "roughly", "est", "estimated",
  "small", "medium", "large",
  // NOTE "whole" and "half" are deliberately NOT filler: USDA files "Milk,
  // whole", "Egg, whole" and "whole wheat", so dropping them costs the match.
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "topped", "served", "style", "homemade", "assorted", "mixed",
  // "tomato-based sauce" tokenizes to [tomato, based, sauce], and "based" is a
  // real word in USDA composite names ("Pasta with tomato-based sauce"), so
  // keeping it as core made "Sauce, steak, tomato based" an EXACT match and beat
  // "Tomato sauce, canned" outright. It says nothing about what the food is.
  "based", "flavored", "type", "kind",
  // Knife work. These read like preparation but USDA almost never files under
  // them, and treating them as CORE is actively harmful: "shredded lettuce"
  // relaxes to the rarer token and returns "Cheese, parmesan, shredded".
  "shredded", "sliced", "diced", "chopped", "minced", "grated", "crumbled",
  "cubed", "julienned", "halved", "quartered", "peeled", "seasoned", "marinated",
]);

/**
 * Words naming a CUT or FORM rather than a food. Safe as part of a full phrase
 * — "chicken breast" needs "breast" — but never safe as the *only* surviving
 * token after relaxation, because USDA carries foods filed under the bare cut.
 * "salmon fillet" matches no single row, and relaxing to "fillet" alone returns
 * **"Vegetarian, fillet"**: right shape, wrong animal, wrong kingdom.
 */
const CUT_WORDS = new Set([
  "fillet", "filet", "fillets", "breast", "thigh", "chop", "chops", "steak",
  "loin", "patty", "patties", "wing", "wings", "leg", "legs", "drumstick",
  "cutlet", "strip", "strips", "tender", "tenders", "nugget", "nuggets",
  "ribs", "rib", "roast", "shank", "flank", "brisket", "meat",
]);

/**
 * Connectives that separate the food from its accompaniment in a model phrase.
 * "grilled salmon with lemon" is a salmon item; the lemon is a garnish, and if
 * the whole phrase fails to match, the answer is the salmon — not the lemon.
 * Splitting here is what makes that a rule rather than a lucky tiebreak.
 */
const CONNECTIVES = new Set(["with", "and", "or", "topped", "served", "over", "on", "in", "plus", "alongside"]);

/**
 * Preparation words: they describe what was *done* to the food, not what it is.
 * Optional at match time, rewarded when present in the description.
 *
 * Grouped into families because USDA and a vision model rarely pick the same
 * word for the same thing. A model says "grilled"; USDA files "roasted",
 * "broiled" or just "cooked". Matching within a family is what makes "grilled
 * chicken breast" find a cooked chicken breast instead of a raw one.
 */
const PREP_FAMILIES: Record<string, string[]> = {
  dryHeat: ["grilled", "roasted", "baked", "broiled", "seared", "barbecued", "bbq", "rotisserie", "cooked", "toasted"],
  fried: ["fried", "deep-fried", "panfried", "pan-fried", "sauteed", "sautéed", "stirfried", "crispy", "breaded", "battered"],
  moistHeat: ["boiled", "steamed", "poached", "simmered", "stewed", "braised", "cooked"],
  raw: ["raw", "fresh", "uncooked"],
  egg: ["scrambled", "fried", "poached", "boiled", "omelet", "omelette"],
  mashed: ["mashed", "pureed", "creamed"],
  dried: ["dried", "dehydrated", "sundried"],
  smoked: ["smoked", "cured"],
  canned: ["canned", "tinned", "jarred"],
  frozen: ["frozen"],
};

/** Flattened lookup: token → the family words it should also accept. */
const PREP_TOKENS: Map<string, string[]> = (() => {
  const m = new Map<string, string[]>();
  for (const family of Object.values(PREP_FAMILIES)) {
    for (const w of family) {
      // A word in two families (e.g. "fried" in `fried` and `egg`, "cooked" in
      // both heat families) accepts the union — being generous here only ever
      // costs a bonus point on a food that was already a core-token match.
      m.set(w, [...new Set([...(m.get(w) ?? []), ...family])]);
    }
  }
  return m;
})();

/** How the item's macros were arrived at, per item. */
export type ItemSource = "usda" | "model";

/** What the model emits per recognized food, before resolution. */
export interface DraftItem {
  name: string;
  grams: number;
  /**
   * Whether this food was photographed cooked or raw. Asked of the MODEL rather
   * than inferred here, because it is a fact about the photo and the model can
   * see the photo. Guessing it from the food's name is what a lexicon would do,
   * and a lexicon cannot tell a banana (raw is correct) from rice (raw is a 3×
   * overstatement) without effectively encoding a food taxonomy.
   */
  state?: string;
  /** 'low' | 'medium' | 'high' from the model, per item. */
  confidence?: string;
  /** Fallback macros, used ONLY when the phrase resolves to nothing. */
  kcal?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/** One resolved food, matching `ScannedFoodItem` in @macrolog/core plus provenance. */
export interface ResolvedItem {
  name: string;
  grams: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: number;
  source: ItemSource;
  /** FDC id of the matched food — absent when `source` is "model". */
  fdcId?: string;
  /** The USDA description the macros came from, so the user can see the basis. */
  matchedDescription?: string;
}

const CONFIDENCE_SCORE: Record<string, number> = { low: 0.4, medium: 0.7, high: 0.9 };

/**
 * Split a model phrase into the token roles the matcher needs.
 *
 * `core` is split further into CLAUSES at connectives, so "grilled salmon with
 * lemon" yields `[["salmon"], ["lemon"]]` rather than one flat run. The first
 * clause is the dish; anything after a connective is an accompaniment, and if
 * the whole phrase fails to match it is the FIRST clause that should answer.
 */
export function classifyTokens(phrase: string): { clauses: string[][]; prep: string[] } {
  const clauses: string[][] = [[]];
  const prep: string[] = [];
  for (const raw of wordsOf(phrase)) {
    // Bare numbers are portion noise ("2 eggs"); grams carries the portion.
    if (/^[0-9.]+$/.test(raw)) continue;
    if (CONNECTIVES.has(raw)) {
      if (clauses[clauses.length - 1].length > 0) clauses.push([]);
      continue;
    }
    if (FILLER.has(raw)) continue;
    if (PREP_TOKENS.has(raw)) { prep.push(raw); continue; }
    clauses[clauses.length - 1].push(raw);
  }
  return { clauses: clauses.filter((c) => c.length > 0), prep };
}

/**
 * Bonus when the food's description agrees with how the model said it was
 * prepared. Family-wide, so "grilled" is satisfied by "roasted".
 *
 * Deliberately a bonus and never a penalty: a food that says nothing about
 * preparation is usually still the right food.
 *
 * Outweighs {@link cookedBonus} on purpose. "canned tuna" must land on "Fish,
 * tuna, canned" (85 kcal) and not on "Fish, tuna, cooked" (176 kcal) — a
 * specific preparation the model actually observed beats the generic "this came
 * off a plate, so it is probably cooked" prior.
 */
function prepBonus(norm: string, prep: string[]): number {
  let bonus = 0;
  for (const p of prep) {
    const family = PREP_TOKENS.get(p) ?? [p];
    if (family.some((w) => norm.includes(w))) bonus += 45;
  }
  return bonus;
}

/**
 * USDA's way of saying "this is the uncooked ingredient". `mature seeds` is the
 * legume spelling of it and matters as much as `raw` — "Beans, black, mature
 * seeds, raw" is 341 kcal/100 g against about 132 cooked.
 */
const RAW_MARKERS = /\b(raw|unprepared|uncooked|dry|dried|mature seeds)\b/;

/**
 * The subset of {@link RAW_MARKERS} that means "this is how the food is eaten"
 * rather than "this is the shelf-stable ingredient".
 *
 * The distinction is not pedantic. `dry` correctly demotes "Lentils, dry"
 * (351 kcal/100 g) when the photo shows cooked lentils (116). But *rewarding*
 * `dry` when the photo shows something raw promotes "Milk, dry, whole"
 * (496 kcal/100 g) over "Milk, whole" (61) — an 8× error, in the opposite
 * direction, from the same word. So the penalty is broad and the bonus is
 * narrow.
 */
const EATEN_RAW_MARKERS = /\b(raw|fresh|uncooked)\b/;

/** USDA's way of saying "this is the food as eaten". */
const COOKED_MARKERS =
  /\b(cooked|boiled|roasted|baked|steamed|grilled|broiled|fried|braised|stewed|prepared|ready-to-heat|heated)\b/;

/**
 * Words marking a food PRODUCT rather than the food — deli slices, a breaded
 * cutlet, a stuffed chop, a named restaurant item, a jar of baby food.
 *
 * Without this, the canonical cooked cut loses to a convenience product on
 * brevity alone, and the macros are wrong in a way nothing on screen betrays.
 * "grilled chicken breast" resolved to **"Chicken breast, oven-roasted,
 * fat-free, sliced"** — 79 kcal and 16.8 g protein, against 165 kcal and 31 g
 * for "Chicken, broilers or fryers, breast, meat only, cooked, roasted". Protein
 * off by 45% on the app's core metric, from the app's most-logged food.
 *
 * Waived for anything the query itself said, exactly like the PROCESSED penalty:
 * a model that reports "breaded chicken" means the breaded row.
 */
const PRODUCT_QUALIFIERS =
  /\b(sliced|roll|luncheon|deli|coated|breaded|battered|stuffed|tenders|nuggets|reconstituted|restaurant|fast food|babyfood|baby|infant|fat-free|low-fat|nonfat|reduced fat|light|instant|mix|powder|turnover|fritter|croquette|empanada|dumpling|wrap|pastry|spread)\b/g;

/**
 * USDA's SR-legacy rows carry brand and chain names in SHOUTING CAPS
 * ("McDONALD'S, Bacon Ranch Salad with Grilled Chicken"). A photo of a salad
 * should resolve to salad, not to one chain's menu item that happens to share
 * the words. There is no `branded_food` dataType in this dataset to filter on —
 * these are `sr_legacy_food` — so the capitalisation is the only signal.
 */
const BRAND_SHOUT = /[A-Z]{3,}/g;

/**
 * Uppercase runs that are NOT brands. USDA's own boilerplate shouts too
 * ("Includes foods for USDA's Food Distribution Program"), and penalising the
 * plain "Orange juice, raw" for carrying that footnote would be the fix causing
 * the bug.
 */
const NOT_A_BRAND = new Set(["USDA", "NFS", "DHA", "ARA", "RTD", "UHT", "FDA", "GMO", "BBQ", "USA"]);

function looksBranded(desc: string): boolean {
  return (desc.match(BRAND_SHOUT) ?? []).some((run) => !NOT_A_BRAND.has(run));
}

/**
 * Whether the food was photographed cooked or raw. **The model decides this,
 * not a lexicon here** — see the header.
 */
export type FoodState = "cooked" | "raw" | "unknown";

/**
 * Push the ranking toward the state the food was actually in. See the header —
 * this is the correction with the largest effect on macro accuracy.
 *
 * `unknown` applies no adjustment at all, which reverts to `searchUsda`'s
 * typeahead behaviour. That is the right default for malformed model output: it
 * is the ranking that was already tuned, rather than a guess in either
 * direction.
 */
function stateBonus(norm: string, state: FoodState): number {
  if (state === "unknown") return 0;
  if (state === "raw") {
    // Near-symmetric to the cooked case. A salad, sashimi, fruit: the raw row is
    // the one that was photographed, and a cooked sibling would be wrong. The
    // bonus uses the NARROW marker set — see EATEN_RAW_MARKERS.
    let d = 0;
    if (EATEN_RAW_MARKERS.test(norm)) d += 30;
    if (COOKED_MARKERS.test(norm)) d -= 15;
    return d;
  }
  let delta = 0;
  if (COOKED_MARKERS.test(norm)) delta += 30;
  // Small on purpose: for a food only ever eaten raw there IS no cooked row, so
  // this must not be large enough to promote some processed sibling instead.
  if (RAW_MARKERS.test(norm)) delta -= 15;
  return delta;
}

/**
 * How many foods contain a token, memoized per dataset. The basis for "which
 * token carried the meaning" when a phrase has to be shortened.
 */
const dfCache = new WeakMap<object, Map<string, number>>();

function docFreq(foods: IndexedFood[], token: string): number {
  let m = dfCache.get(foods);
  if (!m) {
    m = new Map();
    dfCache.set(foods, m);
  }
  const hit = m.get(token);
  if (hit !== undefined) return hit;
  let n = 0;
  for (const f of foods) {
    if (f.wordStems.includes(token)) { n++; continue; }
    if (f.wordStems.some((w) => w.startsWith(token))) n++;
  }
  m.set(token, n);
  return n;
}

/** Rarity of a token run: rarer (lower document frequency) is more informative. */
function informativeness(foods: IndexedFood[], tokens: string[]): number {
  let worst = Infinity;
  for (const t of tokens) worst = Math.min(worst, docFreq(foods, t));
  return -worst;
}

/**
 * A relaxed match has thrown away part of what the model said, so it has to
 * earn its keep: clear a score floor, and match on a real word rather than a
 * lucky prefix. "pollo" is a prefix of "pollock"; that is not a tuna.
 */
const RELAXED_SCORE_FLOOR = 120;

function matchesAsWord(food: IndexedFood, tokens: string[]): boolean {
  return tokens.every((raw) => {
    // `wordStems` is stemmed, so the token must be too. Comparing the raw token
    // against stemmed words silently fails on every plural — "tomatoes" never
    // equals the stored "tomato" — which made "cherry tomatoes" fall through to
    // "Cherries, raw" no matter how the tiebreak was written.
    const t = stemOf(raw);
    return (
      food.wordStems.includes(t) ||
      food.wordStems.some((w) => w.startsWith(t) && w.length - t.length <= 2)
    );
  });
}

/** All contiguous runs of `tokens` of exactly `len`, left to right. */
function runs(tokens: string[], len: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i + len <= tokens.length; i++) out.push(tokens.slice(i, i + len));
  return out;
}

/** Demote convenience products and branded menu items. See PRODUCT_QUALIFIERS. */
function productPenalty(food: IndexedFood, said: Set<string>): number {
  let penalty = 0;
  for (const hit of food.norm.match(PRODUCT_QUALIFIERS) ?? []) {
    if (!said.has(hit)) penalty += 40;
  }
  if (looksBranded(food.desc)) penalty += 60;
  return penalty;
}

/** Best food for one exact token run, or null when nothing matches it. */
function bestFor(
  foods: IndexedFood[],
  tokens: string[],
  prep: string[],
  state: FoodState,
): { food: IndexedFood; score: number } | null {
  const query = tokens.join(" ");
  // Anything the model actually said is forgiven, in both penalties.
  const said = new Set([...tokens, ...prep]);
  let best: { food: IndexedFood; score: number } | null = null;
  for (const food of foods) {
    const base = scoreFood(food, tokens, query, {
      // The query's own processed/composite words must not count against the
      // food that has them — see the header.
      waiveProcessed: [...said],
      // The PLAIN bonus rewards "raw"; when the photo shows cooked food that is
      // exactly backwards, so `stateBonus` owns the decision instead.
      plainBonus: prep.length === 0 && state !== "cooked",
    });
    if (base === null) continue;
    const score =
      base + prepBonus(food.norm, prep) + stateBonus(food.norm, state) - productPenalty(food, said);
    if (
      !best ||
      score > best.score ||
      // Same tie-break as searchUsda, so the choice is total and stable.
      (score === best.score &&
        (food.desc.length < best.food.desc.length ||
          (food.desc.length === best.food.desc.length && food.id < best.food.id)))
    ) {
      best = { food, score };
    }
  }
  return best;
}

/** A token run that is nothing but cut/form words cannot identify a food. */
function isOnlyCuts(tokens: string[]): boolean {
  return tokens.every((t) => CUT_WORDS.has(t));
}

/** Lexicographic on (contains-head, rarity), then raw score. Spelled out rather
 *  than comparing tuples, which JS would do by string coercion. */
function better(
  rank: [number, number],
  score: number,
  bestRank: [number, number],
  bestScore: number,
): boolean {
  if (rank[0] !== bestRank[0]) return rank[0] > bestRank[0];
  if (rank[1] !== bestRank[1]) return rank[1] > bestRank[1];
  return score > bestScore;
}

/**
 * Rank the dataset against one model phrase and return the best food, or null.
 *
 * `scoreFood` does the heavy lifting — it is the ranking that was tuned against
 * the real dataset for typeahead — with the query-conditioned adjustments
 * described at the top of this file layered on top.
 *
 * `state` is what the model saw: cooked food on a plate, or raw. It is the
 * single highest-leverage input here — see the header.
 */
export function resolvePhrase(
  foods: IndexedFood[],
  phrase: string,
  state: FoodState = "unknown",
): IndexedFood | null {
  const { clauses, prep } = classifyTokens(phrase);
  if (clauses.length === 0) return null;

  // Everything the model said, in order, with nothing thrown away: no floor and
  // no word-match requirement, since every token had to match to get here.
  const allTokens = clauses.flat();
  const exact = bestFor(foods, allTokens, prep, state);
  if (exact) return exact.food;

  // Then the dish alone, dropping the accompaniments after a connective.
  if (clauses.length > 1) {
    const head = bestFor(foods, clauses[0], prep, state);
    if (head) return head.food;
  }

  // Finally shorten the dish clause one token at a time, stopping at the first
  // length that matches anything. Among candidates of that length, rarity
  // decides, and a relaxed match must earn its keep (see header).
  const dish = clauses[0];
  const head = dish[dish.length - 1];
  for (let len = dish.length - 1; len >= 1; len--) {
    let best: { food: IndexedFood; score: number; rank: [number, number] } | null = null;
    for (const run of runs(dish, len)) {
      if (isOnlyCuts(run)) continue;
      const hit = bestFor(foods, run, prep, state);
      if (!hit) continue;
      if (hit.score < RELAXED_SCORE_FLOOR) continue;
      if (!matchesAsWord(hit.food, run)) continue;
      // Head first, rarity second. USDA inverts English compounds, so within one
      // clause the last token is what the food IS and the rest qualifies it:
      // "cherry tomatoes" is a tomato. Rarity alone picks "cherry" and returns
      // cherries, because "cherry" is the rarer word — true, and irrelevant.
      const rank: [number, number] = [run.includes(head) ? 1 : 0, informativeness(foods, run)];
      if (!best || better(rank, hit.score, best.rank, best.score)) {
        best = { food: hit.food, score: hit.score, rank };
      }
    }
    if (best) return best.food;
  }
  return null;
}

/** Scale a per-100 g macro to `grams`, rounded the way the review screen is:
 *  whole calories, one decimal on the macros (matching `rescaleScannedItem`). */
function at(per100: number, grams: number, whole = false): number {
  const v = (per100 * grams) / 100;
  return whole ? Math.round(v) : round1(v);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clampGrams(g: unknown): number {
  const n = typeof g === "number" && Number.isFinite(g) ? g : 0;
  return Math.min(MAX_GRAMS, Math.max(0, Math.round(n)));
}

/** Anything the model did not say cleanly falls to "unknown" (no adjustment). */
function normalizeState(s: unknown): FoodState {
  return s === "cooked" || s === "raw" ? s : "unknown";
}

/**
 * Resolve one draft item to grounded macros.
 *
 * **Never throws and never returns null.** An item that resolves to nothing
 * keeps the model's own numbers and is marked `source: "model"`, because
 * photo-scan is live and in users' hands: a scan that is approximate beats a
 * scan that errors. `source` is what lets the client say which is which
 * instead of presenting both with equal authority.
 */
export function resolveItem(foods: IndexedFood[], draft: DraftItem): ResolvedItem {
  const name = String(draft.name ?? "").trim().slice(0, 80) || "Food";
  const grams = clampGrams(draft.grams);
  const confidence = CONFIDENCE_SCORE[String(draft.confidence)] ?? 0.7;

  const modelFallback = (): ResolvedItem => ({
    name,
    grams,
    calories: Math.max(0, Math.round(draft.kcal ?? 0)),
    protein: Math.max(0, round1(draft.protein ?? 0)),
    carbs: Math.max(0, round1(draft.carbs ?? 0)),
    fat: Math.max(0, round1(draft.fat ?? 0)),
    // A model-sourced item is less trustworthy than the model's own confidence
    // suggests — that confidence was about recognition, and recognition is
    // exactly what failed if nothing matched.
    confidence: Math.min(confidence, 0.5),
    source: "model",
  });

  // A portion of ~0 g cannot be scaled into anything meaningful, so there is
  // nothing for the database to contribute even on a perfect name match.
  if (grams < MIN_GRAMS) return modelFallback();

  const match = resolvePhrase(foods, name, normalizeState(draft.state));
  if (!match) return modelFallback();

  const { kcal, protein, carb, fat } = match.per100;
  return {
    name,
    grams,
    calories: at(kcal, grams, true),
    protein: at(protein, grams),
    carbs: at(carb, grams),
    fat: at(fat, grams),
    confidence,
    source: "usda",
    fdcId: match.id,
    matchedDescription: match.desc,
  };
}

/** Resolve a whole scan. Order is preserved — the client renders these as rows. */
export function resolveItems(foods: IndexedFood[], drafts: DraftItem[]): ResolvedItem[] {
  return drafts.map((d) => resolveItem(foods, d));
}

/**
 * Sum resolved items into the flat whole-meal totals the wire contract keeps.
 *
 * Re-rounded at the end, not just per item: summing one-decimal macros
 * accumulates binary float error, and `60.900000000000006` g of protein would
 * go out on the wire and into a `DailyLog` exactly as written.
 */
export function totalsOf(items: ResolvedItem[]): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} {
  const sum = items.reduce(
    (acc, it) => ({
      calories: acc.calories + it.calories,
      protein: acc.protein + it.protein,
      carbs: acc.carbs + it.carbs,
      fat: acc.fat + it.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  return {
    calories: Math.round(sum.calories),
    protein: round1(sum.protein),
    carbs: round1(sum.carbs),
    fat: round1(sum.fat),
  };
}

/** Re-export so callers don't need to know the index type lives in usda-db. */
export type { UsdaFood };
