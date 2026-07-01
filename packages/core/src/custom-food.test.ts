import { describe, it, expect } from 'vitest';
import { scaleCustomFood, servingsFromGrams } from './custom-food';
import type { CustomFood } from './types';

function food(over: Partial<CustomFood> = {}): CustomFood {
  return {
    name: 'Greek yogurt',
    servingSize: 170,
    servingUnit: 'g',
    calories: 100,
    protein: 17,
    carbs: 6,
    fat: 0.7,
    source: 'label',
    createdAt: new Date('2026-07-01'),
    ...over,
  };
}

describe('scaleCustomFood', () => {
  it('returns per-serving macros at quantity 1', () => {
    expect(scaleCustomFood(food(), 1)).toEqual({ calories: 100, protein: 17, carbs: 6, fat: 0.7 });
  });

  it('scales fractional servings, rounding kcal to int and grams to 0.1', () => {
    expect(scaleCustomFood(food(), 1.5)).toEqual({ calories: 150, protein: 25.5, carbs: 9, fat: 1 });
  });

  it('omits macros that are absent on the food (absent ≠ zero)', () => {
    const out = scaleCustomFood(food({ protein: undefined, fat: undefined }), 2);
    expect(out).toEqual({ calories: 200, carbs: 12 });
    expect('protein' in out).toBe(false);
  });

  it('clamps non-positive / non-finite servings to zero macros', () => {
    expect(scaleCustomFood(food(), 0)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(scaleCustomFood(food(), -3)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
    expect(scaleCustomFood(food(), NaN)).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('servingsFromGrams', () => {
  it('converts grams to a serving multiplier for a gram-serving food', () => {
    expect(servingsFromGrams(food({ servingSize: 100 }), 250)).toBeCloseTo(2.5);
  });

  it('handles ounce servings via 28.3495 g/oz', () => {
    expect(servingsFromGrams(food({ servingSize: 1, servingUnit: 'oz' }), 28.3495)).toBeCloseTo(1);
  });

  it('returns 0 for non-mass serving units (caller falls back to serving count)', () => {
    expect(servingsFromGrams(food({ servingUnit: 'piece' }), 100)).toBe(0);
  });

  it('returns 0 for non-positive grams or serving size', () => {
    expect(servingsFromGrams(food(), 0)).toBe(0);
    expect(servingsFromGrams(food({ servingSize: 0 }), 100)).toBe(0);
  });
});
