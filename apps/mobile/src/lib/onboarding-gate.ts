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
  /**
   * The gate has waited long enough and the server still has not answered, so
   * `'wait'` has stopped being a decision and become a hang.
   *
   * `offline` alone is not enough to catch that. It is derived from Firestore
   * snapshot metadata (`connectivity.ts`), which is deliberately *slow* to
   * claim offline and, worse, needs a snapshot to arrive at all — and the
   * case this exists for is precisely the one where nothing arrives: wifi
   * associated, no route to the backend, so the radio is up and the SDK is
   * silent. Measured on the LG G6 (#79): `'wait'` held a full-screen,
   * tap-eating overlay for 30+ seconds over an already-rendered screen.
   *
   * Resolving it the same way as `offline` is the safe direction, and for the
   * same reason: the danger this whole module guards against is sending an
   * existing account to onboarding, and that only ever happens on a
   * *confirmed* answer. Letting an unanswered session into the app risks an
   * empty-looking day; the next sync fixes it.
   */
  serverGaveUp?: boolean;
}): RouteDecision {
  const { profile, profileConfirmed, offline, serverGaveUp = false } = state;

  if (!profileConfirmed && !profile) {
    // Nothing trustworthy. Online, the answer is seconds away and waiting beats
    // guessing. Offline, a signed-in session is an existing user far more often
    // than a new one — you cannot create an account without a network — so let
    // them into the app. The worst case there is an empty-looking day, which
    // the next sync fixes; the alternative eats their targets.
    return offline || serverGaveUp ? 'app' : 'wait';
  }

  // Unconfirmed data never justifies onboarding, whatever it says.
  return profileConfirmed && !profile?.profileCompleted ? 'onboarding' : 'app';
}

/**
 * Whether the boot splash should cover the app.
 *
 * ## Why this is a latch and not a derivation (#79)
 *
 * The splash renders at `absoluteFill` with `zIndex`/`elevation` 100, so while
 * it is up it swallows every tap and the user gets no feedback at all — the
 * screen underneath is fully rendered and simply does not respond.
 *
 * Its inputs all flap during ordinary mobile life. `profileLoading` goes true
 * for the window where the uid-keyed subscription has cleared `profileEntry`
 * and the new listener has not answered; `profileConfirmed` (`!meta.fromCache`)
 * flips back off when a reconnecting `onSnapshot` re-emits from cache. Neither
 * is a bug — both are transient and self-correcting. The bug was letting either
 * one re-raise a modal overlay over an app that had already settled: measured
 * on the LG G6, gone at ~1.9 s, back at ~3.4 s, and once back for ~40 s while
 * merely scrolling Settings.
 *
 * So the splash covers the gate *until it first settles for this user*, and
 * then never again for that user. A sign-out, or a switch to a different uid,
 * re-arms it — which is also what stops account B glimpsing account A's screen
 * during the handover.
 */
export function shouldShowSplash(state: {
  /** Auth, fonts and the route decision have all resolved. */
  gateSettled: boolean;
  /** The signed-in user, or null. */
  uid: string | null;
  /** The uid the gate has already settled for, or null if it never has. */
  settledUid: string | null;
}): boolean {
  const { gateSettled, uid, settledUid } = state;
  // `settledUid !== null` matters and is not redundant with `=== uid`: signed
  // out BOTH are null, and treating that as latched would drop the splash
  // during the pre-auth cold start — the one moment it is unambiguously right.
  const latched = settledUid !== null && settledUid === uid;
  return !gateSettled && !latched;
}
