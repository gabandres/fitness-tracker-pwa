import { describe, it, expect } from 'vitest';
import { parseMealUtterance, resolveMealItem, type ServingLike } from './meal-utterance';

/** Terse helper: assert one parsed item's fields (ignores `raw`). */
function item(text: string) {
  const items = parseMealUtterance(text);
  return items.map(({ quantity, unit, food }) => ({ quantity, unit, food }));
}

describe('parseMealUtterance — single item', () => {
  it('bare count, plural food', () => {
    expect(item('2 eggs')).toEqual([{ quantity: 2, unit: null, food: 'eggs' }]);
  });

  it('unit + "of" + multiword food', () => {
    expect(item('1 cup of white rice')).toEqual([
      { quantity: 1, unit: 'cup', food: 'white rice' },
    ]);
  });

  it('decimal quantity, plural unit singularised', () => {
    expect(item('1.5 cups rice')).toEqual([
      { quantity: 1.5, unit: 'cup', food: 'rice' },
    ]);
  });

  it('grams glued to the number', () => {
    expect(item('100g chicken')).toEqual([
      { quantity: 100, unit: 'g', food: 'chicken' },
    ]);
  });

  it('grams with a space, multiword food', () => {
    expect(item('100 g chicken breast')).toEqual([
      { quantity: 100, unit: 'g', food: 'chicken breast' },
    ]);
  });

  it('word number + plural unit', () => {
    expect(item('two slices of bread')).toEqual([
      { quantity: 2, unit: 'slice', food: 'bread' },
    ]);
  });

  it('article "a" is quantity 1, no unit', () => {
    expect(item('a banana')).toEqual([{ quantity: 1, unit: null, food: 'banana' }]);
  });

  it('article "an"', () => {
    expect(item('an apple')).toEqual([{ quantity: 1, unit: null, food: 'apple' }]);
  });

  it('bare food defaults to quantity 1', () => {
    expect(item('banana')).toEqual([{ quantity: 1, unit: null, food: 'banana' }]);
  });

  it('ascii fraction', () => {
    expect(item('1/2 cup oats')).toEqual([{ quantity: 0.5, unit: 'cup', food: 'oats' }]);
  });

  it('"half a cup of milk"', () => {
    expect(item('half a cup of milk')).toEqual([
      { quantity: 0.5, unit: 'cup', food: 'milk' },
    ]);
  });

  it('"a half cup" — article then half', () => {
    expect(item('a half cup of rice')).toEqual([
      { quantity: 0.5, unit: 'cup', food: 'rice' },
    ]);
  });

  it('unicode fraction glued', () => {
    expect(item('½ cup rice')).toEqual([{ quantity: 0.5, unit: 'cup', food: 'rice' }]);
  });

  it('mixed number "1 1/2"', () => {
    expect(item('1 1/2 cups flour')).toEqual([
      { quantity: 1.5, unit: 'cup', food: 'flour' },
    ]);
  });

  it('household measure "handful"', () => {
    expect(item('a handful of almonds')).toEqual([
      { quantity: 1, unit: 'handful', food: 'almonds' },
    ]);
  });

  it('trailing grams "food NNg"', () => {
    expect(item('chicken breast 200g')).toEqual([
      { quantity: 200, unit: 'g', food: 'chicken breast' },
    ]);
  });

  it('trailing number + spaced unit', () => {
    expect(item('greek yogurt 150 g')).toEqual([
      { quantity: 150, unit: 'g', food: 'greek yogurt' },
    ]);
  });

  it('oz mass unit', () => {
    expect(item('4 oz salmon')).toEqual([{ quantity: 4, unit: 'oz', food: 'salmon' }]);
  });

  it('tbsp abbreviation', () => {
    expect(item('2 tbsp peanut butter')).toEqual([
      { quantity: 2, unit: 'tbsp', food: 'peanut butter' },
    ]);
  });
});

describe('parseMealUtterance — multi item', () => {
  it('splits on "and"', () => {
    expect(item('2 eggs and a cup of rice')).toEqual([
      { quantity: 2, unit: null, food: 'eggs' },
      { quantity: 1, unit: 'cup', food: 'rice' },
    ]);
  });

  it('splits on commas', () => {
    expect(item('2 eggs, 1 banana, 100g oats')).toEqual([
      { quantity: 2, unit: null, food: 'eggs' },
      { quantity: 1, unit: null, food: 'banana' },
      { quantity: 100, unit: 'g', food: 'oats' },
    ]);
  });

  it('splits on newlines', () => {
    expect(item('2 eggs\n1 cup rice')).toEqual([
      { quantity: 2, unit: null, food: 'eggs' },
      { quantity: 1, unit: 'cup', food: 'rice' },
    ]);
  });

  it('splits on "+"', () => {
    expect(item('rice + beans')).toEqual([
      { quantity: 1, unit: null, food: 'rice' },
      { quantity: 1, unit: null, food: 'beans' },
    ]);
  });
});

