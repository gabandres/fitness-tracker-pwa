import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildFoodDetail, findFoodById, loadFoodIndex, parseMealUtterance, searchFoodIndex,
  type CompactFoodIndex, type IndexedFood,
} from '@macrolog/core';
import { resolveOneItem, type ResolutionDeps } from '../lib/mealResolution';

/**
 * Meal-text resolution POLICY, end to end over the REAL shipped index.
 *
 * `usda-search.test.ts` unit-tests the two predicates on a hand-built index;
 * this asserts what a user actually gets, against the 13,272 foods that ship.
 * That distinction matters here more than usual: the mechanism under test was
 * designed by measuring outcomes across the real corpus, and a hand-built
 * fixture would have agreed with whatever the design already believed.
 *
 * It lives here rather than in `packages/core` for the same reason
 * `food-index-parity.test.ts` does — it reads files off disk, and core sets
 * `"types": []` so nothing in that package may reach for a Node API.
 */
const REPO = join(__dirname, '../../../..');
const raw = JSON.parse(
  readFileSync(join(REPO, 'apps/mobile/assets/food-index.json'), 'utf8'),
) as CompactFoodIndex;

let cached: IndexedFood[] | null = null;
const index = (): IndexedFood[] => (cached ??= loadFoodIndex(raw));

/** The real bundled search + detail, wired the way `localFoodSearch` wires them. */
const deps: ResolutionDeps = {
  search: async (query, pageSize = 20) => searchFoodIndex(index(), query, pageSize),
  detail: async (_source, id) => buildFoodDetail(findFoodById(index(), id)!),
};

async function resolve(utterance: string) {
  const [item] = parseMealUtterance(utterance);
  expect(item).toBeDefined();
  return resolveOneItem(item, deps);
}

describe('meal-text resolution over the shipped index', () => {
  it('answers "1/2 hass avocado" from the parent food, confidently', async () => {
    // The reported bug. `Avocado, Hass, peeled, raw` is the top hit and carries
    // no portion row at all, so a bare count fell to half of 100 g and was
    // flagged `assumed`. `Avocado, raw` carries `1 fruit (150 g)` and could
    // never be a candidate, because "hass" is not in its description and
    // `scoreFood` is an AND — so the fix has to be able to drop a word the
    // database DOES know.
    const r = await resolve('1/2 hass avocado');
    expect(r?.assumed).toBe(false);
    expect(r?.servingLabel).toContain('fruit');
    expect(r?.grams).toBe(75);
  });

  it('spells the same fix the same way for every phrasing of a half', async () => {
    for (const u of ['1/2 hass avocado', '½ hass avocado', '0.5 hass avocado', 'half a hass avocado']) {
      expect((await resolve(u))?.grams).toBe(75);
    }
  });

  it('generalises a variety name it cannot portion', async () => {
    const r = await resolve('1 honeycrisp apple');
    expect(r?.assumed).toBe(false);
  });

  // ── The refusals. Each was a real regression from an unguarded retry. ──

  it('keeps an honest guess rather than swapping greek nonfat for whole milk', async () => {
    const r = await resolve('1 cup greek yogurt');
    expect(r?.assumed).toBe(true);
    expect(r?.calories).toBe(144);
  });

  it('never turns a bell pepper into a hot pepper', async () => {
    expect((await resolve('1 red bell pepper'))?.calories).toBe(27);
  });

  it('never turns a boneless skinless thigh into a fried coated one', async () => {
    expect((await resolve('1 boneless skinless chicken thigh'))?.calories).toBe(149);
  });

  it('never answers two roma tomatoes with 8 kcal', async () => {
    expect((await resolve('2 roma tomatoes'))?.calories).toBe(38);
  });

  it('never drops "without" and serves the potato SKIN as a potato', async () => {
    // `Potatoes, raw, skin` is a strict word-subset of `Potatoes, gold, without
    // skin, raw` — 22 kcal for 38 g. Word-subset alone is not enough; a
    // subtractive qualifier inverts rather than loosens when dropped.
    const r = await resolve('1 yukon gold potato');
    expect(r?.calories).toBe(72);
  });

  it('never relaxes a query that names a restaurant chain', async () => {
    // Standing rule (ADR-0027): a generic latte's macros presented as the
    // answer to a Starbucks question is fabricated health data. `searchFoods`
    // refuses to relax it, and `headAnchoredGeneralisations` refuses again —
    // this is the second entrance to the same hazard.
    expect(await resolve('1 starbucks latte')).toBeNull();
  });

  // ── Guard rail: the already-shipped behaviour this must not disturb. ──

  it('still reads "a cup of rice" as cooked rice', async () => {
    const r = await resolve('1 cup of rice');
    expect(r?.assumed).toBe(false);
    expect(r?.servingLabel.toLowerCase()).toContain('cup');
  });
});
