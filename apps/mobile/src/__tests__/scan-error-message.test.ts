/**
 * A failed scan must say what actually failed.
 *
 * On 2026-08-23 a tester used his three free daily scans and the fourth was
 * correctly rejected by the server with `PHOTO_QUOTA_EXCEEDED`. `scan.tsx`
 * caught it with a bare `catch {}` and rendered "Couldn't read that photo.
 * Try another angle." — so he retook the photo four more times over 23
 * minutes. The message did not just fail to explain; it prescribed the one
 * action that could not work.
 *
 * The server had sent the typed code all along. These cases pin the mapping
 * so a future code cannot silently fall back to blaming the photograph.
 */
// `mealScan.ts` imports the Firebase callable at module scope; the mapper
// under test never touches it. Same shape as ledger-write-annotation.test.ts.
jest.mock('firebase/functions', () => ({ httpsCallable: () => async () => ({ data: {} }) }));
jest.mock('@/lib/firebase', () => ({ functions: {} }));

import { scanErrorMessage } from '@/lib/mealScan';
import { en } from '@/i18n/en';

const err = (code: string, extra: Record<string, unknown> = {}) => ({
  code: 'functions/resource-exhausted',
  details: { code, ...extra },
});

describe('scanErrorMessage', () => {
  it('tells a quota rejection apart from a bad photo', () => {
    const msg = scanErrorMessage(err('PHOTO_QUOTA_EXCEEDED', { limit: 3 }));
    expect(msg.key).toBe('scan.errQuota');
    expect(msg.params).toEqual({ n: 3 });
    // The regression itself: it must NOT be the "try another angle" copy.
    expect(msg.key).not.toBe('scan.failed');
  });

  it('falls back to the server limit being absent', () => {
    expect(scanErrorMessage(err('PHOTO_QUOTA_EXCEEDED')).params).toEqual({ n: 3 });
  });

  it.each([
    ['PHOTO_RATE_LIMITED', 'scan.errRateLimited'],
    ['RATE_LIMITED', 'scan.errRateLimited'],
    ['PHOTO_TOO_LARGE', 'scan.errTooLarge'],
    ['SERVICE_CEILING_REACHED', 'scan.errBusy'],
    ['FEATURE_DISABLED', 'scan.errOff'],
    ['UNAUTHENTICATED', 'scan.errAuth'],
  ])('maps %s to %s', (code, key) => {
    expect(scanErrorMessage(err(code)).key).toBe(key);
  });

  it.each([
    ['PHOTO_ESTIMATE_FAILED'],
    ['PHOTO_ANALYZE_FAILED'],
  ])('still blames the photo for %s, where that is true', (code) => {
    expect(scanErrorMessage(err(code)).key).toBe('scan.failed');
  });

  it('says the provider is down rather than blaming the photo', () => {
    // The 2026-08-30 outage: an unfunded Gemini prepay balance returned 429 on
    // every call for five days, fell through to PHOTO_ANALYZE_FAILED, and the
    // app told people to try another angle. The whole point of the code.
    const msg = scanErrorMessage(err('PHOTO_PROVIDER_UNAVAILABLE'));
    expect(msg.key).toBe('scan.errProvider');
    expect(msg.key).not.toBe('scan.failed');
  });

  it('promises no reset time for a provider outage, unlike the org ceiling', () => {
    // `scan.errBusy` ends with "It comes back at {time}", which is true of the
    // UTC-midnight ceiling and a lie about a depleted balance. Keeping these
    // two on separate keys is what stops us inventing a time we cannot honour.
    expect(en['scan.errProvider']).not.toContain('{time}');
    expect(en['scan.errBusy']).toContain('{time}');
    expect(scanErrorMessage(err('SERVICE_CEILING_REACHED')).key).toBe('scan.errBusy');
  });

  it('treats an UNKNOWN resource-exhausted code as our fault, not the photo', () => {
    // The forward guard. A limit we have not named yet is still a limit, and a
    // limit is never the photograph's fault — without this, the next new server
    // code repeats the outage's user-facing failure.
    expect(scanErrorMessage(err('SOME_FUTURE_LIMIT')).key).toBe('scan.errProvider');
  });

  it('still blames the photo when the failure is not a limit at all', () => {
    // The fallback must stay narrow: a local encode failure or a plain internal
    // error is exactly when "try another angle" is the honest advice.
    expect(scanErrorMessage({ code: 'functions/internal', details: { code: 'NEW' } }).key).toBe(
      'scan.failed',
    );
  });

  it('falls back safely for an unknown code, a plain Error, and null', () => {
    // NOTE: `err()` builds a resource-exhausted rejection, so an unknown code
    // there is now `scan.errProvider` by design — covered above. These are the
    // shapes with no callable status at all.
    expect(scanErrorMessage(new Error('encode')).key).toBe('scan.failed');
    expect(scanErrorMessage(null).key).toBe('scan.failed');
    expect(scanErrorMessage(undefined).key).toBe('scan.failed');
  });

  it('only ever returns keys that exist in the dictionary', () => {
    const codes = [
      'PHOTO_QUOTA_EXCEEDED', 'PHOTO_RATE_LIMITED', 'RATE_LIMITED', 'PHOTO_TOO_LARGE',
      'SERVICE_CEILING_REACHED', 'FEATURE_DISABLED', 'UNAUTHENTICATED', 'UNKNOWN',
    ];
    for (const c of codes) {
      expect(Object.keys(en)).toContain(scanErrorMessage(err(c)).key);
    }
  });
});
