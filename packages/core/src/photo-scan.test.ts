import { describe, expect, it } from 'vitest';
import { rescaleScannedItem, sumScannedMacros, type ScannedFoodItem } from './photo-scan';

const item = (over: Partial<ScannedFoodItem> = {}): ScannedFoodItem => ({
  name: 'grilled chicken breast',
  grams: 150,
  calories: 248,
  protein: 46.5,
  carbs: 0,
  fat: 5.4,
  confidence: 0.8,
  ...over,
});

describe('sumScannedMacros', () => {
  it('adds each macro across items', () => {
    const total = sumScannedMacros([item(), item({ name: 'rice', grams: 100, calories: 130, protein: 2.7, carbs: 28, fat: 0.3 })]);
    expect(total).toEqual({ calories: 378, protein: 49.2, carbs: 28, fat: 5.7 });
  });

  it('is zero for an empty scan', () => {
    expect(sumScannedMacros([])).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
  });
});

describe('rescaleScannedItem', () => {
  it('scales macros linearly with grams', () => {
    const doubled = rescaleScannedItem(item(), 300);
    expect(doubled.grams).toBe(300);
    expect(doubled.calories).toBe(496);
    expect(doubled.protein).toBe(93);
    expect(doubled.fat).toBe(10.8);
  });

  it('clamps negative grams to zero', () => {
    expect(rescaleScannedItem(item(), -50).grams).toBe(0);
  });

  it('does not divide by zero when the scanned portion is 0 g', () => {
    const fixed = rescaleScannedItem(item({ grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0 }), 100);
    expect(fixed.grams).toBe(100);
    expect(fixed.calories).toBe(0);
  });
});
