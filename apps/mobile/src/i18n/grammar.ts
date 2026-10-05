import type { I18nKey } from './en';
import type { TFn, TParams } from './index';
import { LOCALE_DEFS, type Locale } from './registry';

/**
 * Grammar the string table cannot express on its own: plural forms and
 * sentence-case. Both used to be faked in the copy itself.
 *
 * ## Plurals
 *
 * "{n} more weigh-in(s)", "{n} pesada(s)", "{n} guardado(s)" — the
 * parenthesised plural is what a string table without plural support forces,
 * and it reads as a form to fill in. `Intl.PluralRules` knows each locale's
 * categories (`one`/`other` for all three we ship; Portuguese and Spanish
 * also have `many` for large round numbers in newer CLDR), so a plural
 * string is written as one key per category:
 *
 * ```ts
 * 'today.measureWeighIns.one': '{n} more weigh-in …',
 * 'today.measureWeighIns.other': '{n} more weigh-ins …',
 * ```
 *
 * and called as `plural(t, locale, 'today.measureWeighIns', n)`. A category
 * the table does not carry (`many`, `few`) falls back to `.other`, which is
 * what every CLDR locale guarantees to exist. The `n` param is filled in
 * already formatted for the locale, unless the caller passes its own.
 *
 * Flat keys, same as the rest of the mobile table — the suffix is just part
 * of the key, so `i18n-parity.test.ts` checks plural forms like any string.
 */

/** Every base `B` for which the table carries both `B.one` and `B.other`. */
export type PluralKey = {
  [K in I18nKey]: K extends `${infer B}.other` ? (`${B}.one` extends I18nKey ? B : never) : never;
}[I18nKey];

const rulesCache = new Map<string, Intl.PluralRules>();

function rulesFor(locale: Locale): Intl.PluralRules | null {
  const tag = LOCALE_DEFS[locale].intlTag;
  let rules = rulesCache.get(tag);
  if (!rules) {
    try {
      rules = new Intl.PluralRules(tag);
    } catch {
      return null;
    }
    rulesCache.set(tag, rules);
  }
  return rules;
}

/** The plural category `n` takes in `locale` — `one` or `other` for the
 *  locales we ship; `other` when the runtime has no `Intl.PluralRules`. */
export function pluralCategory(locale: Locale, n: number): Intl.LDMLPluralRule {
  return rulesFor(locale)?.select(n) ?? (n === 1 ? 'one' : 'other');
}

/** The key `plural()` will read for `n` — exported for the tests. */
export function pluralKeyFor(base: PluralKey, locale: Locale, n: number): I18nKey {
  const cat = pluralCategory(locale, n);
  return (cat === 'one' ? `${base}.one` : `${base}.other`) as I18nKey;
}

/**
 * Translate a plural string. `n` selects the form and is passed through as
 * `{n}`, formatted with the locale's grouping (`1.200` in pt-BR) unless
 * `params.n` overrides it.
 */
export function plural(t: TFn, locale: Locale, base: PluralKey, n: number, params: TParams = {}): string {
  return t(pluralKeyFor(base, locale, n), {
    n: n.toLocaleString(LOCALE_DEFS[locale].intlTag),
    ...params,
  });
}

/**
 * Upper-case the FIRST letter only, with the locale's own casing rules.
 *
 * `textTransform: 'capitalize'` title-cases every word, which is right for
 * none of our languages and visibly wrong in one: pt-BR's "café da manhã"
 * became "Café Da Manhã". Sentence case is what a slot header or a chip
 * wants in all three.
 */
export function capitalizeFirst(text: string, locale: Locale): string {
  if (!text) return text;
  const tag = LOCALE_DEFS[locale].intlTag;
  // By code point, not UTF-16 unit, so a leading astral character survives.
  const [first, ...rest] = Array.from(text);
  return first.toLocaleUpperCase(tag) + rest.join('');
}
