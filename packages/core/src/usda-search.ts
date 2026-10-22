/**
 * On-device USDA food search — the ranking that `searchFoods` runs on the
 * server, running instead inside the app against a bundled index.
 *
 * ## Why this exists
 *
 * `searchFoods` is a Cloud Function that answers from the same bundled dataset
 * (ADR-0018 — the live FDC API was retired), so the network round trip buys
 * nothing but latency. Measured against production: **392 ms warm (304–484) and
 * 2,141 ms cold**, and because traffic is low the FIRST search of a session is
 * usually the cold one. The client adds a 350 ms debounce on top of that.
 * Searching locally was a full-corpus scan in **2–4 ms** on a workstation and
 * ~20–40 ms on the LG G6 QA device; it is now an inverted index ("Speed").
 *
 * It also removes the per-uid rate limit, the Firestore search cache, and the
 * network from the typeahead entirely: search works with the radio off.
 *
 * ## Ranking parity with the server is enforced, not hoped for
 *
 * `functions/` is not a workspace and cannot import this package (see
 * `food-plausibility.ts` and the wire-contract note in `food-search.ts`), so
 * `functions/src/usda-db.ts` holds its own copy of these rules. Two
 * hand-maintained copies of a 100-line scoring function WILL drift, and the
 * drift would be invisible: both sides return plausible foods, just in a
 * different order, on a surface nobody diffs.
 *
 * So the parity is pinned by a **golden fixture**, `usda-search-golden.json`:
 * a corpus of queries with the exact top-N ids the server implementation
 * returns. `usda-search.test.ts` asserts THIS implementation reproduces it, and
 * `functions/src/usda-db.golden.test.ts` asserts the server one does too. Change
 * either ranking and both suites go red until the fixture is regenerated
 * deliberately, with `node scripts/build-food-golden.mjs`.
 *
 * That is the whole reason the scoring below is a transliteration rather than
 * an improvement. Do not "clean it up" in one copy.
 *
 * ## Shape
 *
 * The index is the compact form written by `scripts/build-food-index.mjs`:
 * positional rows with `dataType` and portion labels interned. {@link loadFoodIndex}
 * wraps the rows WITHOUT deriving anything; {@link searchFoodIndex} answers
 * from a search structure built once per corpus (see "Speed" below).
 *
 * ## Speed — the scoring rules are untouched; only WHEN they run changed
 *
 * Measured on a real Hermes VM (the iOS pod's macOS `hermesvm.framework`,
 * which interprets exactly like the device — no JIT), 13,272 foods:
 *
 *   | what (Hermes, M-series Mac)                 | before  | after             |
 *   |---------------------------------------------|--------:|------------------:|
 *   | evaluate the bundled JSON literal           |  3–8 ms | unchanged         |
 *   | `loadFoodIndex`                             |  252 ms | 6 ms              |
 *   | one-time {@link prepareFoodIndex}           |       — | 67 ms, as 14 × ≤7 ms slices |
 *   | first search on a never-warmed index        |  310 ms | 82 ms             |
 *   | "chicken" / "greek yogurt" / "ch"           | 32 / 23 / 58 ms | 1.2 / 1.1 / 2.7 ms |
 *   | "c" (one letter, ~half the corpus matches)  |  135 ms | 12 ms             |
 *   | typing "greek yogurt", all 12 keystrokes    |  349 ms | 17 ms             |
 *
 * A mid-range Android phone runs the same bytecode several times slower; the
 * ratios are what carry over.
 *
 * The JSON literal was never the cost — Hermes materialises it from bytecode
 * literal buffers in single-digit ms. The cost was the eager per-food regex
 * work in `loadFoodIndex` (one 252 ms task, several hundred on a mid-range
 * phone) and, per keystroke, re-running four regexes and re-stemming every
 * query token against every food.
 *
 * So the search is now an inverted index over a vocabulary of the corpus's
 * ~3,300 distinct words. A query token is classified ONCE per distinct word
 * (30 / 20 / 5, the {@link tokenScore} ladder), each word's posting list says
 * which foods carry it, and only the foods every token reaches are scored.
 * Everything query-independent — the PLAIN / PROCESSED / COMPOSITE / VAGUE
 * terms, the segment stem keys — is computed once per food, and once per
 * DISTINCT comma segment (7,626 of them across 50,575), because each of those
 * regexes provably cannot match across a comma (see {@link describeSegment}).
 *
 * Results are IDENTICAL to the linear scan, not merely close: same foods,
 * same order, same float scores. {@link searchFoodIndexReference} keeps the
 * linear scan verbatim as the oracle, and
 * `apps/mobile/src/__tests__/food-index-parity.test.ts` diffs the two over
 * hundreds of queries on the shipped index.
 *
 * A build-time precompute of the token data (the obvious next step, and the
 * first one tried) was measured and REJECTED. As numeric arrays it doubles the
 * index's bytecode, 1.97 → 3.90 MB. As a packed string it adds 266 KB to the
 * bundle and is slower than not having it: decoding it is a `charCodeAt` loop,
 * ~55 ms in Hermes, while tokenising the 7,626 distinct segments from scratch
 * is ~8 ms. So `scripts/build-food-index.mjs` and the v1 format are unchanged.
 */
import type { FoodDetail, FoodSearchHit, ServingOption } from './food-search';
import { queryNamesRestaurantChain } from './restaurant-chains';

/** The compact on-disk/bundle format. Positional by design — see the generator. */
export interface CompactFoodIndex {
  /** Layout version. {@link loadFoodIndex} refuses anything it does not know
   *  rather than misreading offsets, which is how a positional format fails. */
  v: number;
  dataTypes: string[];
  labels: string[];
  /** `[id, desc, dataTypeIdx, kcal, protein, carb, fat, [labelIdx, grams, …]]` */
  foods: CompactFoodRow[];
}

