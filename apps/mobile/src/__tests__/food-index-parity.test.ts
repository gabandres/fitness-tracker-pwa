import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FOOD_INDEX_FORMAT_VERSION,
  loadFoodIndex,
  searchFoodIndex,
  type CompactFoodIndex,
  type IndexedFood,
} from '@macrolog/core';

/**
 * Ranking parity between the on-device search and the server's.
 *
 * ## Why this test is the load-bearing one for on-device search
 *
 * The USDA ranking exists twice and cannot exist once: `functions/` is not a
 * workspace and cannot import `@macrolog/core` (the same constraint that forces
 * `food-plausibility.ts` and the food-search wire types to be hand-mirrored).
 * So `functions/src/usda-db.ts` and `packages/core/src/usda-search.ts` hold the
 * same hundred lines of scoring rules in two places.
 *
 * That drift would be **invisible without this test**. Both copies keep
 * returning plausible foods; only the ORDER differs, on a typeahead nobody
 * diffs. The web app (frozen, but still correct — ADR-0022) would rank
 * "tomato sauce" one way and the phone another, and no build, type check or
 * existing test would notice.
 *
 * `packages/core/src/__fixtures__/usda-search-golden.json` pins it: the exact
 * ordered ids `searchUsda` returns for a corpus of queries, each of which
 * corresponds to a ranking rule with a documented past failure behind it. This
 * asserts the on-device copy reproduces it over the REAL shipped index.
 *
 * ## If this fails
 *
 * Read the diff before doing anything. Regenerating the fixture
 * (`node scripts/build-food-golden.mjs`) makes the test pass and makes the
 * drift permanent. Regenerate only when the ranking changed **on purpose**.
 *
 * It lives here rather than in `packages/core` because it reads files off disk
 * and core sets `"types": []` deliberately, so nothing in that package can
 * reach for a Node API and stay React-Native-safe.
 */
const REPO = join(__dirname, '../../../..');
const INDEX_PATH = join(REPO, 'apps/mobile/assets/food-index.json');
const GOLDEN_PATH = join(REPO, 'packages/core/src/__fixtures__/usda-search-golden.json');

interface Golden {
  size: number;
  foods: number;
  cases: { query: string; why: string; hits: { id: string; description: string }[] }[];
}

const golden = JSON.parse(readFileSync(GOLDEN_PATH, 'utf8')) as Golden;
const raw = JSON.parse(readFileSync(INDEX_PATH, 'utf8')) as CompactFoodIndex;

let cached: IndexedFood[] | null = null;
const index = (): IndexedFood[] => (cached ??= loadFoodIndex(raw));

describe('bundled food index', () => {
  it('is the format version the reader expects', () => {
    expect(raw.v).toBe(FOOD_INDEX_FORMAT_VERSION);
  });

  it('was built from the same ingest as the golden fixture', () => {
    // Without this, a ranking failure below could just mean the index and the
    // fixture were generated from different datasets — a much less alarming
    // problem than a scoring drift, and worth telling apart immediately.
    expect(raw.foods).toHaveLength(golden.foods);
  });

  it('interns aggressively enough to be worth the second format', () => {
    // Not a size assertion in bytes (brittle), but the property that makes it
    // small: a handful of dataTypes and a few hundred labels across ~35k
    // portions. If these blow up, the ingest changed shape.
    expect(raw.dataTypes.length).toBeLessThan(10);
    expect(raw.labels.length).toBeLessThan(raw.foods.length);
  });
});

describe('on-device ranking matches the server, query for query', () => {
  for (const c of golden.cases) {
    it(`"${c.query}" — ${c.why}`, () => {
      const hits = searchFoodIndex(index(), c.query, golden.size);
      expect(hits.map((h) => h.id)).toEqual(c.hits.map((h) => h.id));
      // Descriptions as well: matching ids with differing descriptions would
      // mean the index and the fixture came from different ingests.
      expect(hits.map((h) => h.description)).toEqual(c.hits.map((h) => h.description));
    });
  }
});

describe('on-device search over the real corpus', () => {
  it('ships servings with every hit, so tapping a result needs no round trip', () => {
    for (const hit of searchFoodIndex(index(), 'chicken breast', 10)) {
      expect(hit.servings?.length).toBeGreaterThan(0);
      expect(hit.servings![0].kind).toBe('per100g');
    }
  });

  it('answers a full-corpus query well inside a keystroke budget', () => {
    // Not a benchmark — a floor. The whole premise of Tier D is that a scan of
    // 13,272 foods is cheap enough to run per keystroke. If this ever takes
    // seconds on CI hardware, the premise is gone and the feature should go
    // back to the server. Generous because CI machines are not phones; the
    // measured figure is 2–4 ms here and ~20–40 ms on the LG G6.
    index(); // exclude the one-time decode from the measurement
    const t0 = Date.now();
    for (const q of ['chicken', 'banana', 'greek yogurt', 'brown rice', 'olive oil']) {
      searchFoodIndex(index(), q, 20);
    }
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  it('finds something for every common staple a user might type first', () => {
    const staples = ['chicken', 'rice', 'egg', 'milk', 'bread', 'apple', 'beef', 'salmon', 'yogurt', 'oats'];
    // Jest has no per-assertion message argument (that is vitest), so name the
    // query in the expected value instead — a bare "0 is not > 0" would not say
    // WHICH staple broke.
    const empty = staples.filter((q) => searchFoodIndex(index(), q, 5).length === 0);
    expect(empty).toEqual([]);
  });
});
