import { parseYmd } from '@macrolog/core';
import type { Locale } from '@/i18n';
import { localeTag } from '@/lib/date-format';

/**
 * Cached formatting for the Trends charts (re-score 3, bug B2).
 *
 * `formatDate`/`formatNumber` call `toLocaleDateString`/`toLocaleString`,
 * which build a fresh formatter on every call. That is nothing for a screen
 * that prints ten numbers, and it is not nothing here: on 1Y the three chart
 * cards write a sentence, a bubble and an audio-graph label per day — about
 * 3,300 date strings — and the maintenance card re-writes its set for every
 * replay chunk (13 chunks on a year), all on the JS thread while the line is
 * filling in.
 *
 * Same output, by definition: `n.toLocaleString(tag, o)` is specified as
 * `new Intl.NumberFormat(tag, o).format(n)`, and a date-only
 * `toLocaleDateString` as the matching `Intl.DateTimeFormat`. A chart's day
 * keys are a fixed set per locale, so the formatted strings are cached too.
 *
 * (`lib/date-format.ts` could cache the formatters for every caller; it is
 * shared, and this keeps the change inside the charts.)
 */

const numberFormats = new Map<string, Intl.NumberFormat>();

export function chartNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  const id = `${locale}|${options ? JSON.stringify(options) : ''}`;
  let f = numberFormats.get(id);
  if (!f) {
    f = new Intl.NumberFormat(localeTag(locale), options);
    numberFormats.set(id, f);
  }
  return f.format(value);
}

const DATE_STYLES = {
  short: { month: 'short', day: 'numeric' },
  long: { weekday: 'short', month: 'short', day: 'numeric' },
} as const satisfies Record<string, Intl.DateTimeFormatOptions>;

export type ChartDateStyle = keyof typeof DATE_STYLES;

const dateFormats = new Map<string, Intl.DateTimeFormat>();
const dateStrings = new Map<string, string>();
/** A year of keys × two styles × three locales is ~2,200 strings; past this
 *  the cache is reset rather than grown (a session that crosses it is a long
 *  one, and the next pass refills what is on screen). */
const DATE_CACHE_MAX = 5000;

/** A day key ("2026-10-04") as the charts print it — "Oct 4" or "Sun, Oct 4". */
export function chartDate(key: string, locale: Locale, style: ChartDateStyle): string {
  const id = `${locale}|${style}|${key}`;
  const hit = dateStrings.get(id);
  if (hit !== undefined) return hit;
  const fid = `${locale}|${style}`;
  let f = dateFormats.get(fid);
  if (!f) {
    f = new Intl.DateTimeFormat(localeTag(locale), DATE_STYLES[style]);
    dateFormats.set(fid, f);
  }
  const out = f.format(parseYmd(key));
  if (dateStrings.size >= DATE_CACHE_MAX) dateStrings.clear();
  dateStrings.set(id, out);
  return out;
}

/** "+70", "−70", "0" — a typographic minus, like every signed figure in the
 *  app, never a hyphen. */
export function signedNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  const text = chartNumber(Math.abs(value), locale, options);
  if (chartNumber(0, locale, options) === text) return text;
  return `${value < 0 ? '−' : '+'}${text}`;
}
