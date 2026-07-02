/**
 * Deterministic Nutrition Facts panel parser (ADR-0013, phase 3).
 *
 * Reading a printed Nutrition Facts label is ~99% structured extraction, not
 * guessing — the opposite of meal-photo estimation. This module turns the raw
 * text an OCR engine produces (mobile: on-device ML Kit; a future PWA path:
 * WASM OCR) into a {@link NutritionLabelDraft}: per-field values, each tagged
 * with the exact text snippet it came from so the UI can show *what we read*
 * and land the user on an **editable** draft. It never fabricates a missing
 * value and never emits a macro the panel didn't state — an absent field stays
 * absent so the confirm screen shows a blank to fill, not a fake zero.
 *
 * Pure and dependency-free (see `@macrolog/core`, ADR-0012). The native OCR
 * that feeds `rawText` is a per-frontend adapter; the math is here so both
 * apps parse identically.
 */
import type { CustomFoodDraft, ServingSnapshot } from './custom-food';

/** One parsed field: the numeric value plus the raw substring it was read
 *  from, for a "we read: …" transparency line on the confirm screen. */
export interface LabelField {
  value: number;
  /** The matched text as it appeared in the OCR input (trimmed). */
  raw: string;
}

/**
 * The structured result of parsing a Nutrition Facts panel. Every macro is
 * optional: a partial or smudged panel still yields whatever was legible, and
 * the confirm UI treats absent fields as "type it in", never as zero.
 *
 * Macros are **per serving** (US panels state per-serving amounts). Serving
 * geometry (`servingGrams`, `servingsPerContainer`) is captured separately so
 * the grams-first save path (ADR-0013) has the one-serving mass to store.
 */
export interface NutritionLabelDraft {
  /** Mass of ONE serving in grams, from e.g. "Serving size 2/3 cup (55g)". */
  servingGrams?: LabelField;
  /** Servings per container ("Servings Per Container About 8") — informational
   *  (a CustomFood stores per-serving macros; this drives a UI hint only). */
  servingsPerContainer?: LabelField;
  calories?: LabelField;
  protein?: LabelField;
  /** Total Carbohydrate — never Dietary Fiber / Total Sugars / Added Sugars. */
  carbs?: LabelField;
  /** Total Fat — never Saturated / Trans / sub-fats. */
  fat?: LabelField;
  /** True when the text is confidently a Nutrition Facts panel: the header is
   *  present, or ≥2 macro/energy fields parsed. Guards against feeding random
   *  OCR noise (a logo, an ingredient list) into the save flow. */
  isLikelyPanel: boolean;
}

/** Collapse OCR whitespace/newlines to single spaces and normalise the few
 *  unicode oddities scanners emit, without altering digits or letters (so we
 *  never "fix" an O→0 and change a value). Newlines become spaces because ML
 *  Kit splits a "Total Fat 8g" label and value across blocks unpredictably. */
