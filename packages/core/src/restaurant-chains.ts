/**
 * Chain-name detection for restaurant food search (ADR-0027).
 *
 * ## Why this exists as a separate, tiny thing
 *
 * The restaurant corpus is 25,216 items / 4.3 MB and lives on the server, in
 * `functions/data/restaurant-foods.json`. The mobile app answers text search
 * **on device** and never calls `searchFoods` for it (Tier D — see
 * `apps/mobile/src/lib/localFoodSearch.ts`), so putting MenuStat behind the
 * callable alone would have reached the frozen web app and nobody else.
 *
 * The obvious fix — bundle the corpus too — costs the wrong thing. The
 * compacted USDA index is already 1.4 MB of the JS bundle (+2.0 MB of Hermes
 * bytecode, measured), and MenuStat would roughly triple that, undoing most of
 * the −24.2% bundle cut shipped on 2026-08-22.
 *
 * So the phone bundles **91 chain names** instead — {@link RESTAURANT_CHAINS},
 * about 2 KB — and uses them to route: a query that names a chain goes to the
 * server, which has the whole corpus; every other query stays local and offline
 * as before. That is the right trade because the two cases have different
 * requirements. Generic food search is the common path, is typed constantly,
 * and must work with the radio off. Naming a restaurant is deliberate, rare,
 * and already implies the user wants something this device does not have.
 *
 * ## Contract with the server
 *
 * {@link matchRestaurantChain} must agree with `matchChain` in
 * `functions/src/menustat-db.ts` about what counts as naming a chain. They are
 * hand-mirrored — `functions/` is not a workspace and cannot import this
 * package — and `restaurant-chains.test.ts` pins the shared cases. If they
 * disagree the failure is silent and one-directional: the phone declines to ask
 * the server for a query the server would have answered.
 */
import { RESTAURANT_CHAINS, RESTAURANT_SNAPSHOT_YEAR } from './restaurant-chains.data';
import { words } from './usda-search';

export { RESTAURANT_CHAINS, RESTAURANT_SNAPSHOT_YEAR };

/**
 * A chain name in one matchable form. `tight` is the words run together, so
 * "Chick Fil A" and a user's "chickfila" meet in the middle — apostrophes and
 * hyphens are exactly what people leave out when typing a brand, and MenuStat's
 * own spellings are inconsistent about them ("Domino's" in 2022, "Dominos" in
 * 2018). `words` carries the same tokens for the word-wise test.
 */
interface ChainEntry {
  name: string;
  tight: string;
  words: string[];
}

/**
 * Every form of a chain name worth matching, longest first.
 *
 * Two forms per chain, because dropping a leading article is necessary but not
 * sufficient. "The Cheesecake Factory" is typed "cheesecake factory" essentially
 * always, so the stripped form has to exist — but "Jack in the Box" carries a
 * MEDIAL "the" that people do type, so the full form has to survive too.
 * Generating both and testing both is cheaper than a rule that tries to tell
 * the two positions apart, and it cannot get the distinction wrong.
 *
 * Mirrors `chainForms` in `functions/src/menustat-db.ts`.
 */
const ENTRIES: ChainEntry[] = RESTAURANT_CHAINS.flatMap((name) => {
  const all = words(name);
  const stripped = all[0] === 'the' ? all.slice(1) : all;
  const forms: ChainEntry[] = [{ name, tight: all.join(''), words: all }];
  if (stripped !== all && stripped.length) {
    forms.push({ name, tight: stripped.join(''), words: stripped });
  }
  return forms;
}).sort((a, b) => b.words.length - a.words.length);

/**
 * The chain a query names, or `null`.
 *
 * `rest` is what is left of the query once the chain name is consumed, so a
 * caller can tell "olive garden" (browse the chain) from "olive garden
 * breadstick" (find one item).
 *
 * The minimum tight length of 4 keeps a short chain name from matching inside
 * an unrelated word — without it "ihop" is fine but a hypothetical two-letter
 * chain would match almost everything.
 */
export function matchRestaurantChain(query: string): { chain: string; rest: string[] } | null {
  const queryWords = words(query);
  if (!queryWords.length) return null;

  const tightQuery = queryWords.join('');
  for (const c of ENTRIES) {
    if (c.tight.length >= 4 && tightQuery.includes(c.tight)) {
      return { chain: c.name, rest: queryWords.filter((w) => !c.tight.includes(w)) };
    }
  }
  for (const c of ENTRIES) {
    if (c.words.length && c.words.every((w) => queryWords.includes(w))) {
      return { chain: c.name, rest: queryWords.filter((w) => !c.words.includes(w)) };
    }
  }
  return null;
}

/** True when the query names one of the bundled chains — the mobile client's
 *  cue to ask the server rather than answer from the on-device index. */
export function queryNamesRestaurantChain(query: string): boolean {
  return matchRestaurantChain(query) !== null;
}
