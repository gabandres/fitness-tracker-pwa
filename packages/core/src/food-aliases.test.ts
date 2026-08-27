import { describe, expect, it } from 'vitest';
import { foldDiacritics, translateFoodTerm } from './food-aliases';

describe('foldDiacritics', () => {
  it('strips accents so one key serves every spelling people type', () => {
    expect(foldDiacritics('maní')).toBe('mani');
    expect(foldDiacritics('pão')).toBe('pao');
    expect(foldDiacritics('feijão')).toBe('feijao');
    expect(foldDiacritics('xícara')).toBe('xicara');
  });
});

describe('translateFoodTerm', () => {
  it('rewrites Spanish staples', () => {
    expect(translateFoodTerm('mantequilla de maní')).toBe('peanut butter');
    expect(translateFoodTerm('pechuga de pollo')).toBe('chicken breast');
    expect(translateFoodTerm('frijoles negros')).toBe('black beans');
  });

  it('rewrites Portuguese staples', () => {
    expect(translateFoodTerm('pasta de amendoim')).toBe('peanut butter');
    expect(translateFoodTerm('peito de frango')).toBe('chicken breast');
    expect(translateFoodTerm('feijão preto')).toBe('black beans');
    expect(translateFoodTerm('pão integral')).toBe('whole wheat bread');
  });

  it('works without accents, because people type both', () => {
    expect(translateFoodTerm('mantequilla de mani')).toBe('peanut butter');
    expect(translateFoodTerm('feijao preto')).toBe('black beans');
  });

  it('prefers the longest phrase over its own first word', () => {
    // "mantequilla" alone is butter; the phrase is peanut butter.
    expect(translateFoodTerm('mantequilla')).toBe('butter');
    expect(translateFoodTerm('mantequilla de maní')).toBe('peanut butter');
  });

  it('leaves English untouched, byte for byte', () => {
    for (const q of ['peanut butter', 'chicken breast', 'white rice', 'honey']) {
      expect(translateFoodTerm(q)).toBe(q);
    }
  });

  it('leaves an unknown term untouched rather than mangling it', () => {
    expect(translateFoodTerm('zzz qqq')).toBe('zzz qqq');
  });

  it('does not rewrite a word buried inside another', () => {
    // "col" is cabbage; "coliflor" must not become "cabbageiflor".
    expect(translateFoodTerm('coliflor')).toBe('coliflor');
  });
});
