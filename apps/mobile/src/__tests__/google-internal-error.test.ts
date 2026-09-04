/**
 * `INTERNAL_ERROR` (Play Services status code 8) — the one Google Sign-In
 * failure that is worth retrying, and the reason it is worth removing state
 * for.
 *
 * `IGNIA-MOBILE-C` recorded it twice: LG VS988 / Android 9 / 1.2.0+34 on
 * 2026-08-19, and OnePlus KB2005 / Android 14 / 1.2.2+44 on 2026-09-04. Two
 * devices, two OS versions, two builds, sixteen days apart — so the note that
 * called it one phone's transient GMS state was wrong. The breadcrumbs show
 * Play Services reporting OK, `SignInHubActivity` resuming and then pausing
 * **66 ms later**, which is far too fast for anyone to have chosen an account:
 * the picker opened and dismissed itself.
 *
 * `acquireGoogleCredential` now clears the cached native session before every
 * attempt, so nothing can be stale, and retries exactly once on this code.
 * These cases pin the classifier, because getting it wrong in either direction
 * is expensive: too broad and a cancelled picker or a DEVELOPER_ERROR gets
 * silently retried, too narrow and the bug comes back.
 */

import { isGoogleInternalError } from '@/lib/google-signin-errors';

describe('isGoogleInternalError', () => {
  it('matches the STRING "8", which is what Android actually sends', () => {
    // Sentry recorded `nativeCode: "8"` on both events — the value crosses the
    // bridge as a string, so this is the representation that matters.
    expect(isGoogleInternalError({ code: '8', message: 'INTERNAL_ERROR' })).toBe(true);
  });

  it('matches the number 8 too, rather than trusting one representation', () => {
    expect(isGoogleInternalError({ code: 8 })).toBe(true);
  });

  it('does NOT match a cancelled picker', () => {
    // Retrying this would reopen the picker on a user who just dismissed it.
    expect(isGoogleInternalError({ code: '12501' })).toBe(false);
    expect(isGoogleInternalError({ code: 12501 })).toBe(false);
  });

  it('does NOT match DEVELOPER_ERROR', () => {
    // Code 10 means the signing cert or client ID does not match what Google
    // has. It will fail identically forever, so a retry is pure latency — and
    // it is the failure that broke 100% of Play installs twice in one week,
    // which is exactly when you want the error surfaced, not papered over.
    expect(isGoogleInternalError({ code: '10' })).toBe(false);
  });

  it('does not match on the words INTERNAL_ERROR', () => {
    // The message is Google's wording, not our contract.
    expect(isGoogleInternalError({ message: 'INTERNAL_ERROR' })).toBe(false);
    expect(isGoogleInternalError(new Error('INTERNAL_ERROR'))).toBe(false);
  });

  it('survives the shapes a catch block really receives', () => {
    expect(isGoogleInternalError(null)).toBe(false);
    expect(isGoogleInternalError(undefined)).toBe(false);
    expect(isGoogleInternalError('8')).toBe(false);
    expect(isGoogleInternalError(8)).toBe(false);
    expect(isGoogleInternalError({})).toBe(false);
  });
});
