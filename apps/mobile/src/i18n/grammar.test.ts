import { en } from './en';
import { capitalizeFirst, plural, pluralCategory, pluralKeyFor } from './grammar';
import type { TFn } from './index';
import { LOCALE_DEFS, type Locale } from './registry';

/**
 * The plural engine and sentence-case helper (UX_AUDIT Today review, Copy and
 * bug #3). Both replace something the copy used to fake: "weigh-in(s)" and
 * `textTransform: 'capitalize'`.
 */

/** The real dictionaries, the real interpolation — not a key echo. */
const tFor =
  (locale: Locale): TFn =>
  (key, params) =>
    (LOCALE_DEFS[locale].dict[key] ?? en[key]).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`));

describe('pluralCategory', () => {
  it('follows CLDR per locale, not "n === 1"', () => {
    expect(pluralCategory('en', 1)).toBe('one');
    expect(pluralCategory('en', 0)).toBe('other');
    expect(pluralCategory('en', 2)).toBe('other');
    // Portuguese puts 0 in "one" — the case a hand-rolled `n === 1` gets wrong.
    expect(pluralCategory('pt-BR', 0)).toBe('one');
    expect(pluralCategory('es-PR', 1)).toBe('one');
  });
});

describe('pluralKeyFor', () => {
  it('reads .one and .other', () => {
    expect(pluralKeyFor('today.measureWeighIns', 'en', 1)).toBe('today.measureWeighIns.one');
    expect(pluralKeyFor('today.measureWeighIns', 'en', 3)).toBe('today.measureWeighIns.other');
  });

  it('falls back to .other for a category the table does not carry (es "many")', () => {
    expect(pluralCategory('es-PR', 1_000_000)).not.toBe('one');
    expect(pluralKeyFor('today.measureWeighIns', 'es-PR', 1_000_000)).toBe('today.measureWeighIns.other');
  });
});

describe('plural', () => {
  it('picks the form and fills {n} in every locale', () => {
    expect(plural(tFor('en'), 'en', 'today.measureWeighIns', 1)).toBe(
      '1 more weigh-in and it unlocks — the trend needs two',
    );
    expect(plural(tFor('en'), 'en', 'today.measureWeighIns', 2)).toBe(
      '2 more weigh-ins and it unlocks — the trend needs two',
    );
    expect(plural(tFor('es-PR'), 'es-PR', 'today.measureWeighIns', 1)).toMatch(/^1 pesada más/);
    expect(plural(tFor('es-PR'), 'es-PR', 'today.measureWeighIns', 2)).toMatch(/^2 pesadas más/);
    expect(plural(tFor('pt-BR'), 'pt-BR', 'today.measureWeighIns', 2)).toMatch(/^Mais 2 pesagens /);
    expect(plural(tFor('es-PR'), 'es-PR', 'offline.queuedCount', 3)).toBe(
      '3 registros guardados sin conexión, esperando sincronizar.',
    );
  });

  it('formats {n} with the locale’s grouping', () => {
    expect(plural(tFor('pt-BR'), 'pt-BR', 'offline.queuedCount', 1200)).toMatch(/^1\.200 registros/);
    expect(plural(tFor('en'), 'en', 'offline.queuedCount', 1200)).toMatch(/^1,200 entries/);
  });

  it('carries no parenthesised plural anywhere in the plural keys', () => {
    for (const locale of Object.keys(LOCALE_DEFS) as Locale[]) {
      for (const [key, value] of Object.entries(LOCALE_DEFS[locale].dict)) {
        if (/\.(one|other)$/.test(key)) expect(value).not.toMatch(/\((s|es|ns)\)/);
      }
    }
  });
});

describe('capitalizeFirst', () => {
  it('upper-cases only the first letter — "café da manhã", not "Café Da Manhã"', () => {
    expect(capitalizeFirst('café da manhã', 'pt-BR')).toBe('Café da manhã');
    expect(capitalizeFirst('desayuno', 'es-PR')).toBe('Desayuno');
    expect(capitalizeFirst('ébano', 'es-PR')).toBe('Ébano');
    expect(capitalizeFirst('', 'en')).toBe('');
  });
});
