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

/**
 * The scan screen's portion chips used to multiply whatever was already on
 * screen, so 1.5× twice meant 2.25× and **1× was a no-op rather than a reset**.
 * Nothing on screen showed which chip was active, so the drift was invisible —
 * reported from a device 2026-08-08. The screen now scales by `next / current`;
 * these pin the properties that make that correct.
 */
describe('portion chips are absolute, not compounding', () => {
  const coffee = item({
    name: 'Turkish Coffee',
    grams: 375,
    calories: 102,
    protein: 1,
    carbs: 25,
    fat: 0,
  });

  /** Exactly what `applyPortion` does: rescale from the active chip to the next. */
  const chip = (it: ScannedFoodItem, from: number, to: number) =>
    rescaleScannedItem(it, it.grams * (to / from));

  it('lands on the same plate however you get there', () => {
    const direct = chip(coffee, 1, 1.5);
    const viaTwo = chip(chip(coffee, 1, 2), 2, 1.5);
    expect(viaTwo.grams).toBeCloseTo(direct.grams, 5);
    expect(viaTwo.calories).toBe(direct.calories);
  });

  it('1x returns the plate to the scan, from anywhere', () => {
    const back = chip(chip(coffee, 1, 0.5), 0.5, 1);
    expect(back.grams).toBeCloseTo(coffee.grams, 5);
    expect(back.calories).toBe(coffee.calories);
    expect(back.protein).toBeCloseTo(coffee.protein, 5);
  });

  it('scales macros with the grams — 1.5x of 102 kcal is 153', () => {
    const bigger = chip(coffee, 1, 1.5);
    expect(bigger.grams).toBeCloseTo(562.5, 5);
    expect(bigger.calories).toBe(153);
    expect(bigger.carbs).toBeCloseTo(37.5, 5);
  });
});

/**
 * `scan.tsx` calls `rescaleScannedItem` PER KEYSTROKE, over a field with
 * `selectTextOnFocus`. Retyping a 3-digit portion therefore rescales three
 * times, and before the basis existed each step scaled from the previous
 * step's ALREADY-ROUNDED output. Measured 2026-09-22: retyping `150` over a
 * 100 g rice row landed 300 kcal / 0 g protein instead of 360 / 6.6, and
 * clearing the field first parked the row at zero macros permanently.
 */
describe('per-keystroke gram edits do not compound', () => {
  const rice = item({ name: 'rice', grams: 100, calories: 240, protein: 4.4, carbs: 53, fat: 0.4 });

  /** Typing "150" into a field whose contents are selected: 1, then 15, then 150. */
  const type = (it: ScannedFoodItem, digits: string) =>
    [...digits].reduce(
      (acc, _, i) => rescaleScannedItem(acc, Number(digits.slice(0, i + 1))),
      it,
    );

  it('lands on the exact macros for the number typed', () => {
    const typed = type(rice, '150');
    expect(typed.grams).toBe(150);
    expect(typed.calories).toBe(360);
    expect(typed.protein).toBe(6.6);
    expect(typed.carbs).toBe(79.5);
    expect(typed.fat).toBe(0.6);
  });

  it('matches a single edit to the same weight', () => {
    expect(type(rice, '150').calories).toBe(rescaleScannedItem(rice, 150).calories);
    expect(type(rice, '150').protein).toBe(rescaleScannedItem(rice, 150).protein);
  });

  it('recovers after the field is cleared — the old guard made this permanent', () => {
    const cleared = rescaleScannedItem(rice, 0);
    expect(cleared.calories).toBe(0);
    const retyped = type(cleared, '150');
    expect(retyped.calories).toBe(360);
    expect(retyped.protein).toBe(6.6);
  });

  it('treats unparseable input as zero rather than NaN', () => {
    const bad = rescaleScannedItem(rice, Number('1.2.3'));
    expect(bad.grams).toBe(0);
    expect(bad.calories).toBe(0);
    expect(rescaleScannedItem(bad, 150).calories).toBe(360);
  });

  it('keeps a whole-meal row scalable once the user weighs it', () => {
    // `grams: 0` is the model-fallback shape: macros are a whole-meal estimate
    // with no per-gram truth, so the first weight entered defines the basis.
    const plate = item({ grams: 0, calories: 520, protein: 30, carbs: 60, fat: 18 });
    const weighed = rescaleScannedItem(plate, 300);
    expect(weighed.grams).toBe(300);
    expect(weighed.calories).toBe(520);
    expect(rescaleScannedItem(weighed, 600).calories).toBe(1040);
  });
});
