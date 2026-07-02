/**
 * Deterministic natural-language meal parser (ADR-0013, text modality).
 *
 * Turns a free-text meal utterance ("2 eggs and a cup of white rice") into a
 * list of {@link ParsedFoodItem}s — `{ quantity, unit, food }` — WITHOUT ever
 * emitting a macro number. It only *decomposes*; resolving each item's food to
 * real calories/protein is a separate step (the deployed `searchFoods` lookup
 * per-frontend), and the user always lands on an editable draft. That split is
 * the ADR-0013 trust rule: parse deterministically on-device ($0, private), let
 * a database supply the numbers, and never present a fake-precise guess.
 *
 * Bilingual by design (en + es-PR) via a single combined lexicon, so mixed
 * phrasing works and no locale flag is needed. Pure and dependency-free
 * (see `@macrolog/core`, ADR-0012); the voice/text input adapter is
 * per-frontend, the decomposition is here so both apps parse identically.
 */

/** One decomposed food from a meal utterance. Macro-free by design — this is
 *  the input to a database lookup, not a nutrition estimate. */
export interface ParsedFoodItem {
  /** How many `unit`s (or, when `unit` is null, how many of the food). A
   *  fraction like 0.5 is valid ("half a cup"). Defaults to 1 when unstated. */
  quantity: number;
  /** Canonical measurement unit ('cup', 'g', 'tbsp', 'slice', 'handful', …),
   *  or null for a bare count ("2 eggs"). Plurals/abbreviations/Spanish forms
   *  are folded to one canonical key. */
  unit: string | null;
  /** The food name, lowercased and stripped of quantity/unit/filler words. */
  food: string;
  /** The original text slice this item was parsed from, for a "we read: …"
   *  transparency line and to seed the editable draft row. */
  raw: string;
}

/** Grams per canonical mass unit — the honest, food-independent conversions a
 *  downstream resolver can apply directly. Volume/household units (cup, slice,
 *  handful) are deliberately absent: their gram weight is food-specific and
 *  must come from the food database, not a guess here. */
export const MASS_UNIT_GRAMS: Record<string, number> = {
  g: 1,
  kg: 1000,
  mg: 0.001,
  oz: 28.3495,
  lb: 453.592,
};

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '⅓': 1 / 3, '⅔': 2 / 3, '¼': 0.25, '¾': 0.75,
  '⅕': 0.2, '⅖': 0.4, '⅗': 0.6, '⅘': 0.8,
  '⅙': 1 / 6, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/** Number words (en + es). Fractional words (half/quarter/media) map below 1. */
const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
  nine: 9, ten: 10, eleven: 11, twelve: 12, dozen: 12,
  half: 0.5, quarter: 0.25,
  // Spanish
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
  nueve: 9, diez: 10, media: 0.5, medio: 0.5, cuarto: 0.25,
};

/** Words that mean "one" AND act as an article — quantity 1, but a following
 *  fractional word ("a half") replaces rather than adds to them. */
const ARTICLE_ONES = new Set(['a', 'an', 'un', 'una']);

/** Grammatical filler skipped between quantity, unit and food. */
const FILLER = new Set(['of', 'de', 'the', 'el', 'la', 'los', 'las']);

/** Unit surface forms → canonical unit. Includes plurals, abbreviations and
 *  Spanish equivalents. Mass units align with {@link MASS_UNIT_GRAMS}. */
