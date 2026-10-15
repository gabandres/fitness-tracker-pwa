import type { CustomFood } from '@macrolog/core';
import { repeatPrefill } from '@/lib/repeat-servings';

/**
 * Audit 2026-10-15 #11 (open since 09-22): the scan's "you logged this
 * before" prefill multiplied the stored serving by the note's NUMBER and
 * ignored its UNIT — "2 tbsp peanut butter" against a 32 g serving drafted
 * two servings (64 g) — and wrote missing carbs/fat as 0.
 */
const pb: CustomFood = {
  name: 'Peanut butter', calories: 190, protein: 7, servingSize: 32, servingUnit: 'g', source: 'manual',
} as CustomFood;
const shake: CustomFood = {
  name: 'Protein shake', calories: 160, protein: 30, servingSize: 1, servingUnit: 'serving', source: 'manual',
} as CustomFood;
const milk: CustomFood = {
  name: 'Milk', calories: 120, protein: 8, carbs: 12, fat: 5, servingSize: 240, servingUnit: 'ml', source: 'manual',
} as CustomFood;

it('a bare count is that many servings', () => {
  expect(repeatPrefill(shake, 2, null)).toMatchObject({ calories: 320, protein: 60 });
});

it('a mass unit converts through a grams-first serving', () => {
  expect(repeatPrefill(pb, 64, 'g').calories).toBe(380);
  expect(repeatPrefill(pb, 1, 'oz').calories).toBe(Math.round((190 * 28.3495) / 32));
});

it('a volume unit converts through a millilitre serving', () => {
  expect(repeatPrefill(milk, 1, 'cup').calories).toBe(Math.round((120 * 236.5882365) / 240));
});

it('a unit the serving cannot answer drafts ONE stored serving, not "2 of them"', () => {
  expect(repeatPrefill(pb, 2, 'tbsp').calories).toBe(190);
});

it('an unstated amount drafts one serving', () => {
  expect(repeatPrefill(pb, null, null).calories).toBe(190);
});

it('keeps missing macros missing rather than writing 0', () => {
  const p = repeatPrefill(pb, 1, null);
  expect(p).not.toHaveProperty('carbs');
  expect(p).not.toHaveProperty('fat');
  expect(p.mealLabel).toBe('Peanut butter');
});
