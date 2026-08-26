/**
 * Repeat detection — "you have logged this before" (ADR-0029 item 3).
 *
 * The user types a note about the meal they are photographing. Before any
 * model call, that note is matched against their own **My Foods** library
 * ([ADR-0013](../../../docs/adr/0013-food-resolution-my-foods-library.md)). A
 * hit means the app already holds macros this person entered, checked and kept
 * — better evidence than anything a vision model will produce for the same
 * plate, and it costs **$0 and zero model calls**.
 *
 * Pure, no I/O, shared by both frontends like the rest of `@macrolog/core`.
 *
 * ## The one design rule, and it is the whole file
 *
 * **This matcher abstains.** It returns `[]` far more readily than it returns a
 * bad guess, and every threshold below is set for precision over recall.
 *
 * That is not a general preference — it is the direct lesson from measuring
 * this app's other phrase matcher on 2026-08-26. `resolvePhrase` was found to
 * resolve **100% of phrases**, branded and generic alike, because its relaxed
 * pass drops tokens until something scores and in a 13,272-row index something
 * always scores. It never says "I do not know". The result is not a miss, which
 * a user can see; it is a confident wrong match, which nobody downstream can
 * detect — `unsalted butter` came back as a soft pretzel row.
 *
 * A repeat suggestion is a stronger claim than a search result: it says *you
 * ate this exact thing before*, and it is offered at the moment the user is
 * least likely to scrutinise it. So the failure this module must not have is
 * the failure the other one had.
 *
 * Two consequences, both deliberate:
 *
 * - **A near-miss returns nothing.** A user whose real repeat is not surfaced
 *   takes the photo, which is the flow they were already in. A user shown the
 *   wrong prior food may log someone else's macros for today.
 * - **A suggestion never applies itself.** Callers land the user on an editable
 *   draft — ADR-0013's trust rule, restated in ADR-0029's own open question.
 *   Nothing here writes anything.
 */

import type { CustomFood } from './types';
import { parseMealUtterance } from './meal-utterance';

/** One prior food the note plausibly names, with why it matched. */
export interface RepeatCandidate<T extends RepeatSource = CustomFood> {
  /** The user's own stored food. */
  food: T;
  /**
   * 0–1 Dice overlap between the note's food words and the food's own words.
   * Exposed so a caller can render "how sure" without re-deriving it, and so a
   * test can pin the ranking rather than only the winner.
   */
  score: number;
  /** True when the note also named this food's brand. Ranks above a same-score
   *  match that did not, and is worth showing: "Kirkland" is the user's word. */
  brandMatched: boolean;
  /**
   * Quantity the note stated for this food, if it stated one — `2` from "2
   * eggs", `0.5` from "half a cup". `null` when unstated, which is NOT the
   * same as 1: an unstated quantity means the caller should keep the food's
   * own serving, not silently assert a single serving.
   */
  quantity: number | null;
  /** Canonical unit from the note ('cup', 'g', …), or null for a bare count. */
  unit: string | null;
}

/** The minimum a food must carry to be matchable here. `CustomFood` satisfies
 *  it; so does anything else with a name, which keeps this testable without
 *  building whole `CustomFood` fixtures. */
export interface RepeatSource {
  name: string;
  brand?: string;
}

/**
 * Words that say nothing about WHICH food this is. Kept deliberately short —
 * this is not `photo-resolve`'s FILLER list and must not grow into a food
 * taxonomy. Anything longer starts encoding opinions about food rather than
 * about English, and a token dropped here is a token that cannot disqualify a
 * wrong match.
 */
const NOISE = new Set([
  'a', 'an', 'and', 'the', 'of', 'with', 'w', 'plus', 'some', 'my', 'this',
  'that', 'for', 'from', 'in', 'on', 'to', 'is', 'it', 'i', 'ate', 'had',
  'having', 'eating', 'today', 'lunch', 'dinner', 'breakfast', 'snack', 'meal',
  // Spanish, because the app ships es-PR and a note is typed in the user's
  // own language. Same rule: connectives and meal words only, never foods.
  'un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'con', 'y', 'mi',
  'almuerzo', 'cena', 'desayuno', 'merienda', 'comida',
]);