const UNIT_MAP: Record<string, string> = {
  // mass
  g: 'g', gram: 'g', grams: 'g', gm: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilogramo: 'kg',
  mg: 'mg',
  oz: 'oz', ounce: 'oz', ounces: 'oz', onza: 'oz', onzas: 'oz',
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', libra: 'lb', libras: 'lb',
  // volume
  ml: 'ml', milliliter: 'ml', milliliters: 'ml',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', litro: 'l', litros: 'l',
  cup: 'cup', cups: 'cup', taza: 'cup', tazas: 'cup',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  cucharada: 'tbsp', cucharadas: 'tbsp',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  cucharadita: 'tsp', cucharaditas: 'tsp',
  floz: 'floz',
  // household / count units
  slice: 'slice', slices: 'slice', rebanada: 'slice', rebanadas: 'slice',
  loncha: 'slice', lonchas: 'slice', tajada: 'slice', tajadas: 'slice',
  piece: 'piece', pieces: 'piece', pieza: 'piece', piezas: 'piece',
  handful: 'handful', handfuls: 'handful', punado: 'handful', punados: 'handful',
  scoop: 'scoop', scoops: 'scoop',
  serving: 'serving', servings: 'serving', porcion: 'serving', porciones: 'serving',
  can: 'can', cans: 'can', lata: 'can', latas: 'can',
  bottle: 'bottle', bottles: 'bottle', botella: 'bottle', botellas: 'bottle',
  glass: 'glass', glasses: 'glass', vaso: 'glass', vasos: 'glass',
  bowl: 'bowl', bowls: 'bowl', plato: 'bowl', platos: 'bowl',
  clove: 'clove', cloves: 'clove', diente: 'clove', dientes: 'clove',
  stick: 'stick', sticks: 'stick',
};

interface TokenNumber {
  value: number;
  /** Below-1 words/fractions ("half", "1/2", "¾") that combine as the
   *  fractional part of a mixed number ("1 1/2") rather than a whole. */
  fractional: boolean;
  /** Article-ones ("a", "una") — a following fractional word replaces them. */
  article: boolean;
}

/** Interpret a single token as a number, or null if it isn't one. */
function tokenNumber(t: string): TokenNumber | null {
  if (UNICODE_FRACTIONS[t] !== undefined) {
    return { value: UNICODE_FRACTIONS[t], fractional: true, article: false };
  }
  if (/^\d+\/\d+$/.test(t)) {
    const [a, b] = t.split('/').map(Number);
    return b ? { value: a / b, fractional: true, article: false } : null;
  }
  if (/^\d+(\.\d+)?$/.test(t)) {
    return { value: parseFloat(t), fractional: false, article: false };
  }
  if (ARTICLE_ONES.has(t)) {
    return { value: 1, fractional: false, article: true };
  }
  if (WORD_NUMBERS[t] !== undefined) {
    const value = WORD_NUMBERS[t];
    return { value, fractional: value < 1, article: false };
  }
  return null;
}

/** Split an utterance into per-food segments on connectors (and/y/with/con/
 *  comma/plus/newline/semicolon). Keeps each segment's original text. */
function segment(text: string): string[] {
  return text
    .split(/\r?\n|[,;+&]|\band\b|\by\b|\bwith\b|\bcon\b|\bplus\b/gi)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Insert a space between a number and a directly-following letter so glued
 *  forms ("100g", "2tbsp", "½cup") tokenise like their spaced equivalents. */
function unglue(s: string): string {
  return s
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/([½⅓⅔¼¾⅕⅖⅗⅘⅙⅛⅜⅝⅞])([a-zA-Z])/g, '$1 $2');
}

function canonicalUnit(t: string): string | null {
  return UNIT_MAP[t] ?? null;
}

/** Clean a food phrase: drop leading/trailing filler and surrounding
 *  punctuation, collapse whitespace. */
function cleanFood(tokens: string[]): string {
  const kept = [...tokens];
  while (kept.length && (FILLER.has(kept[0]) || ARTICLE_ONES.has(kept[0]))) kept.shift();
  while (kept.length && FILLER.has(kept[kept.length - 1])) kept.pop();
  return kept.join(' ').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N})]+$/gu, '').trim();
}

