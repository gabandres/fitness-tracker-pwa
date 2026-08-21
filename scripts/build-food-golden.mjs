#!/usr/bin/env node
/**
 * build-food-golden — pin the food-search ranking so its two copies cannot drift.
 *
 *   npm --prefix functions run build      # REQUIRED first — reads functions/lib
 *   node scripts/build-food-golden.mjs
 *   node scripts/build-food-golden.mjs --check
 *
 * ## The problem this solves
 *
 * The USDA ranking now exists twice: `functions/src/usda-db.ts` (the server, and
 * what the frozen web app still calls) and `packages/core/src/usda-search.ts`
 * (on-device, for the Expo app). It cannot exist once — `functions/` is not a
 * workspace and cannot import `@macrolog/core`, which is the same constraint
 * that already forces `food-plausibility.ts` and the food-search wire types to
 * be hand-mirrored.
 *
 * Two hand-maintained copies of a hundred-line scoring function will drift, and
 * this drift is the invisible kind: both sides keep returning plausible foods,
 * just in a different order, on a surface nobody diffs. A user would see the web
 * app and the phone rank "tomato sauce" differently and nothing would fail.
 *
 * So the ranking is pinned to a fixture. This script runs the SERVER
 * implementation — the older of the two, and the one the web app depends on —
 * over a query corpus and records the exact ordered ids it returns.
 * `packages/core/src/usda-search.test.ts` asserts the on-device copy reproduces
 * it, and `functions/src/usda-db.golden.test.ts` asserts the server copy still
 * does. Change either ranking and BOTH suites go red until this is re-run
 * deliberately.
 *
 * `--check` verifies the committed fixture is current without writing, so CI
 * catches a re-ingest that silently reorders results.
 *
 * ## Choosing the corpus
 *
 * The queries below are not arbitrary. They are the ones whose ranking was
 * argued for in `usda-db.ts`'s own comments — each documents a specific wrong
 * answer that a scoring rule exists to prevent ("tuna" returning a sandwich
 * wrap, "tomato sauce" returning steak sauce, "egg" returning dried yolk,
 * "onion" returning onion bread). A fixture over those is a regression test for
 * every rule that has already cost someone a debugging session, rather than a
 * snapshot of whatever the code happens to do today.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'functions/lib/usda-db.js');
const DATA = join(ROOT, 'functions/data/usda-foods.json');
const OUT = join(ROOT, 'packages/core/src/__fixtures__/usda-search-golden.json');

const checkOnly = process.argv.includes('--check');

if (!existsSync(LIB)) {
  console.error(`missing ${LIB}\nRun: npm --prefix functions run build`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const { loadFoods, searchUsda } = require(LIB);

/**
 * Every entry here corresponds to a ranking rule with a documented failure
 * behind it. Keep the `why` — it is what tells the next person whether a diff
 * in this fixture is a fix or a regression.
 */
const CORPUS = [
  { q: 'banana', why: 'bare generic — must return the raw fruit, not babyfood with tapioca' },
  { q: 'egg', why: 'data-type bonus must stay small: an early build returned dried yolk (654 kcal)' },
  { q: 'onion', why: 'plural stemming — without it "Bread, onion" beat "Onions, raw"' },
  { q: 'carrot', why: 'plural stemming — without it "Carrot, dehydrated" won' },
  { q: 'tuna', why: 'head-match: "Tuna salad sandwich wrap" leads with the word and is the wrong food' },
  { q: 'tomato sauce', why: 'whole-query cover must outrank head-only: "Sauce, steak, tomato based" bug' },
  { q: 'chicken breast', why: 'leading-segment cover — compound vs spread-across-segments must tie' },
  { q: 'cheddar cheese', why: 'USDA inverts compounds; cover test is order-insensitive' },
  { q: 'ground beef', why: 'inverted compound, filed as "Beef, ground"' },
  { q: 'milk', why: 'VAGUE_MARKERS must demote "Milk, NFS" below "Milk, whole"' },
  { q: 'plantain', why: 'typeahead waives nothing — the raw one, not "Plantains, fried"' },
  { q: 'oats', why: 'stem guard: "oats"→"oat" works while "molasses" is left alone' },
  { q: 'blueberries', why: 'ies→y stemming' },
  { q: 'tomatoes', why: 'oes→o stemming' },
  { q: 'peaches', why: 'ches→ch stemming' },
  { q: 'greek yogurt', why: 'two-token query where neither token is the USDA head' },
  { q: 'olive oil', why: 'composite penalty must not sink a legitimate two-word food' },
  { q: 'white rice', why: 'colour qualifier as a leading segment' },
  { q: 'almond', view: true, why: 'singular against a plural-filed nut' },
  { q: 'salmon', why: 'genus filing — "Fish, salmon, …" is the second segment' },
  { q: 'sweet potato', why: 'two-word food that PROCESSED words also match' },
  { q: 'peanut butter', why: 'processed-but-intended: the penalty must not bury the actual food' },
  { q: 'black beans', why: 'plural + colour qualifier' },
  { q: 'whole wheat bread', why: 'three tokens, PLAIN word inside the query itself' },
];

const SIZE = 10;

const foods = loadFoods(DATA);
const cases = CORPUS.map(({ q, why }) => ({
  query: q,
  why,
  // Ids only, plus descriptions for human review. The ids are the assertion;
  // the descriptions exist so a diff in this file is READABLE — a list of
  // bare FDC ids tells a reviewer nothing about whether a change is a fix.
  hits: searchUsda(foods, q, SIZE).map((h) => ({ id: h.id, description: h.description })),
}));

const fixture = {
  note: 'GENERATED by scripts/build-food-golden.mjs — do not hand-edit. See that file for why this exists.',
  generatedFrom: 'functions/src/usda-db.ts (searchUsda)',
  size: SIZE,
  foods: foods.length,
  cases,
};
const json = `${JSON.stringify(fixture, null, 2)}\n`;

const empty = cases.filter((c) => c.hits.length === 0);
if (empty.length) {
  console.error(`refusing to write: ${empty.length} corpus quer(ies) returned NO hits:`);
  for (const c of empty) console.error(`  "${c.query}"`);
  console.error('A query that matches nothing pins nothing. Fix the corpus or the dataset.');
  process.exit(1);
}

if (checkOnly) {
  if (!existsSync(OUT)) {
    console.error(`STALE: ${OUT} does not exist.\nRun: node scripts/build-food-golden.mjs`);
    process.exit(1);
  }
  if (readFileSync(OUT, 'utf8') !== json) {
    console.error(`STALE: ${OUT} does not match the current server ranking.`);
    console.error('Either the ranking changed on purpose (regenerate) or it changed by accident (fix it).');
    console.error('Run: node scripts/build-food-golden.mjs');
    process.exit(1);
  }
  console.log(`golden fixture is current — ${cases.length} queries, top ${SIZE}, ${foods.length} foods`);
  process.exit(0);
}

writeFileSync(OUT, json);
console.log(`wrote ${OUT}`);
console.log(`${cases.length} queries · top ${SIZE} · ${foods.length} foods`);
for (const c of cases.slice(0, 6)) {
  console.log(`  ${c.query.padEnd(18)} → ${c.hits[0].description}`);
}
