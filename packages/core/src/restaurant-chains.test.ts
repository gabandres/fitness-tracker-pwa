import { describe, expect, it } from 'vitest';
import {
  RESTAURANT_CHAINS,
  RESTAURANT_SNAPSHOT_YEAR,
  matchRestaurantChain,
  queryNamesRestaurantChain,
} from './restaurant-chains';

/**
 * These cases are the CONTRACT with `matchChain` in
 * `functions/src/menustat-db.ts`. The two are hand-mirrored because `functions/`
 * is not a workspace and cannot import this package, and the same cases are
 * asserted there in `functions/test/menustat-db.spec.ts`.
 *
 * The failure this guards is silent and one-directional: if the phone's matcher
 * is stricter than the server's, a user types a chain name, the client decides
 * it is an ordinary food query, answers from the local index and never asks the
 * server — so the restaurant corpus is simply invisible, with no error anywhere.
 */
describe('the generated chain list', () => {
  it('is the 2022 snapshot and holds every chain in it', () => {
    expect(RESTAURANT_SNAPSHOT_YEAR).toBe(2022);
    expect(RESTAURANT_CHAINS.length).toBe(91);
  });

  it('stays small enough to justify bundling — this is why the corpus does not ship', () => {
    // ~2 KB. If this ever grows into the tens of KB, revisit the routing
    // decision in `restaurant-chains.ts` rather than raising the number.
    const bytes = JSON.stringify(RESTAURANT_CHAINS).length;
    expect(bytes).toBeLessThan(8000);
  });

  it('holds every chain the owner named (issue #67, measurement 3)', () => {
    const wanted = [
      'Panda Express', "Wendy's", "Church's Chicken", "Denny's", 'IHOP',
      'The Cheesecake Factory', 'Wingstop', 'Chipotle', 'Qdoba', 'Taco Bell',
      'Starbucks', 'Panera Bread', 'Olive Garden', "Chili's", 'Chick Fil A',
    ];
    const present = new Set(RESTAURANT_CHAINS);
    expect(wanted.filter((c) => !present.has(c))).toEqual([]);
  });
});

describe('matchRestaurantChain', () => {
  it('matches a chain named in full', () => {
    expect(matchRestaurantChain('taco bell')?.chain).toBe('Taco Bell');
  });

  it('matches the punctuation-free spellings people actually type', () => {
    expect(matchRestaurantChain('chickfila')?.chain).toBe('Chick Fil A');
    expect(matchRestaurantChain('mcdonalds')?.chain).toBe("McDonald's");
    expect(matchRestaurantChain('wendys')?.chain).toBe("Wendy's");
    expect(matchRestaurantChain('chilis')?.chain).toBe("Chili's");
  });

  it('matches a chain whose leading article was dropped', () => {
    expect(matchRestaurantChain('cheesecake factory')?.chain).toBe('The Cheesecake Factory');
    expect(matchRestaurantChain('the cheesecake factory')?.chain).toBe('The Cheesecake Factory');
  });

  it('keeps a medial "the" — it is not an article to strip', () => {
    expect(matchRestaurantChain('jack in the box')?.chain).toBe('Jack in the Box');
    expect(matchRestaurantChain('jackinthebox')?.chain).toBe('Jack in the Box');
  });

  it('returns the leftover words, so browse and find are distinguishable', () => {
    expect(matchRestaurantChain('taco bell burrito')?.rest).toEqual(['burrito']);
    expect(matchRestaurantChain('taco bell')?.rest).toEqual([]);
  });

  it('returns null for an ordinary food query', () => {
    // The guard that keeps a plain search on-device and offline. Every one of
    // these must stay local — a false positive here costs a network round trip
    // on the app's most-used path.
    for (const q of ['banana', 'chicken breast', 'greek yogurt', 'olive oil', 'rice', 'egg', 'oatmeal']) {
      expect(matchRestaurantChain(q), q).toBeNull();
    }
  });

  it('returns null for an empty or whitespace query', () => {
    expect(matchRestaurantChain('')).toBeNull();
    expect(matchRestaurantChain('   ')).toBeNull();
  });
});

describe('queryNamesRestaurantChain', () => {
  it('is the boolean the mobile client routes on', () => {
    expect(queryNamesRestaurantChain('olive garden breadstick')).toBe(true);
    expect(queryNamesRestaurantChain('breadstick')).toBe(false);
  });
});
