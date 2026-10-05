// `date-format` → `@/i18n` → auth → firebase's ESM build; mock auth out like
// every component test.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

import {
  formatDecimal,
  kcalOutOfRange,
  macroOutOfRange,
  parseDecimal,
  parseQuickAddQuery,
  sentenceCase,
} from '@/lib/entry-input';

/**
 * The add-meal form's number handling (S20, B5/B1/U4/B4).
 *
 * `numOrUndef` replaced the FIRST comma with a point, so an English `1,250`
 * saved 1.25 kcal; and prefills wrote `String(n)`, so a pt-BR form showed
 * `12.5` beside a `1,5×` chip. These pin the locale-aware reading both ways.
 */

describe('parseDecimal', () => {
  it('reads an English thousands separator as grouping, not a decimal point', () => {
    expect(parseDecimal('1,250', 'en')).toBe(1250);
    expect(parseDecimal('12,500', 'en')).toBe(12500);
    expect(parseDecimal('1,250.5', 'en')).toBe(1250.5);
  });

  it('still reads a comma decimal typed in English when it cannot be grouping', () => {
    expect(parseDecimal('1,5', 'en')).toBe(1.5);
    expect(parseDecimal('250,5', 'en')).toBe(250.5);
  });

  it('reads a pt-BR comma as the decimal point, and a dot group as grouping', () => {
    expect(parseDecimal('1,5', 'pt-BR')).toBe(1.5);
    expect(parseDecimal('12,25', 'pt-BR')).toBe(12.25);
    expect(parseDecimal('1.500', 'pt-BR')).toBe(1500);
    expect(parseDecimal('1.250,5', 'pt-BR')).toBe(1250.5);
    // A dot that cannot be grouping is a decimal — an English keyboard in Brazil.
    expect(parseDecimal('12.5', 'pt-BR')).toBe(12.5);
  });

  it('follows es-PR, which writes numbers the US way', () => {
    expect(parseDecimal('1,250', 'es-PR')).toBe(1250);
    expect(parseDecimal('1,5', 'es-PR')).toBe(1.5);
    expect(parseDecimal('1.5', 'es-PR')).toBe(1.5);
  });

  it('binds partial input and refuses what is not a non-negative number', () => {
    expect(parseDecimal('12.', 'en')).toBe(12);
    expect(parseDecimal(',5', 'pt-BR')).toBe(0.5);
    expect(parseDecimal('  300 ', 'en')).toBe(300);
    expect(parseDecimal('', 'en')).toBeUndefined();
    expect(parseDecimal('.', 'en')).toBeUndefined();
    expect(parseDecimal('-5', 'en')).toBeUndefined();
    expect(parseDecimal('1,2,3', 'en')).toBeUndefined();
    expect(parseDecimal('12a', 'en')).toBeUndefined();
  });
});

describe('formatDecimal', () => {
  it('writes a prefill with the locale’s decimal mark and no grouping', () => {
    expect(formatDecimal(12.5, 'pt-BR')).toBe('12,5');
    expect(formatDecimal(12.5, 'en')).toBe('12.5');
    expect(formatDecimal(12.5, 'es-PR')).toBe('12.5');
    expect(formatDecimal(1250, 'pt-BR')).toBe('1250');
  });

  it('round-trips through parseDecimal in every locale', () => {
    for (const locale of ['en', 'es-PR', 'pt-BR'] as const) {
      for (const n of [0, 0.5, 12.5, 105, 1250, 19999]) {
        expect(parseDecimal(formatDecimal(n, locale), locale)).toBe(n);
      }
    }
  });
});

describe('the rules’ ceilings (isValidLog)', () => {
  it('refuses 20000 kcal and 1000 g, allows one under', () => {
    expect(kcalOutOfRange(19999)).toBe(false);
    expect(kcalOutOfRange(20000)).toBe(true);
    expect(macroOutOfRange(999)).toBe(false);
    expect(macroOutOfRange(1000)).toBe(true);
    expect(kcalOutOfRange(undefined)).toBe(false);
  });
});

describe('sentenceCase', () => {
  it('capitalises the first word only (textTransform capitalised every one)', () => {
    expect(sentenceCase('café da manhã', 'pt-BR')).toBe('Café da manhã');
    expect(sentenceCase('desayuno', 'es-PR')).toBe('Desayuno');
    expect(sentenceCase('', 'en')).toBe('');
  });
});

describe('parseQuickAddQuery', () => {
  it('reads a bare calorie count, with or without a unit', () => {
    expect(parseQuickAddQuery('350', 'en')).toEqual({ calories: 350 });
    expect(parseQuickAddQuery(' 350 kcal ', 'en')).toEqual({ calories: 350 });
    expect(parseQuickAddQuery('350kcal', 'en')).toEqual({ calories: 350 });
  });

  it('reads macros by initial', () => {
    expect(parseQuickAddQuery('350 40p', 'en')).toEqual({ calories: 350, protein: 40 });
    expect(parseQuickAddQuery('350 40p 30c 12f', 'en')).toEqual({ calories: 350, protein: 40, carbs: 30, fat: 12 });
    expect(parseQuickAddQuery('350 40P', 'en')).toEqual({ calories: 350, protein: 40 });
  });

  it('takes g as fat in Spanish and Portuguese (grasa, gordura), never in English', () => {
    expect(parseQuickAddQuery('350 12g', 'es-PR')).toEqual({ calories: 350, fat: 12 });
    expect(parseQuickAddQuery('350 12,5g', 'pt-BR')).toEqual({ calories: 350, fat: 12.5 });
    expect(parseQuickAddQuery('350 12g', 'en')).toBeNull();
  });

  it('reads the number the way the locale writes it', () => {
    expect(parseQuickAddQuery('1,250', 'en')).toEqual({ calories: 1250 });
    expect(parseQuickAddQuery('1.250', 'pt-BR')).toEqual({ calories: 1250 });
  });

  it('is not a quick add when anything else is in the query', () => {
    expect(parseQuickAddQuery('chicken 350', 'en')).toBeNull();
    expect(parseQuickAddQuery('350 chicken', 'en')).toBeNull();
    expect(parseQuickAddQuery('350 40p 50p', 'en')).toBeNull();
    expect(parseQuickAddQuery('', 'en')).toBeNull();
  });

  it('is not a quick add past the rules’ ceilings, or at zero', () => {
    expect(parseQuickAddQuery('0', 'en')).toBeNull();
    expect(parseQuickAddQuery('20000', 'en')).toBeNull();
    expect(parseQuickAddQuery('350 1000p', 'en')).toBeNull();
  });
});