/** Parse one segment into a food item, or null when it holds no food. */
function parseSegment(rawSegment: string): ParsedFoodItem | null {
  const raw = rawSegment.trim();
  const tokens = unglue(raw.toLowerCase()).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return null;

  // ── Leading quantity: a run of numeric tokens (word/digit/fraction). ──
  let quantity: number | null = null;
  let fromArticle = false;
  let i = 0;
  for (; i < tokens.length; i++) {
    const n = tokenNumber(tokens[i]);
    if (!n) break;
    if (quantity === null) {
      quantity = n.value;
      fromArticle = n.article;
    } else if (n.fractional) {
      // Mixed number: "1 1/2" → 1.5; but "a half" → 0.5 (article replaced).
      quantity = fromArticle ? n.value : Math.floor(quantity) + n.value;
      fromArticle = false;
    } else {
      break; // a second whole number isn't part of this quantity
    }
  }

  // ── Unit: the first non-filler token after the quantity, if recognised.
  // Article-ones are skipped too so "half a cup" reaches the unit ("cup"). ──
  while (i < tokens.length && (FILLER.has(tokens[i]) || ARTICLE_ONES.has(tokens[i]))) i++;
  let unit: string | null = null;
  if (i < tokens.length) {
    const canon = canonicalUnit(tokens[i]);
    if (canon) {
      unit = canon;
      i++;
    }
  }

  let food = cleanFood(tokens.slice(i));

  // ── Trailing quantity fallback: "chicken breast 200g" / "yogurt 150 g". ──
  if (quantity === null && food) {
    const fw = food.split(/\s+/);
    const last = fw[fw.length - 1];
    const penult = fw[fw.length - 2];
    const lastUnit = canonicalUnit(last);
    if (lastUnit && penult && tokenNumber(penult)) {
      quantity = tokenNumber(penult)!.value;
      unit = lastUnit;
      food = cleanFood(fw.slice(0, -2));
    } else {
      const lastNum = tokenNumber(last);
      if (lastNum && !lastNum.article) {
        quantity = lastNum.value;
        food = cleanFood(fw.slice(0, -1));
      }
    }
  }

  if (!food) return null;
  return { quantity: quantity ?? 1, unit, food, raw };
}

/**
 * Decompose a free-text meal utterance into per-food items. Returns [] for
 * empty/foodless input. Never emits macros — each item is a lookup query for
 * the food database, and the caller lands the user on an editable draft.
 */
export function parseMealUtterance(text: string): ParsedFoodItem[] {
  if (!text || !text.trim()) return [];
  const out: ParsedFoodItem[] = [];
  for (const seg of segment(text)) {
    const parsed = parseSegment(seg);
    if (parsed) out.push(parsed);
  }
  return out;
}

// ─── Choosing which search hit to auto-resolve ────────────────────
// When resolving a parsed item we auto-pick ONE search hit (the user never
// sees the list), so hit quality matters: FDC/OFF relevance ordering often
// floats a branded/packaged product to the top ("eggs" → a high-fat egg
// product), which then scales into nonsense. For a bare generic food word the
// right answer is a USDA generic reference entry. This biases the pick toward
// those without touching the manual search typeahead (where the user chooses).

/** USDA generic dataTypes, best-first. Foundation is USDA-verified reference
 *  data; SR Legacy and FNDDS are generic whole/prepared foods. Branded / OFF
 *  are intentionally absent — they win only when no generic hit exists. */
const GENERIC_USDA_RANK: Record<string, number> = {
  Foundation: 0,
  'SR Legacy': 1,
  'Survey (FNDDS)': 2,
};

/**
 * Pick the hit to auto-resolve from a search result list: the best-ranked
 * USDA generic entry (Foundation > SR Legacy > FNDDS), else the first
 * (relevance-ordered) hit. Relevance order is preserved within a rank, so a
 * brand query — whose hits are all branded — still returns its top match.
 * Returns undefined only for an empty list.
 */
export function pickResolutionHit<T extends { dataType?: string }>(
  hits: readonly T[],
): T | undefined {
  let best: T | undefined;
  let bestRank = Infinity;
  for (const h of hits) {
    const rank = h.dataType != null && h.dataType in GENERIC_USDA_RANK
      ? GENERIC_USDA_RANK[h.dataType]
      : Infinity;
    if (rank < bestRank) {
      bestRank = rank;
      best = h;
    }
  }
  return best ?? hits[0];
}

