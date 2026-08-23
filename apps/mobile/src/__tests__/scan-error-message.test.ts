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

  it('falls back safely for an unknown code, a plain Error, and null', () => {
    expect(scanErrorMessage(err('SOMETHING_NEW')).key).toBe('scan.failed');
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
