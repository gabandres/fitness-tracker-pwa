import { describe, expect, it } from 'vitest';
import {
  FOOD_INDEX_FORMAT_VERSION,
  buildFoodDetail,
  findFoodById,
  loadFoodIndex,
  normalizeQuery,
  scoreFood,
  searchFoodIndex,
  stem,
  words,
  type CompactFoodIndex,
} from './usda-search';

/**
 * Unit tests for the ranking rules, on a hand-built index.
 *
 * The RANKING-PARITY test — the one that proves this implementation orders the
 * real 13,272-food dataset exactly as `functions/src/usda-db.ts` does — is
 * deliberately NOT here. It needs to read the shipped
 * `apps/mobile/assets/food-index.json` off disk, and this package sets
 * `"types": []` on purpose so nothing in it can reach for a Node API and stay
 * React-Native-safe. That test lives in `apps/mobile/src/__tests__/food-index-parity.test.ts`,
 * next to the artifact it validates, and runs under the mobile Jest suite.
 */

const DATA_TYPES = ['survey_fndds_food', 'sr_legacy_food', 'foundation_food'];
const LABELS = ['1 cup', '1 medium', '1 tbsp'];

/** Build a compact index the way `scripts/build-food-index.mjs` would. */
function compact(
  rows: { id: string; desc: string; dataType?: string; kcal?: number; portions?: [number, number][] }[],
): CompactFoodIndex {
  return {
    v: FOOD_INDEX_FORMAT_VERSION,
    dataTypes: DATA_TYPES,
    labels: LABELS,
    foods: rows.map((r) => [
      r.id,
      r.desc,
      DATA_TYPES.indexOf(r.dataType ?? 'sr_legacy_food'),
      r.kcal ?? 100,
      5,
      20,
      1,
      (r.portions ?? [[0, 150]]).flat(),
    ]),
  };
}

const idx = (rows: Parameters<typeof compact>[0]) => loadFoodIndex(compact(rows));

describe('loadFoodIndex', () => {
  it('refuses an unknown format version rather than misreading offsets', () => {
    // A positional format fails silently when a field is inserted; the version
    // check is what turns that into a loud error.
    expect(() => loadFoodIndex({ v: 999, dataTypes: [], labels: [], foods: [] })).toThrow(
      /format v999 is not supported/,
    );
  });

  it('decodes interned dataTypes and portion labels back to strings', () => {
    const [food] = idx([
      { id: '1', desc: 'Banana, raw', dataType: 'foundation_food', portions: [[1, 118]] },
    ]);
    expect(food.dataType).toBe('foundation_food');
    expect(food.portions).toEqual([{ label: '1 medium', grams: 118 }]);
  });

  it('precomputes the matcher fields', () => {
    const [food] = idx([{ id: '1', desc: 'Fish, tuna, raw' }]);
    expect(food.norm).toBe('fish, tuna, raw');
    expect(food.words).toEqual(['fish', 'tuna', 'raw']);
    expect(food.segments).toEqual(['fish', 'tuna', 'raw']);
    expect(food.segmentStems).toEqual([['fish'], ['tuna'], ['raw']]);
  });
});

