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
 * Searching locally is a full-corpus scan in **2–4 ms** on a workstation and
 * ~20–40 ms on the LG G6 QA device.
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
 * decodes it and precomputes the matcher's derived fields once; {@link searchFoodIndex}
 * is then pure arithmetic over that.
 */
import type { FoodDetail, FoodSearchHit, ServingOption } from './food-search';

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

/** A food plus the lowercased forms the matcher needs, computed once at load.
 *  Mirrors `IndexedFood` in `functions/src/usda-db.ts`. */
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
 * Decode the compact index and precompute the matcher's derived fields.
 *
 * Deliberately eager: `scoreFood` reads `wordStems` for EVERY food on EVERY
 * keystroke, so computing them lazily would just move the same work into the
 * hot loop. Call this once, off the first keystroke — it is the ~70–140 ms
 * (LG G6) that buys 20–40 ms searches afterwards.
 */
export function loadFoodIndex(index: CompactFoodIndex): IndexedFood[] {
  if (index.v !== FOOD_INDEX_FORMAT_VERSION) {
    throw new Error(
      `food index format v${index.v} is not supported (expected v${FOOD_INDEX_FORMAT_VERSION}) — rebuild with scripts/build-food-index.mjs`,
    );
  }
  const { dataTypes, labels } = index;
  return index.foods.map((r) => {
    const desc = r[1];
    const norm = desc.toLowerCase();
    const portions: { label: string; grams: number }[] = [];
    const flat = r[7];
    for (let i = 0; i < flat.length; i += 2) {
      portions.push({ label: labels[flat[i]], grams: flat[i + 1] });
    }
    return {
      id: r[0],
      desc,
      dataType: dataTypes[r[2]],
      per100: { kcal: r[3], protein: r[4], carb: r[5], fat: r[6] },
      portions,
      norm,
      words: words(desc),
      wordStems: stems(words(desc)),
      segments: norm.split(',').map((s) => s.trim()),
      segmentStems: norm.split(',').map((s) => stems(words(s))),
    };
  });
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

/**
 * Rank the bundled dataset against a typeahead query.
 *
 * Ties break on description length then id so the ordering is total and stable
 * — which is what makes the golden fixture meaningful at all.
 */
/** How well one query token matches one food, or null for not at all.
 *  Extracted so the strict AND above and {@link headAnchoredTokens} below
 *  cannot drift apart — the fallback has to ask exactly the question the
 *  scorer asks, or it will discard a word the scorer would have accepted. */
function tokenScore(food: IndexedFood, t: string): number | null {
  const s = stem(t);
  if (food.wordStems.includes(s)) return 30;
  if (food.wordStems.some((w) => w.startsWith(s))) return 20;
  if (food.norm.includes(t)) return 5;
  return null;
}

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

export function searchFoodIndex(foods: IndexedFood[], rawQuery: string, size: number): FoodSearchHit[] {
  const query = normalizeQuery(rawQuery);
  const tokens = words(query);
  if (tokens.length === 0) return [];

  const strict = collect(foods, tokens, query, size);
  if (strict.length > 0 || tokens.length < 2) return strict;
  // Nothing matched every word. Retry with only the words the database can
  // honour, rather than showing the user an empty result. Fallback ONLY: a
  // query that found anything keeps its exact ranking, and the extra pass is
  // paid where the alternative was nothing at all.
  const kept = headAnchoredTokens(foods, tokens);
  if (kept.length === 0 || kept.length === tokens.length) return strict;
  return collect(foods, kept, kept.join(' '), size);
}

function collect(
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

  return scored.slice(0, size).map(({ food }) => ({
    source: 'fdc' as const,
    id: food.id,
    description: food.desc.slice(0, MAX_DESCRIPTION),
    dataType: food.dataType,
    servings: buildFoodDetail(food).servings,
  }));
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
    servings.push({
      ...at(p.grams / 100),
      label: `${p.label} (${Math.round(p.grams)} g)`.slice(0, 80),
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
