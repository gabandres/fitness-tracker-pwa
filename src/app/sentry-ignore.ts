/**
 * Errors the web shell's Sentry client drops before sending.
 *
 * Every pattern here is a browser-storage failure that no line in `src/`
 * can cause or catch: the Firebase JS SDK opens IndexedDB on its own (the
 * `@firebase/app` heartbeat store on every page; Firestore persistence in
 * pre-ADR-0036 bundles that a retired PWA install still carries), and when
 * the *browser* evicts or corrupts that storage — iOS WebKit's "Database
 * deleted by request of the user", Chrome's "refusing to open IndexedDB
 * database due to potential corruption" — the SDK's internal transaction
 * promise rejects unhandled. Sentry then files an issue with zero users and
 * one event against `/app` on the legacy hosting domain, or against a
 * headless crawler.
 *
 * Seen: IGNIA-WEB-P (2026-09-15, iPhone standalone PWA at
 * `macrolog.web.app/app`), IGNIA-WEB-N (2026-08-25..30, HeadlessChrome via
 * bing.com on a pre-retirement release). Both are noise about storage the
 * page does not own; the retired route already renders the "moved to the
 * apps" page regardless.
 *
 * Strings are substring matches on the event message (Sentry's
 * `ignoreErrors` contract); keep them specific enough that a real app error
 * cannot contain them.
 */
export const SENTRY_IGNORE_ERRORS: readonly (string | RegExp)[] = [
  // iOS WebKit evicting site data under an open IndexedDB connection.
  'Database deleted by request of the user',
  // Any IndexedDB transaction on a connection WebKit is tearing down.
  'The database connection is closing',
  // Firestore persistence refusing a corrupt IndexedDB store (stale bundle).
  'refusing to open IndexedDB database due to potential corruption',
];

/**
 * Pure mirror of Sentry's `ignoreErrors` matching (substring for strings,
 * `test` for RegExps) so the list above is unit-testable without booting the
 * SDK. Sentry applies the same rule client-side; this exists so a pattern
 * that stops matching the message it was written for fails a test, not a
 * dashboard.
 */
export function isIgnoredSentryError(message: string): boolean {
  return SENTRY_IGNORE_ERRORS.some((p) =>
    typeof p === 'string' ? message.includes(p) : p.test(message),
  );
}
