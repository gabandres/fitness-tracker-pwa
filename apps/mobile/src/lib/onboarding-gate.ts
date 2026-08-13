import type { Profile } from '@macrolog/core';

/**
 * Where to send a signed-in, email-verified user on launch.
 *
 * Extracted from `_layout.tsx`'s effect so the decision can be tested without
 * a router, a navigator or a Firebase session. The effect keeps the
 * side-effects; this owns the judgement.
 *
 * ## The rule, and the bug that produced it
 *
 * **Only the server may send an existing account to onboarding.**
 *
 * This app has no Firestore persistence (`offline-cache.ts` says why), so on a
 * cold start with no network `onSnapshot` fires from an empty memory cache and
 * reports that the profile document does not exist. The old gate read that as
 * "never onboarded" and routed into the form — and finishing it calls
 * `saveOnboardingV2`, which overwrites targets, goal and current weight.
 *
 * Reported from a device on 2026-08-13 during an airplane-mode test.
 */
export type RouteDecision = 'onboarding' | 'app' | 'wait';

export function assessRoute(state: {
  /** From the server, or rehydrated from disk — `profileConfirmed` says which. */
  profile: Pick<Profile, 'profileCompleted'> | null;
  /** True only when the SERVER answered. */
  profileConfirmed: boolean;
  offline: boolean;
}): RouteDecision {
  const { profile, profileConfirmed, offline } = state;

  if (!profileConfirmed && !profile) {
    // Nothing trustworthy. Online, the answer is seconds away and waiting beats
    // guessing. Offline, a signed-in session is an existing user far more often
    // than a new one — you cannot create an account without a network — so let
    // them into the app. The worst case there is an empty-looking day, which
    // the next sync fixes; the alternative eats their targets.
    return offline ? 'app' : 'wait';
  }

  // Unconfirmed data never justifies onboarding, whatever it says.
  return profileConfirmed && !profile?.profileCompleted ? 'onboarding' : 'app';
}
