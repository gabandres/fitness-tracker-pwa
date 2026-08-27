import { describe, it, expect } from 'vitest';
import { parseMealUtterance, rankResolutionHits, resolveMealItem, pickResolutionHit, type ServingLike } from './meal-utterance';

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

describe('pickResolutionHit', () => {
  const h = (id: string, dataType?: string) => ({ id, dataType });

  it('prefers a USDA generic over a leading branded hit', () => {
    const hits = [h('a', 'Branded'), h('b', 'SR Legacy'), h('c', 'Foundation')];
    expect(pickResolutionHit(hits)?.id).toBe('c'); // Foundation wins
  });

  it('Foundation beats SR Legacy beats FNDDS', () => {
    expect(pickResolutionHit([h('x', 'Survey (FNDDS)'), h('y', 'SR Legacy')])?.id).toBe('y');
  });

  it('keeps relevance order within a rank', () => {
    expect(pickResolutionHit([h('a', 'SR Legacy'), h('b', 'SR Legacy')])?.id).toBe('a');
  });

  it('falls back to the first hit when none are generic (brand query)', () => {
    expect(pickResolutionHit([h('a', 'Branded'), h('b', 'OFF')])?.id).toBe('a');
  });

  it('empty list → undefined', () => {
    expect(pickResolutionHit([])).toBeUndefined();
  });
});

// ─── Volume family, label quantities and portion choice ──────────────────
// Each case below is a real defect measured against the shipped 13,272-food
// index, not a hypothetical: the numbers in the "was" comments are what the
// resolver actually returned before this block existed.

describe('resolveMealItem — volume units anchor on the food, not on a guess', () => {
  /** Milk carries a cup row, so its density is knowable: 244/236.588 g/ml. */
  const milk: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 61, protein: 3.2, carbs: 4.8, fat: 3.3, kind: 'per100g' },
    { label: '1 cup (244 g)', grams: 244, kcal: 149, protein: 7.8, carbs: 11.7, fat: 8, kind: 'portion' },
  ];
  /** Honey has a tbsp row but NO tsp row — 97% of the index looks like this. */
  const honey: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 304, protein: 0.3, carbs: 82, fat: 0, kind: 'per100g' },
    { label: '1 tbsp (21 g)', grams: 21, kcal: 64, protein: 0.1, carbs: 17, fat: 0, kind: 'portion' },
  ];
  const chicken: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6, kind: 'per100g' },
  ];

  it('ml resolves through the food\u2019s own cup row (was 25,000 g for 250 ml)', () => {
    const [it0] = parseMealUtterance('250 ml milk');
    const r = resolveMealItem(it0, milk)!;
    expect(r.grams).toBeCloseTo(257.8, 0);
    expect(r.assumed).toBe(false);
  });

  it('litres scale the same way', () => {
    const [it0] = parseMealUtterance('1 l milk');
    expect(resolveMealItem(it0, milk)!.grams).toBeCloseTo(1031.3, 0);
  });

  it('tsp derives from a tbsp row \u2014 exact, 1 tbsp = 3 tsp (was 100 g)', () => {
    const [it0] = parseMealUtterance('1 tsp honey');
    const r = resolveMealItem(it0, honey)!;
    expect(r.grams).toBeCloseTo(7, 1);
    expect(r.calories).toBe(21);
    expect(r.assumed).toBe(false);
  });

  it('a direct label match still wins over derivation', () => {
    const [it0] = parseMealUtterance('2 tbsp honey');
    expect(resolveMealItem(it0, honey)).toMatchObject({
      grams: 42, assumed: false, servingLabel: '1 tbsp (21 g)',
    });
  });

  it('a volume unit with no volumetric row never multiplies 100 g by the volume', () => {
    const [it0] = parseMealUtterance('250 ml chicken');
    const r = resolveMealItem(it0, chicken)!;
    expect(r.grams).toBeLessThan(400); // was 25,000
    expect(r.assumed).toBe(true);
  });
});

