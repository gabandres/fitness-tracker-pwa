/**
 * Pure helpers for the My Foods library (ADR-0013). A {@link CustomFood}
 * stores macros for ONE serving; logging scales by the eaten quantity
 * (number of servings) and produces a macro snapshot copied into a
 * `DailyLog`. Grams-first: when the serving unit is a mass unit, callers can
 * derive `servings` from grams via {@link servingsFromGrams}.
 *
 * Framework-free and dependency-free — see `@macrolog/core` (ADR-0012).
 */
import type { CustomFood, FoodSource } from './types';

/** Macro snapshot for a logged portion — the subset of DailyLog fields a
 *  CustomFood contributes. Absent macros stay absent (not zero). */
export interface FoodMacros {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/**
 * Scale a CustomFood's per-serving macros by `servings` (may be fractional,
 * e.g. 1.5). Calories round to the nearest integer; macro grams to 0.1g.
 * Optional macros that are absent on the food stay absent on the result.
 * `servings` is clamped to be non-negative.
 */
export function scaleCustomFood(food: CustomFood, servings: number): FoodMacros {
  const q = Number.isFinite(servings) && servings > 0 ? servings : 0;
  const out: FoodMacros = { calories: Math.round(food.calories * q) };
  if (food.protein !== undefined) out.protein = round1(food.protein * q);
  if (food.carbs !== undefined) out.carbs = round1(food.carbs * q);
  if (food.fat !== undefined) out.fat = round1(food.fat * q);
  return out;
}

/**
 * Convert an eaten amount in grams to a `servings` multiplier for a
 * mass-serving food. Returns 0 for a non-positive or non-mass serving so
 * callers fall back to serving-count entry. `oz` is treated as 28.3495 g.
 */
export function servingsFromGrams(food: CustomFood, grams: number): number {
  if (!Number.isFinite(grams) || grams <= 0 || food.servingSize <= 0) return 0;
  const gramsPerServing =
    food.servingUnit === 'g' ? food.servingSize
    : food.servingUnit === 'oz' ? food.servingSize * 28.3495
    : 0;
  return gramsPerServing > 0 ? grams / gramsPerServing : 0;
}

// ─── Saving a resolved food into the library (ADR-0013, Step 2) ────
// A resolved food (barcode / search-detail) carries several ServingOptions
// each already computed for a gram weight. Saving collapses the SELECTED one
// into a CustomFood's single, grams-first serving. This map lives in core so
// both frontends (PWA via LEDGER_PORT, mobile via the Firebase JS SDK) share
// it — only the thin Firestore write differs.

/** The one serving the user chose to save, already macro-resolved for its
 *  gram weight (mirrors the FoodDetail ServingOption shape). */
export interface ServingSnapshot {
  grams: number;
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/** Everything needed to save a resolved food to the library. `source` is the
 *  resolution PATH ('barcode' | 'label' | 'text' | 'manual'), not the source
 *  database. `barcode` is set only for scanned foods. */
export interface CustomFoodDraft {
  name: string;
  brand?: string;
  barcode?: string;
  source: FoodSource;
  serving: ServingSnapshot;
}

const clampNum = (n: number, lo: number, hi: number, fallback: number): number =>
  Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;

/**
 * Build the storable CustomFood payload (sans id) from a draft + a creation
 * time. Grams-first: the chosen serving is stored as `{ servingSize: grams,
 * servingUnit: 'g' }` with the serving's macros. Strings are trimmed/clamped
 * and absent macros are omitted (never written as fake zeros), matching the
 * `isValidCustomFood` Firestore rule bounds.
 */
export function buildCustomFood(draft: CustomFoodDraft, createdAt: Date): Omit<CustomFood, 'id'> {
  const s = draft.serving;
  const food: Omit<CustomFood, 'id'> = {
    name: draft.name.trim().slice(0, 100),
    servingSize: round1(clampNum(s.grams, 0.1, 99_999, 100)),
    servingUnit: 'g',
    calories: Math.round(clampNum(s.calories, 0, 19_999, 0)),
    source: draft.source,
    createdAt,
  };
  const brand = draft.brand?.trim();
  if (brand) food.brand = brand.slice(0, 100);
  const barcode = draft.barcode?.trim();
  if (barcode) food.barcode = barcode.slice(0, 32);
  if (s.protein != null) food.protein = round1(clampNum(s.protein, 0, 999, 0));
  if (s.carbs != null) food.carbs = round1(clampNum(s.carbs, 0, 999, 0));
  if (s.fat != null) food.fat = round1(clampNum(s.fat, 0, 999, 0));
  return food;
}

/**
 * Firestore doc id for a CustomFood: the **barcode** for scanned foods
 * (deterministic → free de-dup + O(1) "already saved?" + instant re-scan
 * match), else `null` so the caller uses an auto-id. Barcodes are digit
 * strings and never collide with Firestore's 20-char auto-ids.
 */
export function customFoodDocId(food: Pick<CustomFood, 'source' | 'barcode'>): string | null {
  return food.source === 'barcode' && food.barcode ? food.barcode : null;
}
