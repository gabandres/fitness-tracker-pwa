/**
 * Pure helpers for the My Foods library (ADR-0013). A {@link CustomFood}
 * stores macros for ONE serving; logging scales by the eaten quantity
 * (number of servings) and produces a macro snapshot copied into a
 * `DailyLog`. Grams-first: when the serving unit is a mass unit, callers can
 * derive `servings` from grams via {@link servingsFromGrams}.
 *
 * Framework-free and dependency-free — see `@macrolog/core` (ADR-0012).
 */
import type { CustomFood } from './types';

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