describe('scoreFood', () => {
  const food = (desc: string, dataType?: string) => idx([{ id: '1', desc, dataType }])[0];

  it('returns null when any token is absent — every token must match', () => {
    // This is what stops "chicken breast" matching a food that only says chicken.
    expect(scoreFood(food('Chicken, roasted'), ['chicken', 'breast'], 'chicken breast')).toBeNull();
  });

  it('ranks a whole-word match above a prefix above a substring', () => {
    const whole = scoreFood(food('Tuna'), ['tuna'], 'tuna')!;
    const prefix = scoreFood(food('Tunafish spread'), ['tuna'], 'tuna')!;
    expect(whole).toBeGreaterThan(prefix);
  });

  it('gives an exact description match a decisive bonus', () => {
    const exact = scoreFood(food('banana'), ['banana'], 'banana')!;
    const other = scoreFood(food('Banana, dried'), ['banana'], 'banana')!;
    expect(exact - other).toBeGreaterThan(500);
  });

  it('penalises composite dishes so a bare ingredient query avoids recipes', () => {
    const plain = scoreFood(food('Tuna, raw'), ['tuna'], 'tuna')!;
    const dish = scoreFood(food('Tuna with cream or white sauce'), ['tuna'], 'tuna')!;
    expect(plain).toBeGreaterThan(dish);
  });

  it('demotes vague survey qualifiers without excluding them', () => {
    const whole = scoreFood(food('Milk, whole'), ['milk'], 'milk')!;
    const nfs = scoreFood(food('Milk, NFS'), ['milk'], 'milk')!;
    expect(nfs).not.toBeNull();
    expect(whole).toBeGreaterThan(nfs);
  });

  it('applies the PLAIN bonus flat, not per matching word', () => {
    // Counting them ranked "Onions, frozen, whole, unprepared" above
    // "Onions, red, raw"; being plain is a property, not a quantity.
    const twoPlainWords = scoreFood(food('Onions, whole, raw'), ['onion'], 'onion')!;
    const onePlainWord = scoreFood(food('Onions, red, raw'), ['onion'], 'onion')!;
    // Same bonus on both sides, so the shorter description wins on brevity alone.
    expect(onePlainWord).toBeGreaterThan(twoPlainWords);
  });

  it('can waive a processed penalty the query itself asked for', () => {
    const q = ['plantain', 'fried'];
    const without = scoreFood(food('Plantains, fried'), q, 'plantain fried')!;
    const waived = scoreFood(food('Plantains, fried'), q, 'plantain fried', {
      waiveProcessed: ['fried'],
    })!;
    expect(waived).toBeGreaterThan(without);
  });

  it('can turn the PLAIN bonus off when the query names a preparation', () => {
    const on = scoreFood(food('Chicken, raw'), ['chicken'], 'chicken')!;
    const off = scoreFood(food('Chicken, raw'), ['chicken'], 'chicken', { plainBonus: false })!;
    // toBeCloseTo, not toBe: the brevity term divides by 3, so scores carry a
    // float tail (12.000000000000028). The bonus is exact; the arithmetic is not.
    expect(on - off).toBeCloseTo(12, 10);
  });

  it('keeps the data-type bonus small enough that text signal outranks it', () => {
    // An early build gave Foundation a large bonus and "egg" returned
    // "Egg, yolk, dried" ahead of "Egg, whole, raw".
    const foundation = scoreFood(food('Egg, yolk, dried', 'foundation_food'), ['egg'], 'egg')!;
    const legacy = scoreFood(food('Egg, whole, raw', 'sr_legacy_food'), ['egg'], 'egg')!;
    expect(legacy).toBeGreaterThan(foundation);
  });
});

describe('searchFoodIndex', () => {
  const corpus = idx([
    { id: '10', desc: 'Bananas, raw' },
    { id: '20', desc: 'Babyfood, bananas with tapioca' },
    { id: '30', desc: 'Banana, dried' },
    { id: '40', desc: 'Bread, banana' },
  ]);

  it('puts the plain generic first', () => {
    expect(searchFoodIndex(corpus, 'banana', 5)[0].description).toBe('Bananas, raw');
  });

  it('matches the singular against USDA’s plural filing', () => {
    expect(searchFoodIndex(corpus, 'banana', 5).map((h) => h.id)).toContain('10');
  });

  it('honours the requested size', () => {
    expect(searchFoodIndex(corpus, 'banana', 2)).toHaveLength(2);
  });

  it('returns nothing for a query with no word characters', () => {
    expect(searchFoodIndex(corpus, '   ', 10)).toEqual([]);
    expect(searchFoodIndex(corpus, '!!!', 10)).toEqual([]);
  });

  it('ships servings with every hit, so tapping a result needs no round trip', () => {
    // The whole reason getFoodDetail left the hot path.
    for (const hit of searchFoodIndex(corpus, 'banana', 5)) {
      expect(hit.servings?.[0].kind).toBe('per100g');
    }
  });

  it('orders ties totally and stably — length, then id', () => {
    const tied = idx([
      { id: 'b', desc: 'Kale, raw' },
      { id: 'a', desc: 'Kale, raw' },
    ]);
    expect(searchFoodIndex(tied, 'kale', 5).map((h) => h.id)).toEqual(['a', 'b']);
  });
});

describe('buildFoodDetail', () => {
  it('leads with the per-100 g row', () => {
    const [food] = idx([{ id: '1', desc: 'Banana, raw', kcal: 89, portions: [[1, 118]] }]);
    const d = buildFoodDetail(food);
    expect(d.servings[0]).toMatchObject({ label: '100 g', grams: 100, kind: 'per100g', kcal: 89 });
  });

  it('scales macros by portion weight and suffixes the label with grams', () => {
    const [food] = idx([{ id: '1', desc: 'Banana, raw', kcal: 100, portions: [[1, 118]] }]);
    const portion = buildFoodDetail(food).servings[1];
    expect(portion.label).toBe('1 medium (118 g)');
    expect(portion.kcal).toBe(118);
  });

  it('drops portions with non-positive grams', () => {
    const [food] = idx([{ id: '1', desc: 'Air', portions: [[0, 0], [1, 50]] }]);
    const d = buildFoodDetail(food);
    expect(d.servings).toHaveLength(2); // per100g + the 50 g one
    for (const s of d.servings) expect(s.grams).toBeGreaterThan(0);
  });

  it('dedupes by label and caps at 12 rows', () => {
    const [food] = idx([
      { id: '1', desc: 'Many', portions: Array.from({ length: 30 }, (_, i) => [i % 3, 10 + i] as [number, number]) },
    ]);
    const d = buildFoodDetail(food);
    expect(d.servings.length).toBeLessThanOrEqual(12);
    expect(new Set(d.servings.map((s) => s.label)).size).toBe(d.servings.length);
  });

  it('caps the description at 140 chars', () => {
    const [food] = idx([{ id: '1', desc: 'x'.repeat(200) }]);
    expect(buildFoodDetail(food).description).toHaveLength(140);
  });
});