/**
 * Minimum Dice overlap for a candidate to be offered at all.
 *
 * 0.5 means the note and the stored name agree on at least half their
 * significant words, counted symmetrically. It is the second of two gates —
 * see {@link contains} for the first — and its specific job is to stop one
 * generic word from reaching a long specific name: `rice` inside `Arroz con
 * gandules con pollo y tostones` is fully contained and still scores 0.33.
 */
const MIN_SCORE = 0.5;

/**
 * A match must share at least one word of this length.
 *
 * Without it, `2%` and `oz` and `bar` carry matches on their own: "cottage
 * cheese 2%" and "greek yogurt 2%" share a token, and a Dice score over two
 * short lists can clear 0.5 on it. The substantive word is what identifies a
 * food, and this is the same class of bug as `apple` matching `SNAPPLE` —
 * a token that is present but not *about* the food.
 */
const MIN_ANCHOR_LEN = 4;

/** How many suggestions a caller should ever be handed. More than a couple is
 *  a search result list, and a search result list is not a repeat suggestion. */
const MAX_CANDIDATES = 3;

/** Lowercase, strip accents and punctuation, split, drop noise and bare
 *  numbers. Accents matter: `plátano` and `platano` are the same word to a
 *  person typing in a hurry, and es-PR is a shipped locale. */
export function repeatTokens(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9%\s]+/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0 && !NOISE.has(w) && !/^\d+$/.test(w));
}

/** Dice coefficient over two token SETS: `2|A∩B| / (|A|+|B|)`.
 *
 *  Sets, not lists, so a note repeating a word cannot inflate its own score.
 *  Dice rather than plain containment because containment is asymmetric and
 *  would let a one-word note match every food that happens to contain it. */
function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/** The tokens shared by both sets, for the anchor check below. */
function sharedTokens(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) if (b.has(t)) out.push(t);
  return out;
}

/**
 * **One name must be wholly inside the other**, after noise removal. This is
 * the gate that does the real work, and it was added because a symmetric score
 * alone was not enough.
 *
 * `chicken breast` against a stored `Chicken thigh` scores exactly 0.5 — it
 * clears a 0.5 floor, it clears the anchor rule on `chicken`, and it is *wrong*
 * in the specific way this module exists to prevent. The note says `breast`,
 * which the stored food contradicts with `thigh`; neither side is a subset of
 * the other. Containment expresses that directly and without a food taxonomy:
 *
 *   note ⊆ food   `arroz`               ⊆ `arroz con gandules`   — the user was brief
 *   food ⊆ note   `greek yogurt`        ⊆ `kirkland greek yogurt` — the user added detail
 *   neither       `chicken breast`      vs `chicken thigh`        — they disagree
 *
 * Being brief and adding detail are both things a person does about a food they
 * mean. Naming a different cut is not.
 */
function contains(a: Set<string>, b: Set<string>): boolean {
  const shared = sharedTokens(a, b).length;
  return shared === a.size || shared === b.size;
}

/**
 * Find prior foods the note plausibly names.
 *
 * Returns **at most {@link MAX_CANDIDATES}**, best first, or `[]` — which is
 * the common and correct answer. See the abstain rule at the top of this file
 * before loosening any threshold: the version of this that returns something
 * for every note is strictly worse than the version that usually returns
 * nothing.
 *
 * `quantity`/`unit` come from {@link parseMealUtterance}, the same deterministic
 * parser the text-log path already uses. It reads "1/2 cup" for $0 and beats
 * the model at that specific job, which is exactly why ADR-0029 wanted the note
 * run through it as well as sent to the model.
 */
