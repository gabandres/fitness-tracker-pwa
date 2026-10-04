import { parseGrams, rescaleFromBasis } from '@/lib/grams-rescale';

/** The grams field's arithmetic: one multiplication from the basis, every time. */
const basis = { grams: 118, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4 };

it('scales from the basis, with the form’s rounding', () => {
  expect(rescaleFromBasis(basis, 236)).toEqual({ calories: 210, protein: 2.6, carbs: 54, fat: 0.8 });
});

it('is path-independent: no intermediate weight leaks into the result', () => {
  const direct = rescaleFromBasis(basis, 200);
  for (const g of [1, 15, 150, 3]) rescaleFromBasis(basis, g);
  expect(rescaleFromBasis(basis, 200)).toEqual(direct);
});

it('leaves a macro the basis lacks undefined, and refuses unusable weights', () => {
  expect(rescaleFromBasis({ grams: 100, kcal: 50 }, 50)).toEqual({ calories: 25, protein: undefined, carbs: undefined, fat: undefined });
  expect(rescaleFromBasis(basis, 0)).toBeNull();
  expect(rescaleFromBasis({ ...basis, grams: 0 }, 10)).toBeNull();
});

it('parses a decimal comma and rejects empty, zero and typo-sized text', () => {
  expect(parseGrams('12,5')).toBe(12.5);
  expect(parseGrams('')).toBeNull();
  expect(parseGrams('0')).toBeNull();
  expect(parseGrams('1.')).toBe(1);
  expect(parseGrams('99999')).toBeNull();
});