describe('parseMealUtterance — Spanish (es-PR)', () => {
  it('"2 huevos y una taza de arroz blanco"', () => {
    expect(item('2 huevos y una taza de arroz blanco')).toEqual([
      { quantity: 2, unit: null, food: 'huevos' },
      { quantity: 1, unit: 'cup', food: 'arroz blanco' },
    ]);
  });

  it('"media taza de avena"', () => {
    expect(item('media taza de avena')).toEqual([
      { quantity: 0.5, unit: 'cup', food: 'avena' },
    ]);
  });

  it('Spanish grams "150 gramos de pollo"', () => {
    expect(item('150 gramos de pollo')).toEqual([
      { quantity: 150, unit: 'g', food: 'pollo' },
    ]);
  });
});

describe('parseMealUtterance — noise & edge cases', () => {
  it('empty input → no items', () => {
    expect(item('')).toEqual([]);
    expect(item('   ')).toEqual([]);
  });

  it('drops segments with no food', () => {
    expect(item('2 eggs and')).toEqual([{ quantity: 2, unit: null, food: 'eggs' }]);
  });

  it('trims capitalisation and extra whitespace', () => {
    expect(item('  2   EGGS  ')).toEqual([{ quantity: 2, unit: null, food: 'eggs' }]);
  });

  it('preserves the raw slice for transparency', () => {
    const [it0] = parseMealUtterance('2 eggs and a cup of rice');
    expect(it0.raw).toBe('2 eggs');
  });
});

describe('resolveMealItem', () => {
  const chicken: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6, kind: 'per100g' },
  ];
  const rice: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, kind: 'per100g' },
    { label: '1 cup cooked (158 g)', grams: 158, kcal: 205, protein: 4.3, carbs: 45, fat: 0.4, kind: 'portion' },
  ];
  const egg: ServingLike[] = [
    { label: '1 large (50 g)', grams: 50, kcal: 72, protein: 6.3, carbs: 0.4, fat: 4.8, kind: 'portion' },
    { label: '100 g', grams: 100, kcal: 143, protein: 12.6, carbs: 0.7, fat: 9.5, kind: 'per100g' },
  ];

  const [pIt] = parseMealUtterance('100 g chicken');
  it('mass unit scales the per-100g row exactly', () => {
    expect(resolveMealItem(pIt, chicken)).toMatchObject({
      grams: 100, calories: 165, protein: 31, assumed: false,
    });
  });

  it('mass unit scales by ratio', () => {
    const [it200] = parseMealUtterance('200 g chicken');
    expect(resolveMealItem(it200, chicken)).toMatchObject({
      grams: 200, calories: 330, protein: 62, assumed: false,
    });
  });

  it('portion word matches a serving by label', () => {
    const [it0] = parseMealUtterance('1 cup rice');
    expect(resolveMealItem(it0, rice)).toMatchObject({
      grams: 158, calories: 205, protein: 4.3, assumed: false, servingLabel: '1 cup cooked (158 g)',
    });
  });

  it('portion word multiplies by quantity', () => {
    const [it0] = parseMealUtterance('2 cups rice');
    expect(resolveMealItem(it0, rice)).toMatchObject({
      grams: 316, calories: 410, assumed: false,
    });
  });

  it('bare count uses the default portion serving, not per-100g', () => {
    const [it0] = parseMealUtterance('2 eggs');
    expect(resolveMealItem(it0, egg)).toMatchObject({
      grams: 100, calories: 144, protein: 12.6, assumed: false, servingLabel: '1 large (50 g)',
    });
  });

  it('unmatched unit falls back and flags an assumption', () => {
    const [it0] = parseMealUtterance('1 slice chicken');
    expect(resolveMealItem(it0, chicken)).toMatchObject({
      calories: 165, assumed: true,
    });
  });

  it('no servings → null', () => {
    const [it0] = parseMealUtterance('2 eggs');
    expect(resolveMealItem(it0, [])).toBeNull();
  });
});
