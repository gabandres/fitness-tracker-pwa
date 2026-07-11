/**
 * Recipe-URL import (v1.1) — parse schema.org/Recipe JSON-LD out of a fetched
 * recipe page into an editable, per-serving draft. Pure and dependency-free:
 * the HTML *fetch* is a per-frontend adapter (mobile fetches directly — no CORS
 * in React Native; web goes through a dumb Cloud Function proxy), but the
 * extraction + normalization live here so both frontends parse identically.
 *
 * schema.org convention: `nutrition` is expressed PER SERVING, so its calories
 * / proteinContent map straight onto one logged portion. Ingredient lines are
 * free text (no per-line macros), surfaced for the user to review.
 */

export interface ParsedRecipe {
  /** Recipe title, or '' when the page omits it. */
  name: string;
  /** Servings the recipe yields, or null when unstated. */
  servings: number | null;
  /** Ingredient lines as free text (e.g. "2 cups flour"). */
  ingredients: string[];
  /** Per-serving macros from the nutrition block, or null when absent. Each
   *  field is independently nullable — many sites publish calories but not
   *  protein. */
  perServing: {
    calories: number | null;
    protein: number | null;
    carbs: number | null;
    fat: number | null;
  } | null;
  /** Canonical/source URL the recipe declares, when present. */
  sourceUrl: string | null;
}

/** First number embedded in a value: 240 from "240 kcal", 12.5 from "12.5 g",
 *  or a bare number. null when there's no parseable number. */
function firstNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const m = value.replace(',', '.').match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/** Round a positive nutrition number to a whole unit; null passes through. */
function roundOrNull(n: number | null): number | null {
  return n == null ? null : Math.max(0, Math.round(n));
}

/** Pull the contents of every <script type="application/ld+json"> block and
 *  JSON.parse each (best-effort — a malformed block is skipped, not fatal). */
export function extractJsonLdBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  if (!html) return out;
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    // Strip CDATA/HTML comment wrappers some CMSes emit around the JSON.
    const raw = m[1]
      .replace(/^\s*<!\[CDATA\[/, '')
      .replace(/\]\]>\s*$/, '')
      .replace(/^\s*<!--/, '')
      .replace(/-->\s*$/, '')
      .trim();
    if (!raw) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      /* malformed block — skip */
    }
  }
  return out;
}

/** Flatten JSON-LD candidates into a flat node list, unwrapping top-level
 *  arrays and `@graph` containers. */
function flattenNodes(parsed: unknown[]): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) {
      v.forEach(visit);
      return;
    }
    if (v && typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      nodes.push(obj);
      if (Array.isArray(obj['@graph'])) (obj['@graph'] as unknown[]).forEach(visit);
    }
  };
  parsed.forEach(visit);
  return nodes;
}

/** True when a JSON-LD node's `@type` is (or includes) "Recipe". */
function isRecipeNode(node: Record<string, unknown>): boolean {
  const type = node['@type'];
  if (typeof type === 'string') return type.toLowerCase() === 'recipe';
  if (Array.isArray(type)) return type.some((t) => String(t).toLowerCase() === 'recipe');
  return false;
}

/** recipeYield → an integer serving count. Handles number, "4 servings",
 *  "Serves 4", and arrays (first parseable entry wins). */
function parseServings(value: unknown): number | null {
  const pick = (v: unknown): number | null => {
    const n = firstNumber(v);
    return n != null && n > 0 ? Math.round(n) : null;
  };
  if (Array.isArray(value)) {
    for (const entry of value) {
      const n = pick(entry);
      if (n != null) return n;
    }
    return null;
  }
  return pick(value);
}

function parseIngredients(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === 'string' ? v.trim() : ''))
    .filter((s) => s.length > 0);
}

function parseNutrition(value: unknown): ParsedRecipe['perServing'] {
  if (!value || typeof value !== 'object') return null;
  const n = value as Record<string, unknown>;
  const calories = roundOrNull(firstNumber(n['calories']));
  const protein = roundOrNull(firstNumber(n['proteinContent']));
  const carbs = roundOrNull(firstNumber(n['carbohydrateContent']));
  const fat = roundOrNull(firstNumber(n['fatContent']));
  if (calories == null && protein == null && carbs == null && fat == null) return null;
  return { calories, protein, carbs, fat };
}

function firstString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = firstString(v);
      if (s) return s;
    }
  }
  return null;
}

/** Normalize a located Recipe node into a ParsedRecipe. */
function normalizeRecipe(node: Record<string, unknown>): ParsedRecipe {
  return {
    name: firstString(node['name']) ?? '',
    servings: parseServings(node['recipeYield']),
    ingredients: parseIngredients(node['recipeIngredient'] ?? node['ingredients']),
    perServing: parseNutrition(node['nutrition']),
    sourceUrl: firstString(node['url']) ?? firstString(node['mainEntityOfPage']),
  };
}

/**
 * Parse the first schema.org/Recipe out of a page's raw HTML. Returns null when
 * no Recipe JSON-LD is present (the page isn't a recipe, or uses only
 * microdata/RDFa, which this MVP does not read).
 */
export function parseRecipeFromHtml(html: string): ParsedRecipe | null {
  const node = flattenNodes(extractJsonLdBlocks(html)).find(isRecipeNode);
  return node ? normalizeRecipe(node) : null;
}
