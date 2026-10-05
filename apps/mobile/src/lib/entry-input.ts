import type { Locale } from '@/i18n';
import { localeTag, numberSeparators } from '@/lib/date-format';

/**
 * The add-meal form's number handling, in one place and pure — the sheet, the
 * search's quick-add row and the scan review all read typed numbers, and each
 * used to carry its own `replace(',', '.')`.
 *
 * ## The rules' ceilings, client side
 *
 * `isValidLog` in firestore.rules refuses `calories >= 20000` and any macro
 * `>= 1000`. Nothing on the client said so: a typo like `25000` passed the
 * sheet's `> 0` check, the write was refused, and the durable queue parked it
 * as "Saved offline" while the device was online — the row then sat there
 * until the queue's TTL dropped it (S20). The form now names the problem on
 * the field before Save is possible.
 */
export const LOG_KCAL_LIMIT = 20000;
export const LOG_MACRO_LIMIT = 1000;

/** Over the rules' calorie ceiling — the form refuses it inline. */
export function kcalOutOfRange(n: number | undefined): boolean {
  return n != null && n >= LOG_KCAL_LIMIT;
}

/** Over the rules' macro ceiling (protein, carbs, fat alike). */
export function macroOutOfRange(n: number | undefined): boolean {
  return n != null && n >= LOG_MACRO_LIMIT;
}

// `numberSeparators` builds an Intl formatter; a form re-parses its fields on
// every render, so the answer is kept per locale.
const separators = new Map<Locale, string>();
function decimalMark(locale: Locale): string {
  let mark = separators.get(locale);
  if (mark == null) {
    mark = numberSeparators(locale).decimal;
    separators.set(locale, mark);
  }
  return mark;
}

/** `1,250` / `12.500` — groups of exactly three after a 1–3 digit lead. */
function isGrouped(s: string, mark: '.' | ','): boolean {
  return (mark === '.' ? /^\d{1,3}(\.\d{3})+$/ : /^\d{1,3}(,\d{3})+$/).test(s);
}

/**
 * A typed number, read the way the user's locale writes it, or `undefined`
 * when the field is blank or not a non-negative number yet.
 *
 * - **Both marks accepted as the decimal point.** A pt-BR keyboard types
 *   `12,5`, but an English keyboard under a Brazilian region (or a paste)
 *   gives `12.5`, and refusing either is a lost macro. The old parser replaced
 *   the FIRST comma with a point, which read an English `1,250` as 1.25.
 * - **Grouping is stripped only when it is unmistakably grouping:** the
 *   locale's group mark followed by groups of exactly three digits. So
 *   `1,250` is 1250 in English and `1.500` is 1500 in Brazil, while `250,5`
 *   in English and `1.5` in Brazil still read as decimals.
 * - **Partial input binds:** `12.` is 12, `,5` is 0.5 — the field keeps the raw
 *   text, so the point survives while the user is still typing.
 * - Negative input is refused: Android's numeric keypad has a minus, and the
 *   rules reject a negative macro.
 */
export function parseDecimal(text: string, locale: Locale): number | undefined {
  // Spaces (incl. the no-break ones Intl uses in some locales) never mean
  // anything but grouping.
  const raw = text.trim().replace(/[\s  ]/g, '');
  if (raw === '' || !/^[\d.,]+$/.test(raw)) return undefined;
  const decimal = decimalMark(locale);
  const group = decimal === ',' ? '.' : ',';
  const lastDot = raw.lastIndexOf('.');
  const lastComma = raw.lastIndexOf(',');
  let plain: string;
  if (lastDot >= 0 && lastComma >= 0) {
    // Both present: whichever comes last is the decimal point.
    const dec = lastDot > lastComma ? '.' : ',';
    const grp = dec === '.' ? ',' : '.';
    const [int, frac, ...rest] = raw.split(dec);
    if (rest.length || frac.includes(grp) || !(/^\d+$/.test(int) || isGrouped(int, grp))) return undefined;
    plain = `${int.split(grp).join('')}.${frac}`;
  } else if (lastDot < 0 && lastComma < 0) {
    plain = raw;
  } else {
    const mark = lastDot >= 0 ? '.' : ',';
    if (mark === group && isGrouped(raw, mark)) {
      plain = raw.split(mark).join('');
    } else {
      const parts = raw.split(mark);
      if (parts.length !== 2) return undefined;
      plain = `${parts[0]}.${parts[1]}`;
    }
  }
  const n = Number(plain);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * A number as a prefilled field shows it: the locale's decimal mark, no
 * grouping. A pt-BR form showed `12.5` beside a `1,5×` chip; grouping is left
 * out so the text round-trips through {@link parseDecimal} unchanged however
 * the user edits it.
 */
export function formatDecimal(n: number, locale: Locale): string {
  const s = String(n);
  const mark = decimalMark(locale);
  return mark === '.' ? s : s.replace('.', mark);
}

/**
 * First letter up, the rest as written — "Café da manhã", not the
 * "Café Da Manhã" that `textTransform: 'capitalize'` makes of a pt-BR slot
 * name (it capitalises every word).
 */
export function sentenceCase(s: string, locale: Locale): string {
  if (!s) return s;
  return s.charAt(0).toLocaleUpperCase(localeTag(locale)) + s.slice(1);
}

/** What a number-only search query logs (see {@link parseQuickAddQuery}). */
export interface QuickAddQuery {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

/**
 * A search query that is a number, read as "log this many calories": `350`,
 * `350 kcal`, or `350 40p 30c 12f` with protein / carbs / fat by initial.
 * Spanish and Portuguese write fat as *grasa* / *gordura*, so `g` is fat there
 * too. Anything else in the query — a food name, a stray word, a repeated
 * macro, a value past the rules' ceilings, zero calories — is not a quick add,
 * and the search answers it as a search.
 */
export function parseQuickAddQuery(query: string, locale: Locale): QuickAddQuery | null {
  const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return null;
  const head = /^([\d.,]+)(kcal|cal|k)?$/.exec(tokens[0]);
  if (!head) return null;
  const calories = parseDecimal(head[1], locale);
  if (calories == null || !(calories > 0) || kcalOutOfRange(calories)) return null;
  let i = 1;
  if (!head[2] && tokens[1] && /^(kcal|cal|calories|calorías|calorias)$/.test(tokens[1])) i = 2;
  const letters: Record<string, 'protein' | 'carbs' | 'fat'> = { p: 'protein', c: 'carbs', f: 'fat' };
  if (locale !== 'en') letters.g = 'fat';
  const out: QuickAddQuery = { calories };
  for (; i < tokens.length; i++) {
    const m = /^([\d.,]+)([a-z])$/.exec(tokens[i]);
    const key = m ? letters[m[2]] : undefined;
    if (!m || !key || out[key] != null) return null;
    const v = parseDecimal(m[1], locale);
    if (v == null || macroOutOfRange(v)) return null;
    out[key] = v;
  }
  return out;
}
