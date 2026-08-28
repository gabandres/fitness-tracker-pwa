import { isExpectedHealthState } from '@/lib/health-errors';

// `useHealthAutoImport` re-throws anything this predicate does not claim, and it
// runs on EVERY foreground. So each entry here is the difference between an
// unremarkable device condition and a Sentry event that reads like a crash —
// and each was added from a real production event, not from the HealthKit
// header file.

describe('isExpectedHealthState', () => {
  it('claims a locked device', () => {
    expect(isExpectedHealthState(new Error('Protected health data is inaccessible'))).toBe(true);
    expect(isExpectedHealthState(new Error('Error Domain=com.apple.healthkit Code=6'))).toBe(true);
  });

  // IGNIA-MOBILE-H, release 1.2.1 / build 60 — the live App Store binary. The
  // local `connected` flag says yes while iOS holds no grant: a reinstall, a
  // restore from backup, or a revoke in Settings -> Privacy -> Health.
  it('claims "authorization not determined"', () => {
    const err = new Error(
      'Error Domain=com.apple.healthkit Code=5 "Authorization not determined" ' +
        'UserInfo={NSLocalizedDescription=Authorization not determined}',
    );
    expect(isExpectedHealthState(err)).toBe(true);
  });

  // The direction that matters more: a predicate that claims everything would
  // silence real import bugs, which is the reason this is a list and not a
  // bare `catch {}`.
  it('does NOT claim a real failure', () => {
    expect(isExpectedHealthState(new Error('Missing or insufficient permissions'))).toBe(false);
    expect(isExpectedHealthState(new Error('Network request failed'))).toBe(false);
    expect(isExpectedHealthState(new TypeError('undefined is not a function'))).toBe(false);
  });

  it('survives a non-Error throw', () => {
    expect(isExpectedHealthState(undefined)).toBe(false);
    expect(isExpectedHealthState('com.apple.healthkit Code=6')).toBe(true);
  });
});
