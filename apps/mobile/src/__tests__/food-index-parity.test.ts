import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FOOD_INDEX_FORMAT_VERSION,
  loadFoodIndex,
  searchFoodIndex,
  translateFoodTerm,
  type CompactFoodIndex,
  type IndexedFood,
} from '@macrolog/core';
import { searchFoodIndexReference, stem, words } from '@macrolog/core/usda-search';

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

/**
 * The inverted index answers EXACTLY what the linear scan answered.
 *
 * `searchFoodIndex` stopped scanning on 2026-10-21: it now classifies each
 * query token once per distinct corpus word and scores only the foods every
 * token reaches (`usda-search.ts`, "Speed"). The golden fixture above pins 24
 * curated queries; this pins the CLAIM — same foods, same order, same
 * servings — against `searchFoodIndexReference`, the old scan kept verbatim as
 * the oracle, over queries generated from the shipped index itself: what a
 * user types while a food name forms under their thumbs.
 *
 * The oracle gets its own `loadFoodIndex`, so neither side can answer from
 * state the other built. Equality is `toEqual` on the whole hit array, so a
 * swapped pair of tied rows fails just as a missing food does.
 */
describe('the inverted index reproduces the linear scan, query for query', () => {
  const oracle = loadFoodIndex(raw);

  const queries = (() => {
    const out = new Set<string>();
    const add = (q: string) => {
      if (q.trim()) out.add(q);
    };
    // Every 97th food: ~137 foods spread across the three datasets, in the
    // index's own order, so the sample is deterministic.
    raw.foods.forEach((row, i) => {
      if (i % 97 !== 0) return;
      const desc = row[1];
      const w = words(desc);
      if (w.length === 0) return;
      const [a, b, c] = w;
      // The name forming under the thumb.
      add(a.slice(0, 2));
      add(a.slice(0, 3));
      add(a.slice(0, 5));
      add(a);
      if (b) {
        add(`${a} ${b.slice(0, 1)}`);
        add(`${a} ${b}`);
        add(`${b} ${a}`); // word order the user chose, not USDA's
      }
      if (c) add(`${a} ${b} ${c}`);
      add(desc.split(',')[0]); // the head segment, exact-ish
      add(desc); // the whole description, punctuation and all
      // What the matcher tolerates: plurals both ways, a mid-word substring.
      add(stem(a) === a ? `${a}s` : stem(a));
      if (a.length > 5) add(a.slice(1, -1));
      // Words the corpus never wrote, to exercise the head-anchored fallback
      // (unknown modifier) and its refusal to drop the head (unknown head).
      add(`zqxj ${a}`);
      if (b) add(`${a} zqxj ${b}`);
      add(`${a} zqxj`);
    });
    // Restaurant chains are never relaxed; Spanish / Portuguese go through the
    // same alias table `localSearch` applies, AND raw, as a user might paste.
    for (const q of [
      'starbucks latte', 'mcdonalds fries', 'chipotle burrito bowl',
      'pollo', 'frango', 'pechuga de pollo', 'peito de frango', 'huevos', 'ovos',
      'leche', 'leite', 'arroz', 'frijoles', 'feijao', 'carne molida', 'atun', 'salmao',
      'c', 'e', '1', '2%', '.', 'egg egg', 'raw raw', 'nfs', 'with', 'and or',
      'skin not eaten', 'ns as to form', '  Chicken   Breast  ', 'CHICKEN, ROASTED',
    ]) {
      add(q);
      add(translateFoodTerm(q));
    }
    return [...out];
  })();

  it('generates a corpus worth trusting', () => {
    // A regression to a handful of queries would turn this into a smoke test.
    expect(queries.length).toBeGreaterThan(1000);
  });

  it('returns the same hits in the same order at the typeahead page size', () => {
    const diffs: string[] = [];
    for (const q of queries) {
      const fast = searchFoodIndex(index(), q, 20);
      const slow = searchFoodIndexReference(oracle, q, 20);
      if (JSON.stringify(fast) !== JSON.stringify(slow)) diffs.push(q);
    }
    expect(diffs).toEqual([]);
  });

  it('agrees deep into the ranking, not just on the visible page', () => {
    // A wrong tie order often hides below row 20; 400 rows reaches it. Every
    // 4th query keeps the suite's wall time sane — the scan is the slow side.
    const diffs: string[] = [];
    queries.forEach((q, i) => {
      if (i % 4 !== 0) return;
      const fast = searchFoodIndex(index(), q, 400);
      const slow = searchFoodIndexReference(oracle, q, 400);
      if (JSON.stringify(fast) !== JSON.stringify(slow)) diffs.push(q);
    });
    expect(diffs).toEqual([]);
  });

  it('lazily derived food fields equal the old eager decode, for every food', () => {
    // `loadFoodIndex` used to precompute these; it now derives them on first
    // read. Pinned over the whole shipped corpus, not a sample.
    const bad: string[] = [];
    for (const food of oracle) {
      const norm = food.desc.toLowerCase();
      const ok =
        food.norm === norm &&
        JSON.stringify(food.words) === JSON.stringify(words(food.desc)) &&
        JSON.stringify(food.wordStems) === JSON.stringify(words(food.desc).map(stem)) &&
        JSON.stringify(food.segments) === JSON.stringify(norm.split(',').map((x) => x.trim())) &&
        JSON.stringify(food.segmentStems) === JSON.stringify(norm.split(',').map((x) => words(x).map(stem)));
      if (!ok) bad.push(food.id);
    }
    expect(bad).toEqual([]);
  });
});
