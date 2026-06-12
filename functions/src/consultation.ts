import { onCall } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota } from "./init";

// ─── Consultation quota (AI coach rate limit) ───────────────────────
//
// The AI coach (Gemini consultations) is free-tier on the client side
// but shared across all users on the project's Gemini API quota. One
// power user could monopolize it. This callable:
//   1. Verifies auth
//   2. Gives admins + comped friends unlimited access
//   3. Caps paid subscribers at the paid cap per UTC day
//   4. Caps free users at the free cap per UTC day
//      (atomic Firestore counter; over-limit throws 'resource-exhausted').
//
// Client calls this BEFORE streaming the Gemini response. On success
// the client proceeds with the direct Gemini SDK call. On failure the
// client shows an upgrade pitch (free) or a generic limit notice (paid).

// Per-uid min interval for reserve + release. Covers both reserve spam
// (which would burn Firestore writes on the quota doc) and release spam
// (which can't build credit past zero but still wastes writes).
const CONSULTATION_MIN_INTERVAL_MS = 1_500;
const ACCESS_STATUS_MIN_INTERVAL_MS = 300;

const CONSULTATION_RATE_LIMIT = {
  collection: "consultationRateLimit",
  minIntervalMs: CONSULTATION_MIN_INTERVAL_MS,
  errorCode: ErrorCode.CONSULTATION_RATE_LIMITED,
};

export const reserveConsultation = onCall(async (request) => {
  const caller = await callerAccess.resolveCaller(request, CONSULTATION_RATE_LIMIT);

  // Admins + comped users bypass the quota entirely.
  if (caller.unlimited) {
    return { capped: false, remaining: -1, limit: dailyQuota.limitFor("consultation", true) };
  }

  const paid = caller.tier === "paid";
  const { remaining } = await dailyQuota.reserve(caller.uid, "consultation", paid);
  return { capped: false, remaining, limit: dailyQuota.limitFor("consultation", paid) };
});

/**
 * Refund a previously-reserved consultation slot. Called by the client
 * when the streaming Gemini call fails AFTER reservation (network blip,
 * Gemini 5xx, safety block). Without this, a transient failure silently
 * consumes one of the user's daily slots.
 *
 * Decrements the current-day counter but will not go below zero — so
 * a bad client can't build up credit by spam-calling release.
 */
export const releaseConsultation = onCall(async (request) => {
  const caller = await callerAccess.resolveCaller(request, CONSULTATION_RATE_LIMIT);

  // Admins + comped users never had a slot reserved. Paid users DO
  // have a capped slot (30/day) — refund them too.
  if (caller.unlimited) return { released: false };

  // Honest signal: false when there was nothing to refund (no doc yet,
  // or already at zero). The client treats release as fire-and-forget.
  return { released: await dailyQuota.release(caller.uid, "consultation") };
});

/**
 * Tells the client whether the signed-in user has unlimited access
 * (admin or comped friend). Client uses this on sign-in to adjust the
 * Subscribe card UI — show the friend/admin badge instead of the
 * $3/mo pitch. Server enforcement is still independent in the
 * quota-reserve functions above; this endpoint only shapes UI.
 */
export const checkAccessStatus = onCall(async (request) => {
  if (!request.auth) {
    return {
      admin: false, comped: false,
      photosRemaining: null, consultationsRemaining: null,
      photoLimit: dailyQuota.limitFor("photo", false),
      consultationLimit: dailyQuota.limitFor("consultation", false),
    };
  }
  // Tier resolution (admin / comped-list / referral compedUntil / paid /
  // free) lives in CallerAccess — the same resolution the quota
  // callables enforce, so the UI badge can't drift from server behaviour.
  const caller = await callerAccess.resolveCaller(request, {
    collection: "accessStatusRateLimit",
    minIntervalMs: ACCESS_STATUS_MIN_INTERVAL_MS,
    errorCode: ErrorCode.RATE_LIMITED,
  });
  const admin = caller.tier === "admin";
  const comped = caller.tier === "comped";
  // Limits key off the raw Stripe claim, not the tier — an admin/comped
  // user who also pays keeps seeing the paid caps in decorative UI.
  const paid = caller.paidClaim;
  const photoLimit = dailyQuota.limitFor("photo", paid);
  const consultationLimit = dailyQuota.limitFor("consultation", paid);

  // Admin/comped users hide the "N left" caption entirely (null signal).
  // Paid users DO see a remaining count against the 30/day cap.
  if (caller.unlimited) {
    return {
      admin, comped,
      photosRemaining: null, consultationsRemaining: null,
      photoLimit, consultationLimit,
    };
  }

  const [photosUsed, consultUsed] = await Promise.all([
    dailyQuota.peek(caller.uid, "photo"),
    dailyQuota.peek(caller.uid, "consultation"),
  ]);
  return {
    admin, comped,
    photosRemaining: Math.max(0, photoLimit - photosUsed),
    consultationsRemaining: Math.max(0, consultationLimit - consultUsed),
    photoLimit,
    consultationLimit,
  };
});
