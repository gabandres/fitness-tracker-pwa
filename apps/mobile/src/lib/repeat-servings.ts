import {
  MASS_UNIT_GRAMS,
  VOLUME_UNIT_ML,
  type CustomFood,
  scaleCustomFood,
} from '@macrolog/core';
import type { EntryPrefill } from '@/lib/entry-prefill';

/**
 * How many of a saved food's stored servings a note's amount is — the scan's
 * "you logged this before" prefill (ADR-0029 item 3).
 *
 * The number alone is not the amount (audit #11, open since 09-22): "2 tbsp
 * peanut butter" against a 32 g serving is not two servings. The unit is
 * honoured only where it converts EXACTLY:
 *
 * - no unit, or `serving` → the count is servings;
 * - a mass unit against a grams/ounce serving → by weight;
 * - a volume unit against a millilitre serving → by volume;
 * - the serving's own unit (`piece`) → by count of that unit.
 *
 * Anything else ("2 tbsp" of a food saved by weight) would need a density
 * nobody stored, so it drafts ONE stored serving and the user corrects it on
 * the editable draft — never a silent ×2. Null quantity is one serving.
 */
export function repeatServings(food: CustomFood, quantity: number | null, unit: string | null): number {
  if (quantity == null || !(quantity > 0)) return 1;
  if (unit == null || unit === 'serving') return quantity;
  const size = food.servingSize > 0 ? food.servingSize : 0;
  if (!size) return 1;
  const grams = MASS_UNIT_GRAMS[unit];
  if (grams != null) {
    const servingGrams =
      food.servingUnit === 'g' ? size : food.servingUnit === 'oz' ? size * MASS_UNIT_GRAMS.oz : 0;
    return servingGrams > 0 ? (quantity * grams) / servingGrams : 1;
  }
  const ml = VOLUME_UNIT_ML[unit];
  if (ml != null) return food.servingUnit === 'ml' ? (quantity * ml) / size : 1;
  if (unit === food.servingUnit) return quantity / size;
  return 1;
}

/** The editable add-sheet draft for a repeat: the stored macros scaled by
 *  {@link repeatServings}, with a macro the food never had left ABSENT (it
 *  was written as 0, which the form then showed as a measured zero). */
export function repeatPrefill(food: CustomFood, quantity: number | null, unit: string | null): EntryPrefill {
  const m = scaleCustomFood(food, repeatServings(food, quantity, unit));
  return {
    calories: m.calories,
    ...(m.protein != null ? { protein: m.protein } : {}),
    ...(m.carbs != null ? { carbs: m.carbs } : {}),
    ...(m.fat != null ? { fat: m.fat } : {}),
    mealLabel: food.name,
  };
}