function normalize(text: string): string {
  return text
    .replace(/ /g, ' ') // non-breaking space
    .replace(/（/g, '(') // fullwidth parens (some scanners)
    .replace(/）/g, ')')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse a number that may use a decimal point; returns undefined if NaN. */
function num(s: string): number | undefined {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : undefined;
}

/** Run a matcher, returning the value + the raw matched slice. `group` is the
 *  capture index holding the number. */
function field(text: string, re: RegExp, group = 1): LabelField | undefined {
  const m = re.exec(text);
  if (!m) return undefined;
  const value = num(m[group]);
  if (value === undefined) return undefined;
  return { value, raw: m[0].trim() };
}

/**
 * Parse a Nutrition Facts panel's OCR text into a structured, editable draft.
 *
 * Extraction is label-anchored so sub-nutrients can't be mistaken for their
 * parent: `Total Fat` matches neither `Saturated Fat` nor `Trans Fat`, and
 * `Total Carbohydrate` matches neither `Dietary Fiber`, `Total Sugars`, nor
 * `Added Sugars`. `Calories` deliberately skips the legacy `Calories from
 * Fat` line. Each label tolerates a small non-digit gap before its value so a
 * "%DV" column or an OCR-inserted space doesn't break the read.
 */
export function parseNutritionLabel(rawText: string): NutritionLabelDraft {
  const text = normalize(rawText);
  const draft: NutritionLabelDraft = { isLikelyPanel: false };

  // Serving grams — prefer the "(NNg)" weight beside the household measure
  // ("2/3 cup (55g)"); fall back to a bare "Serving Size: 55g". Stop the gap
  // scan at the first "(" so a household measure with digits (2/3) is skipped.
  draft.servingGrams =
    field(text, /serving\s*size[^(]{0,40}\(\s*(\d{1,4}(?:\.\d+)?)\s*g\s*\)/i) ??
    field(text, /serving\s*size\s*:?\s*(\d{1,4}(?:\.\d+)?)\s*g\b/i);

  // Servings per container — the count sits AFTER the label on legacy panels
  // ("Servings Per Container About 8", tolerating "About") and BEFORE it on
  // the modern FDA panel ("8 servings per container").
  draft.servingsPerContainer =
    field(text, /servings?\s*per\s*container\D{0,10}?(\d{1,3})/i) ??
    field(text, /(\d{1,3})\s*servings?\s*per\s*container/i);

  // Calories — skip "Calories from Fat NN" (older panels) via the lookahead.
  draft.calories =
    field(text, /calories(?!\s*from)\D{0,6}(\d{1,4})\b/i);

  // Macros — "<Total X> <n>g". The \D{0,6} gap swallows a stray space or the
  // "g" of a preceding token but never digits, so it can't cross into a
  // neighbouring value.
  draft.fat =
    field(text, /total\s*fat\D{0,6}(\d{1,3}(?:\.\d+)?)\s*g\b/i);
  draft.carbs =
    field(text, /total\s*carb\w*\D{0,6}(\d{1,3}(?:\.\d+)?)\s*g\b/i);
  draft.protein =
    field(text, /protein\D{0,6}(\d{1,3}(?:\.\d+)?)\s*g\b/i);

  const macroHits =
    (draft.calories ? 1 : 0) + (draft.protein ? 1 : 0) +
    (draft.carbs ? 1 : 0) + (draft.fat ? 1 : 0);
  draft.isLikelyPanel = /nutrition\s*facts/i.test(text) || macroHits >= 2;

  return draft;
}

/**
 * Collapse a parsed panel into the grams-first {@link ServingSnapshot} the
 * save path stores — the macros for ONE serving at its gram weight. Returns
 * `null` when the panel lacks the two load-bearing values (serving grams and
 * calories): without a gram weight there's no honest grams-first serving to
 * store, so the caller keeps the user in manual entry rather than fabricating
 * one. Absent optional macros stay absent.
 */
export function nutritionLabelToServing(draft: NutritionLabelDraft): ServingSnapshot | null {
  if (!draft.servingGrams || !draft.calories) return null;
  const serving: ServingSnapshot = {
    grams: draft.servingGrams.value,
    calories: draft.calories.value,
  };
  if (draft.protein) serving.protein = draft.protein.value;
  if (draft.carbs) serving.carbs = draft.carbs.value;
  if (draft.fat) serving.fat = draft.fat.value;
  return serving;
}

/** Identifying fields the user confirms/edits alongside the parsed macros. */
export interface LabelFoodMeta {
  name: string;
  brand?: string;
  /** Present when a barcode scan preceded the label capture — enables the
   *  same scan-dedup doc-id as the barcode path (ADR-0013). */
  barcode?: string;
}

/**
 * Bridge a parsed panel + user-confirmed identity into a
 * {@link CustomFoodDraft} ready for `buildCustomFood`. `source` is `'label'`
 * (the resolution path). Returns `null` when {@link nutritionLabelToServing}
 * can't form a grams-first serving — the confirm screen then collects the
 * missing pieces manually. When a `barcode` is supplied the source stays
 * `'label'` but the barcode rides along for dedup, matching the "scanned then
 * OCR'd the panel" flow.
 */
export function nutritionLabelToCustomFoodDraft(
  draft: NutritionLabelDraft,
  meta: LabelFoodMeta,
): CustomFoodDraft | null {
  const serving = nutritionLabelToServing(draft);
  if (!serving) return null;
  const out: CustomFoodDraft = {
    name: meta.name,
    source: meta.barcode ? 'barcode' : 'label',
    serving,
  };
  if (meta.brand) out.brand = meta.brand;
  if (meta.barcode) out.barcode = meta.barcode;
  return out;
}