export type CompactFoodRow = [
  id: string,
  desc: string,
  dataTypeIdx: number,
  kcal: number,
  protein: number,
  carb: number,
  fat: number,
  portions: number[],
];

/** A food plus the lowercased forms the matcher needs. Mirrors `IndexedFood`
 *  in `functions/src/usda-db.ts`.
 *
 *  From {@link loadFoodIndex} every field is computed on FIRST READ, not at
 *  load: the search path no longer reads the derived ones at all (it has its
 *  own structure), so deriving them for 13,272 foods up front was ~250 ms of
 *  Hermes time spent on nothing. Treat the records as read-only. */
export interface IndexedFood {
  id: string;
  desc: string;
  dataType: string;
  per100: { kcal: number; protein: number; carb: number; fat: number };
  portions: { label: string; grams: number }[];
  norm: string;
  words: string[];
  /** Singular-folded words, so "carrot" matches "Carrots, raw". */
  wordStems: string[];
  /** Comma-delimited descriptor segments: "Fish, tuna, raw" → [fish, tuna, raw]. */
  segments: string[];
  /** The same segments as singular-folded words, for the leading-segment cover test. */
  segmentStems: string[][];
}

export const FOOD_INDEX_FORMAT_VERSION = 1;

// ─────────────────────────────────────────────────────────────────────────
// Scoring constants. Transliterated from `functions/src/usda-db.ts`; the
// reasoning for each lives there and is not duplicated. The golden fixture is
// what keeps the two in step.
// ─────────────────────────────────────────────────────────────────────────

const DATA_TYPE_BONUS: Record<string, number> = {
  foundation_food: 4,
  sr_legacy_food: 2,
  survey_fndds_food: 2,
};

const VAGUE_MARKERS =
  /\b(nfs|ns as to|not further specified|not specified|skin (not )?eaten)\b/;

const PLAIN = /\b(raw|whole|plain|unprepared)\b/;
const PROCESSED =
  /\b(dried|dehydrated|powder|powdered|concentrate|canned|frozen|fried|breaded|sweetened|jerky|chips|candied|salad|sandwich|burrito|casserole|soup|dip|pie|cake|patty|roll)\b/g;
const COMPOSITE = /\b(with|and|or)\b/g;

const MAX_DESCRIPTION = 140;
const MAX_SERVINGS = 12;

/** Split into lowercase alphanumeric words — the unit both sides match on. */
export function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9.]+/i).filter(Boolean);
}

/** Fold a trailing plural "s", so a query matches USDA's spelling of the food.
 *  Deliberately not a real stemmer — see `usda-db.ts` for why. */