describe('resolveMealItem — a label\u2019s own quantity is not 1', () => {
  const whey: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 359, protein: 78, carbs: 8, fat: 1, kind: 'per100g' },
    { label: '3 scoop (86 g)', grams: 86, kcal: 309, protein: 67, carbs: 6.9, fat: 0.9, kind: 'portion' },
  ];

  it('divides by the count the label states (was 86 g for one scoop)', () => {
    const [it0] = parseMealUtterance('1 scoop whey protein');
    const r = resolveMealItem(it0, whey)!;
    expect(r.grams).toBeCloseTo(28.7, 1);
    expect(r.calories).toBe(103);
  });

  it('a half-cup label yields a full cup at quantity 1', () => {
    const beans: ServingLike[] = [
      { label: '100 g', grams: 100, kcal: 132, protein: 8.9, carbs: 24, fat: 0.5, kind: 'per100g' },
      { label: '0.5 cup (86 g)', grams: 86, kcal: 114, protein: 7.6, carbs: 20, fat: 0.4, kind: 'portion' },
    ];
    const [it0] = parseMealUtterance('1 cup black beans');
    expect(resolveMealItem(it0, beans)!.grams).toBeCloseTo(172, 0);
  });
});

describe('resolveMealItem — picks the representative portion, not the first', () => {
  const bread: ServingLike[] = [
    { label: '100 g', grams: 100, kcal: 265, protein: 9, carbs: 49, fat: 3.2, kind: 'per100g' },
    { label: '1 slice, snack-size (10 g)', grams: 10, kcal: 27, protein: 0.9, carbs: 4.9, fat: 0.3, kind: 'portion' },
    { label: '1 small or thin/very thin slice (24 g)', grams: 24, kcal: 64, protein: 2.2, carbs: 12, fat: 0.8, kind: 'portion' },
    { label: '1 medium or regular slice (36 g)', grams: 36, kcal: 95, protein: 3.2, carbs: 18, fat: 1.2, kind: 'portion' },
    { label: '1 large or thick slice (43 g)', grams: 43, kcal: 114, protein: 3.9, carbs: 21, fat: 1.4, kind: 'portion' },
  ];

  it('two slices means two regular slices (was the snack-size row, 20 g)', () => {
    const [it0] = parseMealUtterance('2 slices whole wheat bread');
    const r = resolveMealItem(it0, bread)!;
    expect(r.grams).toBeCloseTo(72, 0);
    expect(r.servingLabel).toBe('1 medium or regular slice (36 g)');
  });
});

describe('parseMealUtterance — fluid ounces', () => {
  it('"fl oz" written with a space is one unit', () => {
    expect(item('8 fl oz orange juice')).toEqual([
      { quantity: 8, unit: 'floz', food: 'orange juice' },
    ]);
  });

  it('"fluid ounces" spelled out', () => {
    expect(item('12 fluid ounces of milk')).toEqual([
      { quantity: 12, unit: 'floz', food: 'milk' },
    ]);
  });
});

describe('rankResolutionHits', () => {
  const h = (id: string, dataType: string) => ({ id, dataType });

  it('orders by generic tier, then by relevance', () => {
    const hits = [h('a', 'Branded'), h('b', 'Survey (FNDDS)'), h('c', 'Foundation'), h('d', 'SR Legacy')];
    expect(rankResolutionHits(hits).map((x) => x.id)).toEqual(['c', 'd', 'b', 'a']);
  });

  it('is stable within a tier', () => {
    const hits = [h('a', 'SR Legacy'), h('b', 'SR Legacy')];
    expect(rankResolutionHits(hits).map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('still leads with what pickResolutionHit would have chosen', () => {
    const hits = [h('a', 'Branded'), h('b', 'Survey (FNDDS)'), h('c', 'Foundation')];
    expect(rankResolutionHits(hits)[0]).toBe(pickResolutionHit(hits));
  });
});
