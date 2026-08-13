import { assessRoute } from '@/lib/onboarding-gate';

/**
 * Where a signed-in, verified user is sent on launch.
 *
 * Reported from a real device on 2026-08-13: force-quitting the app while
 * offline and reopening landed on ONBOARDING. This app has no Firestore
 * persistence, so an offline cold start makes `onSnapshot` fire from an empty
 * memory cache and report that the profile does not exist — indistinguishable,
 * to the old gate, from a user who never onboarded.
 *
 * Finishing that form calls `saveOnboardingV2`, which overwrites targets, goal
 * and current weight. A network condition would have destroyed real data, and
 * to the user it reads as "my account is gone" — the exact panic the offline
 * cache exists to prevent.
 */

const onboarded = { profileCompleted: true };
const fresh = { profileCompleted: false };

describe('assessRoute', () => {
  it('sends a confirmed new account to onboarding', () => {
    expect(
      assessRoute({ profile: fresh, profileConfirmed: true, offline: false }),
    ).toBe('onboarding');
  });

  it('sends a confirmed onboarded account to the app', () => {
    expect(
      assessRoute({ profile: onboarded, profileConfirmed: true, offline: false }),
    ).toBe('app');
  });

  it('NEVER onboards on an unconfirmed empty profile — the reported bug', () => {
    // Offline cold start: the snapshot said "no profile", but only because it
    // came from an empty cache.
    expect(
      assessRoute({ profile: null, profileConfirmed: false, offline: true }),
    ).toBe('app');
  });

  it('waits rather than guessing while online and unanswered', () => {
    // Online, the server is about to answer — a guess here would flash the
    // wrong screen at every launch.
    expect(
      assessRoute({ profile: null, profileConfirmed: false, offline: false }),
    ).toBe('wait');
  });

  it('trusts the disk cache offline instead of re-onboarding', () => {
    expect(
      assessRoute({ profile: onboarded, profileConfirmed: false, offline: true }),
    ).toBe('app');
  });

  it('still will not onboard offline even when the cached profile is incomplete', () => {
    // A cached incomplete profile is not a server answer either. Sending them
    // in risks the overwrite; the app handles missing targets gracefully.
    expect(
      assessRoute({ profile: fresh, profileConfirmed: false, offline: true }),
    ).toBe('app');
  });
});