export function stem(w: string): string {
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
  if (w.length > 4 && w.endsWith('oes')) return w.slice(0, -2);
  if (w.length > 4 && /(?:s|x|z|ch|sh)es$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function stems(list: string[]): string[] {
  return list.map(stem);
}

export function normalizeQuery(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Wrap the compact index's rows as {@link IndexedFood}s — and derive nothing.
 *
 * This used to be deliberately eager ("`scoreFood` reads `wordStems` for EVERY
 * food on EVERY keystroke"), and that was the right call for a linear scan. It
 * is not one any more: {@link searchFoodIndex} reads its own inverted index,
 * built by {@link prepareFoodIndex}, and the derived fields here are read only
 * by {@link scoreFood} / {@link searchFoodIndexReference} — tests and oracles.
 * So this is ~2 ms of object wrapping (Hermes, Mac) where it was ~256 ms of
 * regex splitting in one uninterruptible task.
 */
export function loadFoodIndex(index: CompactFoodIndex): IndexedFood[] {
  if (index.v !== FOOD_INDEX_FORMAT_VERSION) {
    throw new Error(
      `food index format v${index.v} is not supported (expected v${FOOD_INDEX_FORMAT_VERSION}) — rebuild with scripts/build-food-index.mjs`,
    );
  }
  const tables: Tables = { dataTypes: index.dataTypes, labels: index.labels };
  const rows = index.foods;
  const out: IndexedFood[] = new Array(rows.length);
  for (let i = 0; i < rows.length; i++) out[i] = new LazyFood(rows[i], tables);
  return out;
}

interface Tables {
  dataTypes: string[];
  labels: string[];
}

/**
 * One food, decoded field by field on first read and memoised.
 *
 * Each getter is the exact expression the old eager decode used, so a field
 * read here is byte-identical to the one that used to be precomputed —
 * `usda-search.test.ts` "precomputes the matcher fields" still pins them.
 * `per100` and `portions` are lazy too: 35,594 portion objects were being
 * allocated at load for a picker that shows one food's worth at a time.
 */
class LazyFood implements IndexedFood {
  private _per100?: IndexedFood['per100'];
  private _portions?: IndexedFood['portions'];
  private _norm?: string;
  private _words?: string[];
  private _wordStems?: string[];
  private _segments?: string[];
  private _segmentStems?: string[][];

  constructor(
    private readonly r: CompactFoodRow,
    private readonly t: Tables,
  ) {}

  get id(): string {
    return this.r[0];
  }
  get desc(): string {
    return this.r[1];
  }
  get dataType(): string {
    return this.t.dataTypes[this.r[2]];
  }
  get per100(): IndexedFood['per100'] {
    const r = this.r;
    return (this._per100 ??= { kcal: r[3], protein: r[4], carb: r[5], fat: r[6] });
  }
  get portions(): IndexedFood['portions'] {
    if (!this._portions) {
      const portions: { label: string; grams: number }[] = [];
      const flat = this.r[7];
      for (let i = 0; i < flat.length; i += 2) {
        portions.push({ label: this.t.labels[flat[i]], grams: flat[i + 1] });
      }
      this._portions = portions;
    }
    return this._portions;
  }
  get norm(): string {
    return (this._norm ??= this.r[1].toLowerCase());
  }
  get words(): string[] {
    return (this._words ??= words(this.r[1]));
  }
  get wordStems(): string[] {
    return (this._wordStems ??= stems(words(this.r[1])));
  }
  get segments(): string[] {
    return (this._segments ??= this.norm.split(',').map((s) => s.trim()));
  }
  get segmentStems(): string[][] {
    return (this._segmentStems ??= this.norm.split(',').map((s) => stems(words(s))));
  }
}

export interface ScoreOptions {
  /** Processed/composite words the QUERY itself used, whose penalty is waived. */
  waiveProcessed?: string[];
  /** Whether the PLAIN bonus applies. Defaults to on. */
  plainBonus?: boolean;
}

/** Score one food against the query tokens, or null when it doesn't match. */
export function scoreFood(
  food: IndexedFood,
  tokens: string[],
  query: string,
  opts: ScoreOptions = {},
): number | null {
  let score = 0;
  for (const t of tokens) {
    const s = tokenScore(food, t);
    if (s === null) return null;
    score += s;
  }

  score += headMatchBonus(food, tokens, query);

  score += Math.max(0, 70 - food.desc.length) / 3;
  if ((opts.plainBonus ?? true) && PLAIN.test(food.norm)) score += 12;
  score -= 18 * countMatches(food.norm, PROCESSED, opts.waiveProcessed);
  score -= 25 * countMatches(food.norm, COMPOSITE, opts.waiveProcessed);
  score += DATA_TYPE_BONUS[food.dataType] ?? 0;
  if (VAGUE_MARKERS.test(food.norm)) score -= 25;

  return score;
}

function countMatches(s: string, re: RegExp, waive?: string[]): number {
  const hits = s.match(re) ?? [];
  if (!waive?.length) return hits.length;
  const forgiven = new Set(waive.map((w) => w.toLowerCase()));
  return hits.filter((h) => !forgiven.has(h.toLowerCase())).length;
}

/** Reward a food whose descriptor list is *headed* by what was asked for. */
function headMatchBonus(food: IndexedFood, tokens: string[], query: string): number {
  if (food.norm === query) return 1000;
  if (leadingSegmentsCover(food, tokens)) return 200;

  const queryStem = stems(tokens).join(' ');
  const headStem = stem(tokens[tokens.length - 1]);
  const limit = Math.min(food.segments.length, 3);
  for (let i = 0; i < limit; i++) {
    const seg = food.segmentStems[i].join(' ');
    if (seg === queryStem) return 200 - 30 * i;
    if (seg === headStem) return 120 - 30 * i;
  }

  if (food.norm.startsWith(query)) return 60;
  if (food.norm.includes(query)) return 20;
  return 0;
}

/** True when the leading segments spell out exactly the query and nothing more. */
function leadingSegmentsCover(food: IndexedFood, tokens: string[]): boolean {
  const target = stems(tokens).sort().join(' ');
  const acc: string[] = [];
  const limit = Math.min(food.segmentStems.length, 3);
  for (let i = 0; i < limit; i++) {
    acc.push(...food.segmentStems[i]);
    if (acc.length > tokens.length) return false;
    if (acc.length === tokens.length && [...acc].sort().join(' ') === target) return true;
  }
  return false;
}

/** How well one query token matches one food, or null for not at all.
 *  Extracted so the strict AND above and {@link headAnchoredTokens} below
 *  cannot drift apart — the fallback has to ask exactly the question the
 *  scorer asks, or it will discard a word the scorer would have accepted. */
function tokenScore(food: IndexedFood, t: string): number | null {
  const s = stem(t);
  if (food.wordStems.includes(s)) return TOKEN_WHOLE;
  if (food.wordStems.some((w) => w.startsWith(s))) return TOKEN_PREFIX;
  if (food.norm.includes(t)) return TOKEN_SUBSTRING;
  return null;
}

// Named once because {@link tokenMatch} asks the same ladder per word. They
// must stay in 1..255 (stored in a Uint8Array) and nonzero (0 means "no match").
const TOKEN_WHOLE = 30;
const TOKEN_PREFIX = 20;
const TOKEN_SUBSTRING = 5;

/**
 * The longest run of query words, anchored on the last one, that some single
 * food actually satisfies.
 *
 * {@link scoreFood} is an AND, so ONE word the database never writes empties an
 * otherwise good query: "pure honey" and "natural peanut butter" both returned
 * NOTHING from an index holding Honey and Peanut butter. ("plain greek yogurt"
 * and "grilled chicken breast" work only because USDA happens to use those
 * adjectives — a user cannot know which of their words is which.)
 *
 * Walks RIGHT TO LEFT because the head noun of an English noun phrase is its
 * last word: "pure HONEY", "natural peanut BUTTER". Anchoring there keeps the
 * thing being named and discards only the modifiers the database cannot honour.
 * Left to right instead would keep "pure" and answer with tomato puree, which
 * contains "pure" as a substring — that is not a hypothetical, it is what the
 * first version of this did.
 *
 * Dropping words rather than scoring them as absent is deliberate: a partial
 * score has to compete with `headMatchBonus`, which is worth hundreds, so
 * "Butter, tub" outranked "Peanut butter" for "natural peanut butter" on a
 * gap penalty of any sane size. Here the survivors are ranked by the untouched
 * scorer, exactly as if the user had typed only those words.
 */
function headAnchoredTokens(foods: IndexedFood[], tokens: string[]): string[] {
  const keep: string[] = [];
  let candidates = foods;
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const next = candidates.filter((f) => tokenScore(f, tokens[i]) !== null);
    if (next.length > 0) {
      keep.unshift(tokens[i]);
      candidates = next;
    }
  }
  return keep;
}

/**
 * Head-anchored GENERALISATIONS of a query, longest first: "hass avocado" ->
 * ["avocado"], "boneless skinless chicken thigh" -> ["skinless chicken thigh",
 * "chicken thigh", "thigh"].
 *
 * ## Why this is not {@link headAnchoredTokens}
 *
 * That one drops words the corpus **cannot honour**, and it fires when a query
 * matched nothing. This one drops words the corpus honours perfectly well, and
 * it fires when every match is a food that cannot answer the utterance — the
 * "1/2 hass avocado" case. `Avocado, Hass, peeled, raw` exists, ranks first and
 * carries no portion row at all, so a bare count falls to half of 100 g and is
 * flagged `assumed`; `Avocado, raw` carries the `1 fruit (150 g)` row the user
 * needs and is never a candidate, because "hass" is not in it and `scoreFood`
 * is an AND. Relaxation therefore has to be able to drop a word the database
 * DOES know, which is precisely what `headAnchoredTokens` will never do.
 *
 * Anchored on the last word for the same reason: the head noun of an English
 * noun phrase is its last word, so trimming from the left keeps the thing being
 * named and discards only its modifiers.
 *
 * **Refused outright for restaurant chains**, on the standing rule that dropping
 * "starbucks" from "starbucks latte" answers about a different product rather
 * than loosening a qualifier. Same guard as {@link searchFoodIndex}, restated
 * here because this is a second entrance to the same hazard.
 */
export function headAnchoredGeneralisations(rawQuery: string): string[] {
  const query = normalizeQuery(rawQuery);
  if (queryNamesRestaurantChain(query)) return [];
  const tokens = words(query);
  const out: string[] = [];
  for (let i = 1; i < tokens.length; i += 1) out.push(tokens.slice(i).join(' '));
  return out;
}

/**
 * True when `candidate` only DROPS qualifiers relative to `specific` — never
 * acquires one nobody asked for.
 *
 * ## This predicate is the whole safety story, and it was measured
 *
 * Relaxing on "every candidate came back assumed" alone is ACTIVELY HARMFUL.
 * Surveyed against the shipped index, a bare drop-a-modifier retry fixed the
 * avocado and broke four other utterances, every one of them by swapping to a
 * DIFFERENT food in order to obtain a confident-looking number:
 *
 * | utterance | assumed answer | what relaxing gave instead |
 * |---|---|---|
 * | 1 cup greek yogurt | Yogurt, Greek, plain, nonfat | Yogurt, plain, **whole milk** |
 * | 1 red bell pepper | Peppers, bell, red, raw | Peppers, **hot**, raw (5 kcal) |
 * | 1 boneless skinless chicken thigh | Chicken, thigh, boneless, skinless, raw | Chicken thigh, **fried, coated** |
 * | 2 roma tomatoes | Tomato, roma | Tomatoes, raw — 8 kcal for two tomatoes |
 *
 * So `assumed` is NOT evidence the strict hit is the wrong food. In all four
 * the strict hit is exactly right and only its portion size is unknown, and
 * trading the food away to gain a portion number is the more expensive error:
 * an honest `assumed` flag understates precision, a confident wrong food
 * fabricates it. What separates the avocado is that `Avocado, raw` is the same
 * food with a qualifier removed, while `Yogurt, plain, whole milk` is a sibling
 * that adds "whole" and "milk" and contradicts "nonfat".
 *
 * Hence the rule: every content word of the candidate must already appear in
 * the specific hit, or in what the user actually typed. Compared on stems so
 * "Tomatoes" and "Tomato" are not treated as different words. Ties are refused
 * rather than accepted — refusing keeps the honest `assumed` row, which is the
 * safe direction.
 *
 * ## The second half: a SUBTRACTIVE qualifier can never be dropped
 *
 * Word-subset alone is not enough, and the case that proves it is
 * "1 yukon gold potato". The specific hit is `Potatoes, gold, without skin,
 * raw`; relax to "potato" and the winner is `Potatoes, raw, skin` — whose words
 * are a strict subset, and which is the potato SKIN, 22 kcal for 38 g. Dropping
 * "without" did not loosen a qualifier, it inverted one.
 *
 * The same trap without the tell: `Yogurt, Greek, plain, nonfat` -> `Yogurt,
 * plain` is a clean subset that silently puts the fat back.
 *
 * So a word that REMOVES something from the food is not droppable, because
 * dropping it adds that thing back. Additive qualifiers ("hass", "honeycrisp",
 * "peeled") stay droppable, which is the whole point of the mechanism.
 */
const SUBTRACTIVE =
  /\b(without|no|non|nonfat|not|free|low|reduced|less|lean|light|lite|skim|skimmed|unsweetened|unsalted|decaffeinated|diet)\b/;

export function generalisesFood(specific: string, candidate: string, query = ''): boolean {
  const spec = words(specific);
  const cand = words(candidate);
  const allowed = new Set([...stems(spec), ...stems(query ? words(query) : [])]);
  if (!stems(cand).every((w) => allowed.has(w))) return false;
  // Never drop a subtractive qualifier: "without skin" -> "skin" inverts, and
  // "nonfat" -> "" refills. Note the query is NOT an escape hatch here the way
  // it is for the subset test above: a user who typed "skim milk" has made
  // "skim" more load-bearing, not less, so dropping it to reach plain `Milk`
  // is the very substitution this refuses.
  const candSet = new Set(cand);
  return spec.every((w) => !SUBTRACTIVE.test(w) || candSet.has(w));
}

/**
 * Rank the bundled dataset against a typeahead query — through the inverted
 * index (see "Speed" in the header), with results identical to
 * {@link searchFoodIndexReference}.
 *
 * Ties break on description length then id so the ordering is total and stable
 * — which is what makes the golden fixture meaningful at all.
 *
 * The index is built once per `foods` ARRAY and kept in a WeakMap keyed on
 * it, so pass the same array every time (what {@link loadFoodIndex} returned)
 * and do not mutate it. A fresh array per call — `foods.filter(...)` — would
 * rebuild the index on every call and be slower than the scan it replaces.
 *
 * If {@link prepareFoodIndex} has not finished, the rest of the preparation
 * runs HERE, synchronously, before answering. Searching only the prepared
 * part would be faster and wrong: a typeahead that silently omits the foods
 * it has not reached yet ranks a worse match first, and nothing on screen
 * says so. Correctness over speed — the warm-up exists so this never happens.
 */
export function searchFoodIndex(foods: IndexedFood[], rawQuery: string, size: number): FoodSearchHit[] {
  const query = normalizeQuery(rawQuery);
  const tokens = words(query);
  if (tokens.length === 0) return [];
  const engine = engineFor(foods);
  prepareFoodIndex(foods);
  return answer(
    query,
    tokens,
    (t, q) => engineCollect(engine, t, q, size),
    (t) => engineHeadAnchoredTokens(engine, t),
  );
}

/**
 * The linear scan this module shipped with, kept verbatim as the ORACLE that
 * {@link searchFoodIndex} must reproduce exactly. Not for production: it runs
 * {@link scoreFood} — four regexes and a stem per token — against every food
 * on every call. `food-index-parity.test.ts` diffs the two.
 */
export function searchFoodIndexReference(
  foods: IndexedFood[],
  rawQuery: string,
  size: number,
): FoodSearchHit[] {
  const query = normalizeQuery(rawQuery);
  const tokens = words(query);
  if (tokens.length === 0) return [];
  return answer(
    query,
    tokens,
    (t, q) => collectReference(foods, t, q, size),
    (t) => headAnchoredTokens(foods, t),
  );
}

/** The strict-then-relaxed policy both paths share, so they cannot disagree
 *  on WHEN to relax — only on how fast they score. */
function answer(
  query: string,
  tokens: string[],
  collect: (tokens: string[], query: string) => FoodSearchHit[],
  headAnchored: (tokens: string[]) => string[],
): FoodSearchHit[] {
  const strict = collect(tokens, query);
  if (strict.length > 0 || tokens.length < 2) return strict;
  // Nothing matched every word. Retry with only the words the database can
  // honour, rather than showing the user an empty result. Fallback ONLY: a
  // query that found anything keeps its exact ranking, and the extra pass is
  // paid where the alternative was nothing at all.
  // A query that names a restaurant chain is NOT relaxed. Dropping "starbucks"
  // from "starbucks latte" does not loosen a qualifier — it answers about a
  // different product, and presenting a generic latte's macros as the answer to
  // a Starbucks question is fabricating health data. That is a standing rule
  // here, locked by the absence test in functions/test/usda-db.spec.ts; chain
  // queries are served by the MenuStat corpus (ADR-0027), not by this index.
  if (queryNamesRestaurantChain(query)) return strict;
  const kept = headAnchored(tokens);
  if (kept.length === 0 || kept.length === tokens.length) return strict;
  return collect(kept, kept.join(' '));
}

function collectReference(
  foods: IndexedFood[],
  tokens: string[],
  query: string,
  size: number,
): FoodSearchHit[] {
  const scored: { food: IndexedFood; score: number }[] = [];
  for (const food of foods) {
    const score = scoreFood(food, tokens, query);
    if (score !== null) scored.push({ food, score });
  }

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.food.desc.length - b.food.desc.length ||
      a.food.id.localeCompare(b.food.id),
  );

  return scored.slice(0, size).map(({ food }) => toHit(food));
}

function toHit(food: IndexedFood): FoodSearchHit {
  return {
    source: 'fdc' as const,
    id: food.id,
    description: food.desc.slice(0, MAX_DESCRIPTION),
    dataType: food.dataType,
    servings: buildFoodDetail(food).servings,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The inverted index behind `searchFoodIndex`.
//
// Every function below computes a value the reference path computes, from
// the same inputs, by the same expression — it only changes how often. Each
// equivalence that is not literally the same expression is argued where it is
// used, and all of them are diffed against the reference on the real corpus.
// ─────────────────────────────────────────────────────────────────────────

/** What one DISTINCT comma segment contributes. Shared by every food that
 *  carries the same segment text — " raw" alone is in thousands of foods. */
interface SegInfo {
  /** Vocabulary ids of the segment's words, in order. */
  ids: number[];
  /** `stems(words(segment)).join(' ')` — what {@link headMatchBonus} compares. */
  stemKey: string;
  plain: boolean;
  processed: number;
  composite: number;
  vague: boolean;
}

/** One query token's verdict over the whole corpus. */
interface TokenMatch {
  /** Per food: the {@link tokenScore} value, 0 where it would be null. */
  score: Uint8Array;
  /** The matching foods, ascending — corpus order, which is what keeps the
   *  stable sort's tie order identical to the reference scan's. */
  foods: Int32Array;
}

interface Engine {
  foods: IndexedFood[];
  n: number;
  /** Foods `[0, done)` are indexed; the rest wait for {@link prepareFoodIndex}. */
  done: number;
  vocab: string[];
  vocabStem: string[];
  vocabId: Map<string, number>;
  /** Per vocabulary id: the foods carrying that word, ascending, no repeats. */
  postings: number[][];
  segCache: Map<string, SegInfo>;
  /** Food f's segments are `segs[segOff[f] .. segOff[f + 1])`. */
  segOff: Int32Array;
  segs: SegInfo[];
  norm: string[];
  descLen: Int32Array;
  plain: Uint8Array;
  processed: Int32Array;
  composite: Int32Array;
  vague: Uint8Array;
  dataBonus: number[];
  /** Filled on demand: sorted stems of food f's first k+1 segments, joined,
   *  at `3 * f + k` — {@link leadingSegmentsCover}'s left-hand side. */
  coverKeys: (string | undefined)[];
  /** Recent tokens' matches. Typing "greek yogurt" re-asks "greek" for every
   *  letter of "yogurt"; it is answered once. */
  tokenCache: Map<string, TokenMatch>;
}

const TOKEN_CACHE_SIZE = 32;

const engines = new WeakMap<IndexedFood[], Engine>();

function engineFor(foods: IndexedFood[]): Engine {
  let e = engines.get(foods);
  // A length change means the caller mutated the array; rebuild rather than
  // answer from a stale index. (An in-place replacement is undetectable —
  // hence "do not mutate it" on searchFoodIndex.)
  if (!e || e.n !== foods.length) {
    const n = foods.length;
    e = {
      foods,
      n,
      done: 0,
      vocab: [],
      vocabStem: [],
      vocabId: new Map(),
      postings: [],
      segCache: new Map(),
      segOff: new Int32Array(n + 1),
      segs: [],
      norm: new Array<string>(n),
      descLen: new Int32Array(n),
      plain: new Uint8Array(n),
      processed: new Int32Array(n),
      composite: new Int32Array(n),
      vague: new Uint8Array(n),
      dataBonus: new Array<number>(n),
      coverKeys: new Array<string | undefined>(3 * n),
      tokenCache: new Map(),
    };
    engines.set(foods, e);
  }
  return e;
}

/**
 * Build up to `maxFoods` more foods' worth of the search index; true once the
 * whole corpus is indexed (and from then on, a no-op that returns true).
 *
 * This is the one-time cost the old eager `loadFoodIndex` paid in a single
 * 252 ms task, made ~4x cheaper (67 ms, see the header) and SPLITTABLE: a caller
 * with idle time calls it in slices so no frame ever waits on more than one.
 * Calling {@link searchFoodIndex} early is safe — it finishes the remainder.
 * Infinity (the default) does it all now.
 */
export function prepareFoodIndex(foods: IndexedFood[], maxFoods = Infinity): boolean {
  const e = engineFor(foods);
  if (e.done === e.n) return true;
  const end = Math.min(e.n, e.done + (maxFoods >= 1 ? Math.floor(maxFoods) : 1));
  try {
    for (let f = e.done; f < end; f++) {
      indexFood(e, f);
      e.done = f + 1;
    }
  } catch (err) {
    // A food that threw has half-written its segments; start clean next time
    // rather than build on a torn index.
    engines.delete(foods);
    throw err;
  }
  if (e.done < e.n) return false;
  // Only ever read while indexing.
  e.segCache.clear();
  e.vocabId.clear();
  return true;
}

function indexFood(e: Engine, f: number): void {
  const food = e.foods[f];
  const norm = food.norm;
  e.norm[f] = norm;
  e.descLen[f] = food.desc.length;
  e.dataBonus[f] = DATA_TYPE_BONUS[food.dataType] ?? 0;
  let plain = false;
  let vague = false;
  let processed = 0;
  let composite = 0;
  // `norm.split(',')` is exactly the segmentation `segments` / `segmentStems`
  // use, untrimmed so a segment's word-boundary context is preserved.
  const parts = norm.split(',');
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    let seg = e.segCache.get(p);
    if (seg === undefined) {
      seg = describeSegment(e, p);
      e.segCache.set(p, seg);
    }
    e.segs.push(seg);
    const ids = seg.ids;
    for (let k = 0; k < ids.length; k++) {
      const post = e.postings[ids[k]];
      if (post[post.length - 1] !== f) post.push(f);
    }
    if (seg.plain) plain = true;
    if (seg.vague) vague = true;
    processed += seg.processed;
    composite += seg.composite;
  }
  e.segOff[f + 1] = e.segs.length;
  e.plain[f] = plain ? 1 : 0;
  e.vague[f] = vague ? 1 : 0;
  e.processed[f] = processed;
  e.composite[f] = composite;
}

/**
 * Everything {@link scoreFood} would derive from one comma segment.
 *
 * ## Why per SEGMENT is exact, not an approximation
 *
 * {@link scoreFood} runs PLAIN / PROCESSED / COMPOSITE / VAGUE over the whole
 * `norm`. None of their alternatives contains a comma, so no match can span
 * one; and a comma is a non-word character, so `\b` at a segment's edge sees
 * the same boundary that the string start/end does. A whole-string `.test` is
 * therefore the OR of the per-segment tests, and a `/g` match count is the
 * SUM of per-segment counts. The same holds for {@link words}: a comma is a
 * separator, so the words of `norm` are the concatenation of its segments'
 * words — which is also why `wordStems` and `segmentStems` never disagree.
 *
 * ## Why most segments skip the regexes entirely
 *
 * Regexes are the slowest thing Hermes does here (~5 µs a test). Each one is
 * gated by {@link mayMatch}, a necessary condition read off the regex's own
 * source by {@link literalHeads}; only a segment that passes it runs the regex,
 * and the regex still decides. The gate can say "maybe" wrongly, never "no".
 */
function describeSegment(e: Engine, p: string): SegInfo {
  const ws = segmentWords(p);
  const ids = new Array<number>(ws.length);
  const st = new Array<string>(ws.length);
  for (let k = 0; k < ws.length; k++) {
    const w = ws[k];
    let id = e.vocabId.get(w);
    if (id === undefined) {
      id = e.vocab.length;
      e.vocab.push(w);
      e.vocabStem.push(stem(w));
      e.vocabId.set(w, id);
      e.postings.push([]);
    }
    ids[k] = id;
    st[k] = e.vocabStem[id];
  }
  return {
    ids,
    stemKey: st.join(' '),
    plain: mayMatch(PLAIN_HEADS, ws) && PLAIN.test(p),
    processed: mayMatch(PROCESSED_HEADS, ws) ? (p.match(PROCESSED) ?? []).length : 0,
    composite: mayMatch(COMPOSITE_HEADS, ws) ? (p.match(COMPOSITE) ?? []).length : 0,
    vague: mayMatch(VAGUE_HEADS, ws) && VAGUE_MARKERS.test(p),
  };
}

/**
 * {@link words} for an already-lowercased string: the maximal runs of
 * `[a-zA-Z0-9.]`, which is exactly what `split(/[^a-z0-9.]+/i)` plus
 * `filter(Boolean)` leaves — a non-unicode `/i` class never folds a character
 * >= 128 onto ASCII, so non-ASCII is a separator in both.
 *
 * Matching the runs instead of splitting on the gaps, and without `/i` or the
 * `toLowerCase`, is ~5x cheaper in Hermes (whose regex engine pays heavily
 * for case folding) — 8 ms over the 7,626 distinct segments, where a
 * hand-written `charCodeAt` loop measured 16 ms.
 */
const WORD_RUN = /[a-zA-Z0-9.]+/g;

function segmentWords(s: string): string[] {
  return s.match(WORD_RUN) ?? [];
}

/**
 * The words that every match of `\b(alt|alt|…)\b` must START with, or null
 * when the source is not simple enough to read that off safely (then the
 * regex always runs).
 *
 * Each alternative must open with a literal `[a-z0-9]+` followed by a
 * MANDATORY space or the end of the alternative. Between the leading `\b` and
 * that separator, the head is a maximal regex-word run (`[A-Za-z0-9_]`) in the
 * subject — so the {@link segmentWords} token that contains it is either the
 * head itself or contains a `.` (the one character that is a word char for
 * the tokenizer and not for `\b`). {@link mayMatch} tests exactly that.
 */
function literalHeads(re: RegExp): Set<string> | null {
  if (re.flags !== '' && re.flags !== 'g') return null;
  const m = /^\\b\((.*)\)\\b$/.exec(re.source);
  if (!m || /[\\[]/.test(m[1])) return null;
  const body = m[1];
  const alts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === '|' && depth === 0) {
      alts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  alts.push(body.slice(start));
  const heads = new Set<string>();
  for (const alt of alts) {
    const h = /^[a-z0-9]+(?= [^?*+{]|$)/.exec(alt);
    if (!h) return null;
    heads.add(h[0]);
  }
  return heads;
}

const PLAIN_HEADS = literalHeads(PLAIN);
const PROCESSED_HEADS = literalHeads(PROCESSED);
const COMPOSITE_HEADS = literalHeads(COMPOSITE);
const VAGUE_HEADS = literalHeads(VAGUE_MARKERS);

function mayMatch(heads: Set<string> | null, ws: string[]): boolean {
  if (heads === null) return true;
  for (let i = 0; i < ws.length; i++) {
    if (heads.has(ws[i]) || ws[i].includes('.')) return true;
  }
  return false;
}

/**
 * {@link tokenScore} for one query token against every food at once.
 *
 * Per food the reference asks: does a word's stem EQUAL the token's (30),
 * does one START with it (20), does `norm` CONTAIN the token (5)? The first
 * two are questions about single words, so they are asked once per distinct
 * word and spread to foods through the postings, keeping each food's best.
 * The third is too, because a token is made only of `[a-z0-9.]` characters:
 * any occurrence of it in `norm` lies inside one maximal run of those, which
 * is one of the food's words. So "norm contains t" is "some word contains t".
 */
function tokenMatch(e: Engine, t: string): TokenMatch {
  const cached = e.tokenCache.get(t);
  if (cached) {
    e.tokenCache.delete(t);
    e.tokenCache.set(t, cached);
    return cached;
  }
  const s = stem(t);
  const score = new Uint8Array(e.n);
  const touched: number[] = [];
  const { vocab, vocabStem, postings } = e;
  for (let id = 0; id < vocab.length; id++) {
    const ws = vocabStem[id];
    const v =
      ws === s ? TOKEN_WHOLE : ws.startsWith(s) ? TOKEN_PREFIX : vocab[id].includes(t) ? TOKEN_SUBSTRING : 0;
    if (v === 0) continue;
    const post = postings[id];
    for (let k = 0; k < post.length; k++) {
      const f = post[k];
      const prev = score[f];
      if (prev === 0) touched.push(f);
      if (v > prev) score[f] = v;
    }
  }
  const match: TokenMatch = { score, foods: Int32Array.from(touched).sort() };
  e.tokenCache.set(t, match);
  if (e.tokenCache.size > TOKEN_CACHE_SIZE) {
    const oldest = e.tokenCache.keys().next();
    if (!oldest.done) e.tokenCache.delete(oldest.value);
  }
  return match;
}

interface Ranked {
  f: number;
  score: number;
  len: number;
}

/**
 * {@link collectReference}, scoring only the foods every token reaches.
 *
 * The arithmetic is {@link scoreFood}'s, statement for statement and in the
 * same order — not merely the same terms. Scores carry a float tail (the
 * brevity term divides by 3), and `(a + b) + c` is not always `a + (b + c)`;
 * a reordered sum could split a tie the reference keeps, or keep one it
 * splits, and the description-length tiebreak would then flip two rows.
 */
function engineCollect(e: Engine, tokens: string[], query: string, size: number): FoodSearchHit[] {
  const matches = tokens.map((t) => tokenMatch(e, t));
  let driver = matches[0];
  for (const m of matches) if (m.foods.length < driver.foods.length) driver = m;

  // Every query-side derivation, once — the reference recomputes these per
  // matched food.
  const n = tokens.length;
  const queryStem = stems(tokens).join(' ');
  const headStem = stem(tokens[n - 1]);
  const coverTarget = stems(tokens).sort().join(' ');

  const cmp = (a: Ranked, b: Ranked): number =>
    b.score - a.score || a.len - b.len || e.foods[a.f].id.localeCompare(e.foods[b.f].id);
  // Only the top `size` are ever shown, so keep only those, instead of
  // sorting every match: a short query matches thousands of foods, and each
  // sort comparison that ties falls through to `localeCompare`, which is the
  // slowest call in this file. Any other `size` takes the reference's path.
  const bounded = Number.isInteger(size) && size > 0;
  const ranked: Ranked[] = [];

  const cand = driver.foods;
  for (let c = 0; c < cand.length; c++) {
    const f = cand[c];
    let score = 0;
    let all = true;
    for (let j = 0; j < matches.length; j++) {
      const v = matches[j].score[f];
      if (v === 0) {
        all = false;
        break;
      }
      score += v;
    }
    if (!all) continue;

    score += engineHeadMatchBonus(e, f, query, n, queryStem, headStem, coverTarget);
    score += Math.max(0, 70 - e.descLen[f]) / 3;
    if (e.plain[f]) score += 12;
    score -= 18 * e.processed[f];
    score -= 25 * e.composite[f];
    score += e.dataBonus[f];
    if (e.vague[f]) score -= 25;

    const r: Ranked = { f, score, len: e.descLen[f] };
    if (!bounded) {
      ranked.push(r);
      continue;
    }
    // Stable insertion into the kept top `size`. Candidates arrive in corpus
    // order, the order the reference's stable sort breaks exact ties by, so a
    // newcomer goes AFTER every kept row it ties — and when the list is full,
    // one that ties the last row is out, as it would be after sort + slice.
    if (ranked.length === size && cmp(r, ranked[size - 1]) >= 0) continue;
    let i = ranked.length;
    while (i > 0 && cmp(ranked[i - 1], r) > 0) i--;
    ranked.splice(i, 0, r);
    if (ranked.length > size) ranked.pop();
  }

  const top = bounded ? ranked : ranked.sort(cmp).slice(0, size);
  return top.map((r) => toHit(e.foods[r.f]));
}

/** {@link headMatchBonus} + {@link leadingSegmentsCover}, reading the
 *  per-segment stem keys instead of re-stemming the food on every call. */
function engineHeadMatchBonus(
  e: Engine,
  f: number,
  query: string,
  n: number,
  queryStem: string,
  headStem: string,
  coverTarget: string,
): number {
  const norm = e.norm[f];
  if (norm === query) return 1000;

  const s0 = e.segOff[f];
  const limit = Math.min(e.segOff[f + 1] - s0, 3);
  // leadingSegmentsCover: the word COUNT decides most foods without ever
  // building the sorted key — it is only needed when the counts are equal.
  let acc = 0;
  for (let i = 0; i < limit; i++) {
    acc += e.segs[s0 + i].ids.length;
    if (acc > n) break;
    if (acc === n && coverKey(e, f, i) === coverTarget) return 200;
  }

  for (let i = 0; i < limit; i++) {
    const seg = e.segs[s0 + i].stemKey;
    if (seg === queryStem) return 200 - 30 * i;
    if (seg === headStem) return 120 - 30 * i;
  }

  if (norm.startsWith(query)) return 60;
  if (norm.includes(query)) return 20;
  return 0;
}

function coverKey(e: Engine, f: number, k: number): string {
  const at = 3 * f + k;
  let key = e.coverKeys[at];
  if (key === undefined) {
    const acc: string[] = [];
    const s0 = e.segOff[f];
    for (let i = 0; i <= k; i++) {
      for (const id of e.segs[s0 + i].ids) acc.push(e.vocabStem[id]);
    }
    key = acc.sort().join(' ');
    e.coverKeys[at] = key;
  }
  return key;
}

/** {@link headAnchoredTokens} over the postings: the same right-to-left walk,
 *  narrowing a candidate list instead of re-filtering the corpus per word. */
function engineHeadAnchoredTokens(e: Engine, tokens: string[]): string[] {
  const keep: string[] = [];
  let candidates: Int32Array | null = null; // null = every food
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const m = tokenMatch(e, tokens[i]);
    const next: Int32Array = candidates === null ? m.foods : candidates.filter((f) => m.score[f] !== 0);
    if (next.length > 0) {
      keep.unshift(tokens[i]);
      candidates = next;
    }
  }
  return keep;
}

/** Look up one food by its FDC id. */
export function findFoodById(foods: IndexedFood[], id: string): IndexedFood | undefined {
  return foods.find((f) => f.id === id);
}

/**
 * Build the portion picker for a food: the canonical per-100 g row plus each
 * household measure, macros pre-scaled. Mirrors `buildUsdaDetail` — same
 * rounding, same "(148 g)" label suffix, same 12-row cap — so a client cannot
 * tell which side answered.
 */
export function buildFoodDetail(food: IndexedFood): FoodDetail {
  const { kcal, protein, carb, fat } = food.per100;
  const at = (ratio: number): ServingOption => ({
    label: '',
    grams: 0,
    kcal: Math.round(kcal * ratio),
    protein: Math.round(protein * ratio),
    carbs: Math.round(carb * ratio),
    fat: Math.round(fat * ratio),
    kind: 'portion',
  });

  const servings: ServingOption[] = [
    { ...at(1), label: '100 g', grams: 100, kind: 'per100g' },
  ];

  for (const p of food.portions) {
    if (!(p.grams > 0)) continue;
    // A portion whose label is itself a gram amount ("126 g") would render as
    // "126 g (126 g)" — drop the redundant parenthetical for those rows.
    const gramsLabel = `${Math.round(p.grams)} g`;
    const labelIsGrams = /^\s*\d+(\.\d+)?\s*g\s*$/i.test(p.label);
    servings.push({
      ...at(p.grams / 100),
      label: (labelIsGrams ? gramsLabel : `${p.label} (${gramsLabel})`).slice(0, 80),
      grams: p.grams,
    });
  }

  const seen = new Set<string>();
  const deduped: ServingOption[] = [];
  for (const s of servings) {
    if (seen.has(s.label)) continue;
    seen.add(s.label);
    deduped.push(s);
    if (deduped.length >= MAX_SERVINGS) break;
  }
  return {
    source: 'fdc',
    id: food.id,
    description: food.desc.slice(0, MAX_DESCRIPTION),
    servings: deduped,
  };
}
