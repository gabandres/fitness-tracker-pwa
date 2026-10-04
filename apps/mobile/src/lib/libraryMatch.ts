/**
 * Match a search query against the user's OWN foods — My Foods and recent
 * entries — on the device, before the bundled database answers.
 *
 * Search used to hit only the USDA index (`lib/foodSearch.ts`), so a food the
 * user had saved by hand was findable only by scrolling a browse list capped
 * at twelve rows, and fell off it once enough recents piled up. Typing its name
 * found nothing. The user's own foods are the likeliest thing they mean, so
 * they rank FIRST and are tagged with where they came from.
 *
 * Deliberately simple: a few hundred names at most, compared with a
 * case- and accent-insensitive token match. Every query token must appear in
 * the name; ranking only separates "starts with what you typed" from "every
 * word starts a word" from "appears somewhere". Within a tier the caller's
 * order (recency) is kept — the same signal the browse list ranks by.
 */

/** Lowercased, accent-stripped, punctuation folded to single spaces.
 *  "Café com Leite!" and "cafe com leite" normalise identically, which is the
 *  whole point for a pt-BR or es-PR user typing on a keyboard without accents. */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Lower is better; null = no match. */
function score(name: string, query: string, tokens: string[]): number | null {
  if (!tokens.every((tok) => name.includes(tok))) return null;
  if (name.startsWith(query)) return 0;
  const words = name.split(' ');
  if (tokens.every((tok) => words.some((w) => w.startsWith(tok)))) return 1;
  return 2;
}

/**
 * The items whose `name` matches `query`, best first, at most `limit`.
 * Under two characters nothing matches — the same floor the database search
 * uses, so the two lists appear together.
 */
export function matchLibrary<T extends { name: string }>(
  query: string,
  items: readonly T[],
  limit = 5,
): T[] {
  const q = normalizeName(query);
  if (q.length < 2) return [];
  const tokens = q.split(' ');
  const scored: { item: T; s: number; i: number }[] = [];
  items.forEach((item, i) => {
    const s = score(normalizeName(item.name), q, tokens);
    if (s != null) scored.push({ item, s, i });
  });
  scored.sort((a, b) => a.s - b.s || a.i - b.i);
  return scored.slice(0, limit).map((x) => x.item);
}
