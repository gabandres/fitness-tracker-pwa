import { describe, it, expect } from 'vitest';
import { scaleCustomFood, servingsFromGrams, buildCustomFood, customFoodDocId } from './custom-food';
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

describe('buildCustomFood', () => {
  const now = new Date('2026-07-01T12:00:00Z');

  it('maps the selected serving into a grams-first CustomFood', () => {
    const out = buildCustomFood(
      {
        name: '  Chobani 0% Plain  ',
        brand: ' Chobani ',
        barcode: '894700010045',
        source: 'barcode',
        serving: { grams: 170, calories: 100, protein: 17, carbs: 6, fat: 0.7 },
      },
      now,
    );
    expect(out).toEqual({
      name: 'Chobani 0% Plain',
      brand: 'Chobani',
      barcode: '894700010045',
      servingSize: 170,
      servingUnit: 'g',
      calories: 100,
      protein: 17,
      carbs: 6,
      fat: 0.7,
      source: 'barcode',
      createdAt: now,
    });
  });

  it('omits absent macros, brand, and barcode rather than writing zeros/empties', () => {
    const out = buildCustomFood(
      { name: 'Brown rice', source: 'text', serving: { grams: 100, calories: 111, protein: 2.6 } },
      now,
    );
    expect(out).toEqual({
      name: 'Brown rice',
      servingSize: 100,
      servingUnit: 'g',
      calories: 111,
      protein: 2.6,
      source: 'text',
      createdAt: now,
    });
    expect('brand' in out).toBe(false);
    expect('barcode' in out).toBe(false);
    expect('carbs' in out).toBe(false);
  });

  it('clamps out-of-range values into the isValidCustomFood bounds', () => {
    const out = buildCustomFood(
      { name: 'x', source: 'manual', serving: { grams: -5, calories: 999999, protein: 5000 } },
      now,
    );
    expect(out.servingSize).toBe(0.1); // clamped up from -5
    expect(out.calories).toBe(19999); // clamped down
    expect(out.protein).toBe(999); // clamped down
  });
});

describe('customFoodDocId', () => {
  it('returns the barcode as the doc id for a scanned food (de-dup key)', () => {
    expect(customFoodDocId({ source: 'barcode', barcode: '894700010045' })).toBe('894700010045');
  });

  it('returns null (→ auto-id) for non-barcode sources or missing barcode', () => {
    expect(customFoodDocId({ source: 'text', barcode: undefined })).toBeNull();
    expect(customFoodDocId({ source: 'label', barcode: undefined })).toBeNull();
    expect(customFoodDocId({ source: 'barcode', barcode: undefined })).toBeNull();
  });
});
