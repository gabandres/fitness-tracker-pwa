import { describe, expect, it } from 'vitest';
import { findRepeatCandidates, repeatTokens, type RepeatSource } from './meal-repeat';

/**
 * The tests that matter here are the NEGATIVE ones.
 *
 * A repeat suggestion asserts *you ate this exact thing before*, and it is put
 * in front of the user at the moment they are least likely to check. So the
 * property under test is mostly "does it shut up when it should", and the
 * fixture list below is deliberately full of foods that are similar to each
 * other — a matcher only fails this way when there is something nearby to
 * wrongly match.
 *
 * The failure being guarded against is real and measured: on 2026-08-26
 * `resolvePhrase` was found to resolve 100% of phrases because it drops tokens
 * until something scores, so `unsalted butter` returned a soft pretzel row with
 * full confidence. That matcher has no abstain path. This one does, and these
 * tests are what keep it.
 */

const f = (name: string, brand?: string): RepeatSource => (brand ? { name, brand } : { name });

const LIBRARY: RepeatSource[] = [
  f('Greek yogurt', 'Kirkland'),
  f('Cottage cheese 2%', 'Daisy'),
  f('Whole milk'),
  f('Chicken breast'),
  f('Chicken thigh'),
  f('Unsalted butter'),
  f('Protein bar', 'Quest'),
  f('Plátano maduro'),
  f('Arroz con gandules'),
];

describe('repeatTokens', () => {
  it('drops connectives and meal words, keeping the food', () => {
    expect(repeatTokens('I had some greek yogurt for lunch')).toEqual(['greek', 'yogurt']);
  });

  it('folds accents so a hurried es-PR note still matches', () => {
    // The app ships es-PR. Someone typing fast omits the accent, and `platano`
    // and `plátano` have to be the same word or the feature is useless in
    // Spanish. Stripping marks must not split the word, which is why the
    // diacritic pass runs before punctuation becomes whitespace.
    expect(repeatTokens('plátano')).toEqual(['platano']);
    expect(repeatTokens('platano')).toEqual(['platano']);
  });

  it('keeps % because it distinguishes real foods', () => {
    expect(repeatTokens('cottage cheese 2%')).toContain('2%');
  });

  it('drops bare numbers, which are quantities and not foods', () => {
    expect(repeatTokens('2 eggs')).toEqual(['eggs']);
  });
});

describe('findRepeatCandidates — what it must NOT return', () => {
  it('returns nothing for an empty or foodless note', () => {
    expect(findRepeatCandidates('', LIBRARY)).toEqual([]);
    expect(findRepeatCandidates('   ', LIBRARY)).toEqual([]);
    expect(findRepeatCandidates('lunch today', LIBRARY)).toEqual([]);
  });

  it('returns nothing when the library is empty', () => {
    expect(findRepeatCandidates('greek yogurt', [])).toEqual([]);
  });

  it('returns nothing for a food the user has never stored', () => {
    // The whole point. There IS a nearest row — the old matcher would have
    // shipped it — and the right answer is silence.
    expect(findRepeatCandidates('grilled salmon', LIBRARY)).toEqual([]);
    expect(findRepeatCandidates('mofongo', LIBRARY)).toEqual([]);
  });

  it('does not match on a short shared token alone', () => {
    // "2%" is shared by nothing else here, but the principle is the anchor
    // rule: a match carried only by tokens under 4 characters is not a match
    // about the food. Same class as `apple` matching `SNAPPLE`.
    expect(findRepeatCandidates('2%', LIBRARY)).toEqual([]);
    expect(findRepeatCandidates('bar', LIBRARY)).toEqual([]);
  });

  it('does not confuse two foods that share their head noun', () => {
    // The test that forced the containment gate. `chicken breast` vs a stored
    // `Chicken thigh` scores exactly 0.5 and anchors on `chicken`, so a
    // symmetric score plus an anchor rule offered the thigh as a second
    // suggestion. The note says breast and the food says thigh — they
    // contradict, and neither name is a subset of the other.
    const hits = findRepeatCandidates('chicken breast', LIBRARY);
    expect(hits.map((h) => h.food.name)).toEqual(['Chicken breast']);
  });

  it('offers both cuts when the note names neither', () => {
    // The other side of the same rule: a bare `chicken` is CONTAINED in both,
    // contradicts neither, and the honest answer is to offer both rather than
    // to pick one. Bounded to three, and the user chooses.
    const names = findRepeatCandidates('chicken', LIBRARY).map((h) => h.food.name);
    expect(names).toContain('Chicken breast');
    expect(names).toContain('Chicken thigh');
  });

  it('does not let a one-word note match a long stored name', () => {
    // "arroz" alone against "Arroz con gandules": Dice over {arroz} and
    // {arroz, gandules} is 2/3 — above the floor — so this documents where the
    // line actually sits rather than pretending it is stricter than it is.
    // A caller showing this as a SUGGESTION on an editable draft is fine; a
    // caller applying it silently is not, which is why nothing here applies.
    const hits = findRepeatCandidates('arroz', LIBRARY);
    expect(hits.map((h) => h.food.name)).toEqual(['Arroz con gandules']);
  });

  it('never returns more than three, however generic the note', () => {
    expect(findRepeatCandidates('chicken', LIBRARY).length).toBeLessThanOrEqual(3);
  });
});

describe('findRepeatCandidates — what it should return', () => {
  it('matches the food the note names', () => {
    const hits = findRepeatCandidates('greek yogurt', LIBRARY);
    expect(hits[0].food.name).toBe('Greek yogurt');
    expect(hits[0].score).toBeGreaterThanOrEqual(0.5);
  });

  it('reports a brand the user typed, and ranks it first', () => {
    const hits = findRepeatCandidates('Kirkland greek yogurt', LIBRARY);
    expect(hits[0].food.name).toBe('Greek yogurt');
    expect(hits[0].brandMatched).toBe(true);
  });

  it('does not claim a brand match when the note omitted the brand', () => {
    // brandMatched is shown to the user as "your Kirkland one". Saying that
    // about a note that never mentioned Kirkland invents agreement.
    expect(findRepeatCandidates('greek yogurt', LIBRARY)[0].brandMatched).toBe(false);
  });

  it('matches through the meal words a person actually types', () => {
    const hits = findRepeatCandidates('for lunch I had the unsalted butter', LIBRARY);
    expect(hits[0].food.name).toBe('Unsalted butter');
  });
});

describe('findRepeatCandidates — quantity', () => {
  it('reads a stated quantity and unit', () => {
    const hits = findRepeatCandidates('1/2 cup of greek yogurt', LIBRARY);
    expect(hits[0].food.name).toBe('Greek yogurt');
    expect(hits[0].quantity).toBe(0.5);
    expect(hits[0].unit).toBe('cup');
  });

  it('reports NULL, not 1, when the note stated no amount', () => {
    // The load-bearing one. `parseMealUtterance` defaults quantity to 1, which
    // is right for its own caller and a silent re-portioning here: "greek
    // yogurt" asserts nothing about how much, and passing 1 on would make every
    // unquantified repeat claim exactly one serving.
    const hits = findRepeatCandidates('greek yogurt', LIBRARY);
    expect(hits[0].quantity).toBeNull();
    expect(hits[0].unit).toBeNull();
  });

  it('does not apply one food’s quantity to another food in the same note', () => {
    const hits = findRepeatCandidates('2 chicken breast and greek yogurt', LIBRARY);
    const yogurt = hits.find((h) => h.food.name === 'Greek yogurt');
    expect(yogurt?.quantity).toBeNull();
  });
});