// ─── Resolving a parsed item against a food's servings ─────────────
// Bridges the macro-free parse to real numbers WITHOUT guessing them: the
// caller looks the food up (deployed `searchFoods`/`getFoodDetail`), and this
// picks the right serving + scales its DATABASE macros. `assumed` flags when
// we couldn't confidently map the utterance's unit to a serving, so the
// editable draft can surface the assumption instead of feigning precision.

/** A food-database serving option (structurally matches `FoodDetail.servings`
 *  from the food-search layer — kept dependency-free here). */
export interface ServingLike {
  label: string;
  grams: number;
  kcal: number;
  protein: number;
  carbs?: number;
  fat?: number;
  kind?: 'per100g' | 'portion';
}

/** A parsed item resolved to a scaled, editable draft row. Macros come from
 *  the database serving, never fabricated; absent macros stay null. */
export interface ResolvedMealItem {
  food: string;
  quantity: number;
  unit: string | null;
  /** Total grams for this portion, or null when the serving carries no weight
   *  (a bare count against a per-100g-only food we couldn't size). */
  grams: number | null;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** The serving label the macros were scaled from ("1 cup (158 g)"). */
  servingLabel: string;
  /** True when the unit→serving mapping was a guess the user should confirm. */
  assumed: boolean;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** Does a serving label mention a unit? Checks every surface form (plural,
 *  abbreviation, Spanish) that folds to the canonical unit. */
function labelMentions(label: string, unit: string): boolean {
  const l = label.toLowerCase();
  for (const [surface, canon] of Object.entries(UNIT_MAP)) {
    if (canon === unit && new RegExp(`\\b${surface}\\b`).test(l)) return true;
  }
  return false;
}

/**
 * Resolve one {@link ParsedFoodItem} against a food's servings into a scaled,
 * editable draft row. Returns null when the food has no servings.
 *
 * - Mass unit (g/kg/oz/lb/mg): exact grams → scale the per-100g row.
 * - Portion word (cup/slice/tbsp…): match a serving whose label names it and
 *   multiply by the quantity; unmatched → fall back and flag `assumed`.
 * - Bare count: multiply the food's default portion serving; only per-100g
 *   available → use it but flag `assumed` (the one-unit weight is unknown).
 */
export function resolveMealItem(
  item: ParsedFoodItem,
  servings: ServingLike[],
): ResolvedMealItem | null {
  if (servings.length === 0) return null;
  const per100 = servings.find((s) => s.kind === 'per100g' || s.grams === 100);
  const portions = servings.filter((s) => s.kind !== 'per100g' && s.grams !== 100);

  const build = (
    base: ServingLike,
    ratio: number,
    grams: number | null,
    assumed: boolean,
  ): ResolvedMealItem => ({
    food: item.food,
    quantity: item.quantity,
    unit: item.unit,
    grams: grams != null ? round1(grams) : null,
    calories: Math.round(base.kcal * ratio),
    protein: base.protein != null ? round1(base.protein * ratio) : null,
    carbs: base.carbs != null ? round1(base.carbs * ratio) : null,
    fat: base.fat != null ? round1(base.fat * ratio) : null,
    servingLabel: base.label,
    assumed,
  });

  // Mass unit → exact grams, scaled from the per-100g row (or any serving).
  if (item.unit && MASS_UNIT_GRAMS[item.unit]) {
    const grams = item.quantity * MASS_UNIT_GRAMS[item.unit];
    const base = per100 ?? servings[0];
    return build(base, base.grams ? grams / base.grams : 0, grams, false);
  }

  // Portion word → a serving whose label names that unit, scaled by quantity.
  if (item.unit) {
    const match = portions.find((s) => labelMentions(s.label, item.unit!));
    if (match) return build(match, item.quantity, match.grams * item.quantity, false);
  }

  // Bare count against a real portion serving → confident. Otherwise fall back
  // to per-100g (or the first serving) and flag the assumption.
  const portion = portions[0];
  if (item.unit === null && portion) {
    return build(portion, item.quantity, portion.grams * item.quantity, false);
  }
  const base = per100 ?? servings[0];
  const grams = base.grams ? base.grams * item.quantity : null;
  return build(base, item.quantity, grams, true);
}
