/**
 * Widget string table — deliberately separate from `src/i18n`.
 *
 * The app's `useT()` needs the React tree (it reads the locale off the auth
 * profile through context), and a widget renders with no tree, no auth and no
 * Firestore. So the handful of words a widget draws live here as a plain
 * lookup, keyed by the locale that rode in on the snapshot blob.
 *
 * The iOS SwiftUI widget has its own copy of these same strings; keep the two
 * in step. Both locales must stay at parity, same as `src/i18n`.
 */

export interface WidgetStrings {
  /** Unit suffix after the calorie number. */
  kcal: string;
  /** Follows the number: "1,240 kcal **left**". */
  left: string;
  /** Replaces `left` once the target is passed. */
  over: string;
  /** Label for the protein line, e.g. "68g protein left". */
  protein: string;
  /** Empty state — shown before the app has written anything, and after
   *  midnight until it's opened again. */
  empty: string;
}

const en: WidgetStrings = {
  kcal: 'kcal',
  left: 'left',
  over: 'over',
  protein: 'protein',
  empty: 'Open Ignia to start',
};

const esPR: WidgetStrings = {
  kcal: 'kcal',
  left: 'restantes',
  over: 'de más',
  protein: 'proteína',
  empty: 'Abre Ignia para empezar',
};

const TABLE: Record<string, WidgetStrings> = { en, 'es-PR': esPR };

/** Falls back to English for any locale the widget doesn't carry strings for. */
export function widgetStrings(locale: string): WidgetStrings {
  return TABLE[locale] ?? en;
}

/**
 * Thousands separators without `Intl` — Android's widget JS context is a bare
 * Hermes runtime and `toLocaleString` there has historically been a no-op that
 * silently returns the unformatted number. Both locales we ship use a comma
 * grouping at this magnitude, so one implementation covers them.
 */
export function groupDigits(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
