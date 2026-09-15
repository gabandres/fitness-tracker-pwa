import { SENTRY_IGNORE_ERRORS, isIgnoredSentryError } from './sentry-ignore';

/**
 * The ignore list only ever acts on browser-storage noise the shell cannot
 * cause. These messages are copied verbatim from the Sentry events they were
 * written for, so a pattern that drifts away from its event fails here.
 */
describe('SENTRY_IGNORE_ERRORS', () => {
  it('drops the iOS WebKit storage-eviction rejection (IGNIA-WEB-P)', () => {
    expect(
      isIgnoredSentryError('UnknownError: Database deleted by request of the user'),
    ).toBe(true);
    expect(
      isIgnoredSentryError(
        "Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.",
      ),
    ).toBe(true);
  });

  it('drops the Firestore corrupt-IndexedDB refusal (IGNIA-WEB-N)', () => {
    expect(
      isIgnoredSentryError(
        'refusing to open IndexedDB database due to potential corruption of the IndexedDB database data; ' +
          'this corruption could be caused by clicking the "clear site data" button in a web browser; ' +
          'try reloading the web page to re-initialize the IndexedDB database: ' +
          'lastClosedDbVersion=18, event.oldVersion=0, event.newVersion=18, db.version=18',
      ),
    ).toBe(true);
  });

  it('keeps every error the shell itself can raise', () => {
    for (const msg of [
      'NG0750: A @defer block failed to load',
      'FirebaseError: Missing or insufficient permissions.',
      'FirebaseError: auth/popup-closed-by-user',
      'TypeError: Cannot read properties of undefined',
      'IndexedDB is not available in this environment',
      'Database is locked',
    ]) {
      expect(isIgnoredSentryError(msg), msg).toBe(false);
    }
  });

  it('holds only patterns specific enough to name the browser failure', () => {
    // A bare word like "IndexedDB" or "database" would swallow real errors.
    for (const p of SENTRY_IGNORE_ERRORS) {
      const text = typeof p === 'string' ? p : p.source;
      expect(text.length, text).toBeGreaterThan(20);
    }
  });
});