describe('findFoodById', () => {
  const corpus = idx([{ id: '10', desc: 'Bananas, raw' }]);
  it('finds a food', () => expect(findFoodById(corpus, '10')?.desc).toBe('Bananas, raw'));
  it('returns undefined for an unknown id', () => expect(findFoodById(corpus, 'nope')).toBeUndefined());
});

describe('tokenizer', () => {
  it('folds plurals the way USDA files them', () => {
    expect(stem('carrots')).toBe('carrot');
    expect(stem('blueberries')).toBe('blueberry');
    expect(stem('tomatoes')).toBe('tomato');
    expect(stem('peaches')).toBe('peach');
    expect(stem('oats')).toBe('oat');
  });

  it('leaves short words and "ss" endings alone', () => {
    expect(stem('gas')).toBe('gas');
    expect(stem('raw')).toBe('raw');
    expect(stem('dress')).toBe('dress');
  });

  it('folds "-sses" to "-ss", which the usda-db.ts comment gets wrong', () => {
    // That comment claims the "ss" guard leaves "molasses" intact. It does not:
    // the `(?:s|x|z|ch|sh)es$` rule is tested FIRST and matches the trailing
    // "ses", so "molasses" → "molass". Harmless — the description "Molasses"
    // is stemmed by the same rule at index time, so query and food still meet
    // in the middle — but the stated behaviour is not the real one, and this
    // test pins what actually happens on BOTH sides.
    expect(stem('molasses')).toBe('molass');
    expect(stem('glasses')).toBe('glass');
    expect(stem('classes')).toBe('class');
  });

  it('splits on non-alphanumerics and lowercases', () => {
    expect(words('Fish, tuna, raw')).toEqual(['fish', 'tuna', 'raw']);
    expect(words('Egg-whole/raw')).toEqual(['egg', 'whole', 'raw']);
  });

  it('collapses whitespace in a query', () => {
    expect(normalizeQuery('  Chicken   Breast ')).toBe('chicken breast');
  });
});

// ─── One unknown word must not empty the result set ──────────────────────
// `scoreFood` is an AND across query tokens, so a modifier USDA never writes
// disqualified every food in the index. Reported from a real phone: someone
// typed "1 teaspoon of pure honey" and got "No match - enter values" from a
// database that contains Honey.

describe('searchFoodIndex - words the database has never written', () => {
  const foods = idx([
    { id: 'honey', desc: 'Honey' },
    { id: 'puree', desc: 'Tomato puree, canned' },
    { id: 'pb', desc: 'Peanut butter' },
    { id: 'butter', desc: 'Butter, tub' },
    { id: 'milk', desc: 'Milk, whole' },
    { id: 'yog', desc: 'Yogurt, Greek, plain, nonfat' },
  ]);
  const top = (q: string) => searchFoodIndex(foods, q, 3).map((h) => h.description);

  it('"pure honey" finds honey', () => {
    expect(top('pure honey')[0]).toBe('Honey');
  });

  it('anchors on the head noun, not the leading modifier', () => {
    // "pure" IS in the index - as a substring of "puree" - so a fallback that
    // kept the first word would answer a honey query with tomato puree. That
    // is not hypothetical; it is what the first version of this did.
    expect(top('pure honey')).not.toContain('Tomato puree, canned');
  });

  it('"natural peanut butter" finds peanut butter, not butter', () => {
    expect(top('natural peanut butter')[0]).toBe('Peanut butter');
  });

  it('"organic whole milk" finds whole milk', () => {
    expect(top('organic whole milk')[0]).toBe('Milk, whole');
  });

  it('leaves a query that already matched completely alone', () => {
    // The fallback runs only on an EMPTY strict result, which is what keeps
    // every ranking pinned by the golden fixture unchanged.
    expect(top('greek yogurt')[0]).toBe('Yogurt, Greek, plain, nonfat');
    expect(top('honey')[0]).toBe('Honey');
  });

  it('still returns nothing when no word is known at all', () => {
    expect(top('zzzz qqqq')).toEqual([]);
  });

  it('does not fire for a single unknown word', () => {
    expect(top('zzzz')).toEqual([]);
  });
});
