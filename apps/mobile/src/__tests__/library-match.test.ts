import { matchLibrary, normalizeName } from '@/lib/libraryMatch';

/**
 * Search finds the user's OWN foods, not just the bundled database.
 *
 * Typing the name of a saved My Foods entry used to return nothing, because
 * search only asked the USDA index. These pin the matcher the sheet ranks
 * those foods with: accent- and case-blind, every typed word must appear, and
 * "starts with what you typed" beats "contains it" without reordering ties.
 */
const items = [
  { name: 'Protein shake' },
  { name: 'Café com leite' },
  { name: 'Shake de proteína' },
  { name: 'Chicken & rice bowl' },
];

it('folds accents, case and punctuation', () => {
  expect(normalizeName('Café COM Leite!')).toBe('cafe com leite');
  expect(matchLibrary('cafe', items).map((i) => i.name)).toEqual(['Café com leite']);
});

it('requires every typed word, in any order', () => {
  expect(matchLibrary('rice chicken', items).map((i) => i.name)).toEqual(['Chicken & rice bowl']);
  expect(matchLibrary('chicken salmon', items)).toEqual([]);
});

it('ranks a prefix match above a mid-name match, keeping input order within a tier', () => {
  expect(matchLibrary('shake', items).map((i) => i.name)).toEqual([
    'Shake de proteína',
    'Protein shake',
  ]);
  expect(matchLibrary('prote', items).map((i) => i.name)).toEqual([
    'Protein shake',
    'Shake de proteína',
  ]);
});

it('stays silent under two characters, like the database search', () => {
  expect(matchLibrary('s', items)).toEqual([]);
});
