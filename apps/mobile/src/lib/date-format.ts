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

/**
 * Locale-aware number formatting — the same trap as the dates above, and it
 * stayed hidden for exactly as long as this app shipped two languages.
 *
 * Every number in the app was written as a bare `n.toLocaleString()`, and no
 * argument means the DEVICE locale, not the language the user picked in
 * Ignia. That was invisible while the two locales were `en` and `es-PR`,
 * because the United States and Puerto Rico both group with a comma —
 * `widgets/strings.ts` says so in as many words, as a reason not to bother.
 * Brazil groups with a dot, so `1,974 kcal` is simply wrong there, and the
 * mirror case is worse: a Brazilian phone running the app in English rendered
 * `1.974`, which an English reader parses as *one point nine seven four*.
 *
 * Pass the app locale from `useLocale()`, same as the date helpers.
 */
export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return value.toLocaleString(localeTag(locale), options);
}

/**
 * The grouping and decimal characters for a locale — `1.974,5` in Brazil,
 * `1,974.5` in the US.
 *
 * Exists for the places that CANNOT call `Intl`: a Reanimated **worklet**
 * runs in its own JS runtime with no `Intl` at all, and the Android widget
 * runs in a bare Hermes context where `toLocaleString` has historically been
 * a silent no-op. Both hard-coded a comma, which was invisible while every
 * shipped locale used one. Resolve the separators here, on the JS thread,
 * and hand the two characters across as plain strings.
 */
export function numberSeparators(locale: Locale): { group: string; decimal: string } {
  try {
    const parts = new Intl.NumberFormat(localeTag(locale)).formatToParts(1234.5);
    return {
      group: parts.find((p) => p.type === 'group')?.value ?? ',',
      decimal: parts.find((p) => p.type === 'decimal')?.value ?? '.',
    };
  } catch {
    return { group: ',', decimal: '.' };
  }
}

/**
 * When the daily scan/coach quota comes back, as a local clock time.
 *
 * The quota resets at **UTC midnight** (`functions/src/daily-quota.ts` keys
 * its docs `${uid}_${YYYY-MM-DD}` off `toISOString()`), and the server's own
 * message says "Resets at midnight UTC" — which is not a time any user can
 * act on. In Puerto Rico that boundary is 8:00 PM; telling someone "midnight"
 * would be wrong by four hours in the direction that makes them wait longer
 * than they need to.
 *
 * So render the real boundary in their own clock. If the reset ever moves to
 * the user's local midnight, this keeps telling the truth without an edit.
 */
export function quotaResetLabel(locale: Locale): string {
  const now = new Date();
  const nextUtcMidnight = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );
  return formatTime(nextUtcMidnight, locale);
}