export function findRepeatCandidates<T extends RepeatSource>(
  note: string,
  foods: readonly T[],
): RepeatCandidate<T>[] {
  const noteTokens = repeatTokens(note);
  if (!noteTokens.length || !foods.length) return [];
  const noteSet = new Set(noteTokens);

  // The note may name several foods ("greek yogurt and a banana"). Parse it
  // once; each candidate then takes the quantity from whichever parsed segment
  // its own name overlaps, so "2 eggs and toast" gives the eggs a 2 and leaves
  // the toast alone rather than applying 2 to both.
  const parsed = parseMealUtterance(note);

  const scored: RepeatCandidate<T>[] = [];
  for (const food of foods) {
    const nameSet = new Set(repeatTokens(food.name));
    if (!nameSet.size) continue;

    // Gate 1: the two names must not CONTRADICT each other. See `contains`.
    if (!contains(noteSet, nameSet)) continue;

    // Gate 2: and they must be substantially the same length, so one generic
    // word cannot reach a long specific name it happens to sit inside.
    const score = dice(noteSet, nameSet);
    if (score < MIN_SCORE) continue;

    // At least one substantive shared word. A match carried entirely by short
    // tokens ("2%", "bar", "oz") is not a match about the food.
    const anchored = sharedTokens(noteSet, nameSet).some((t) => t.length >= MIN_ANCHOR_LEN);
    if (!anchored) continue;

    const brandTokens = food.brand ? repeatTokens(food.brand) : [];
    const brandMatched = brandTokens.length > 0 && brandTokens.every((t) => noteSet.has(t));

    const { quantity, unit } = quantityFor(parsed, nameSet);
    scored.push({ food, score, brandMatched, quantity, unit });
  }

  // Brand agreement outranks a marginally better word overlap: the brand is a
  // word the user chose to type, and typing "Kirkland" is a much stronger
  // signal of "the one I have logged before" than one extra generic token.
  scored.sort((a, b) =>
    Number(b.brandMatched) - Number(a.brandMatched) ||
    b.score - a.score ||
    a.food.name.localeCompare(b.food.name));

  return scored.slice(0, MAX_CANDIDATES);
}

/**
 * Which parsed quantity belongs to this food, if any.
 *
 * Returns nulls rather than defaulting to 1 on purpose. "Greek yogurt" with no
 * number does not assert one serving — it asserts nothing about amount, and the
 * caller should keep the stored serving. Defaulting to 1 here would look
 * harmless and would silently re-portion every repeat that did not state a
 * number.
 */
function quantityFor(
  parsed: ReturnType<typeof parseMealUtterance>,
  nameSet: Set<string>,
): { quantity: number | null; unit: string | null } {
  for (const item of parsed) {
    const itemSet = new Set(repeatTokens(item.food));
    if (!itemSet.size) continue;
    // Only claim the quantity when this parsed segment is actually about this
    // food. Reusing the same Dice floor keeps one notion of "same food" in the
    // module rather than two that can drift apart.
    if (dice(itemSet, nameSet) < MIN_SCORE) continue;

    // `parseMealUtterance` DEFAULTS quantity to 1 when the text stated none,
    // which is right for its own caller and wrong here: passing that 1 on would
    // make every unquantified repeat silently assert "one serving". The two
    // cases are only distinguishable by looking at what was written.
    //
    //   "half a cup of rice" → unit 'cup'  → 0.5 is real
    //   "2 eggs"             → unit null, quantity 2 → real, it is not the default
    //   "greek yogurt"       → unit null, quantity 1 → the DEFAULT, not a claim
    if (item.unit == null && item.quantity === 1 && !statesAnAmount(item.raw)) {
      return { quantity: null, unit: null };
    }
    return { quantity: item.quantity, unit: item.unit };
  }
  return { quantity: null, unit: null };
}

/** Whether this slice of the note actually wrote an amount down — a digit, a
 *  fraction, or one of the number words the parser understands. Conservative
 *  by design: an amount we fail to see is left to the stored serving, which is
 *  the safe direction. */
function statesAnAmount(raw: string): boolean {
  const t = String(raw ?? '').toLowerCase();
  if (/[0-9¼-¾⅐-⅞]/.test(t)) return true;
  return /(one|a|an|half|quarter|couple|uno|una|medio|media|un)/.test(t);
}
