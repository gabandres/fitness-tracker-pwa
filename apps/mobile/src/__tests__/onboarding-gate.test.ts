import { assessRoute, shouldShowSplash } from '@/lib/onboarding-gate';

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

/**
 * #79 — the same "nothing trustworthy" state, reached with the server silent
 * rather than the device offline.
 *
 * `offline` is derived from Firestore snapshot metadata, so it needs a snapshot
 * to arrive before it can say anything. The case measured on the LG G6 is the
 * one where none does: wifi associated, no route to the backend. `'wait'` then
 * held a full-screen tap-eating overlay for 30+ seconds over an already
 * rendered screen, and only a manual tap cleared it.
 */
describe('assessRoute — when the server never answers (#79)', () => {
  it('waits by default, exactly as before', () => {
    expect(
      assessRoute({ profile: null, profileConfirmed: false, offline: false, serverGaveUp: false }),
    ).toBe('wait');
  });

  it('stops waiting once the gate has given up on the server', () => {
    expect(
      assessRoute({ profile: null, profileConfirmed: false, offline: false, serverGaveUp: true }),
    ).toBe('app');
  });

  it('still refuses to onboard on a confirmed-looking-but-unconfirmed profile', () => {
    // The direction that matters: giving up must never manufacture a server
    // answer. Onboarding stays reachable only through `profileConfirmed`.
    expect(
      assessRoute({ profile: fresh, profileConfirmed: false, offline: false, serverGaveUp: true }),
    ).toBe('app');
  });

  it('a real server answer still wins after the gate gave up', () => {
    expect(
      assessRoute({ profile: fresh, profileConfirmed: true, offline: false, serverGaveUp: true }),
    ).toBe('onboarding');
  });
});

/**
 * The splash latch (#79). The overlay sits at `absoluteFill`/`zIndex` 100 and
 * eats every tap while it is up, so the cases that matter are the ones where it
 * must NOT come back.
 */
describe('shouldShowSplash', () => {
  const A = 'uid-a';
  const B = 'uid-b';

  it('covers the pre-auth cold start', () => {
    // Signed out and still initializing: uid and settledUid are BOTH null, and
    // an `=== uid` test alone would call that latched and show nothing.
    expect(shouldShowSplash({ gateSettled: false, uid: null, settledUid: null })).toBe(true);
  });

  it('covers a signed-in user whose gate has not settled yet', () => {
    expect(shouldShowSplash({ gateSettled: false, uid: A, settledUid: null })).toBe(true);
  });

  it('uncovers once the gate settles', () => {
    expect(shouldShowSplash({ gateSettled: true, uid: A, settledUid: A })).toBe(false);
  });

  it('NEVER returns for a user it has already settled for — the reported bug', () => {
    // A reconnecting snapshot re-emitting from cache flips `profileConfirmed`
    // back off mid-session. Before the latch that re-raised the overlay over a
    // working app, for as long as 40 seconds.
    expect(shouldShowSplash({ gateSettled: false, uid: A, settledUid: A })).toBe(false);
  });

  it('re-arms on a real sign-out', () => {
    expect(shouldShowSplash({ gateSettled: false, uid: null, settledUid: null })).toBe(true);
  });

  it('re-arms when a different account signs in', () => {
    // Otherwise account B would watch account A's screen while its own
    // listeners deliver.
    expect(shouldShowSplash({ gateSettled: false, uid: B, settledUid: A })).toBe(true);
  });
});
