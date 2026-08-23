import { LOCALE_DEFS, type Locale } from '@/i18n';

/**
 * Locale-aware date formatting.
 *
 * Every date in the app used to be written as
 * `toLocaleDateString(undefined, …)`, and `undefined` means the *device*
 * locale — not the language the user picked in Ignia. So anyone running the
 * app in Spanish on an English phone read "Tuesday, July 28" under "Hoy",
 * on every screen that shows a date. It reached the Spanish App Store
 * screenshots before anyone noticed, which is the tell: nothing about the
 * call site looks wrong, so it has to be centralised here instead.
 *
 * Pass the app locale from `useLocale()`. Module-level helpers that cannot
 * call a hook take it as a parameter.
 */

/** App locale → the BCP-47 tag Intl should format with. Registered once per
 *  language in `src/i18n/registry.ts`; nothing branches here. */
export function localeTag(locale: Locale): string {
  return LOCALE_DEFS[locale].intlTag;
}

export function formatDate(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleDateString(localeTag(locale), options);
}

export function formatTime(
  date: Date,
  locale: Locale,
  options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' },
): string {
  return date.toLocaleTimeString(localeTag(locale), options);
}
