import { getAuth } from "firebase-admin/auth";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import type { Response } from "express";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota, db, geminiApiKey, withCostGuards } from "./init";
import { recordAiUsage, usageFromMetadata } from "./ai-usage";
import { getGeminiClient } from "./gemini-client";

// ─── AI coach (Gemini consultation) ─────────────────────────────────
//
// The coach streams a grounded answer over the user's 14-day log. The
// Gemini API key lives ONLY on the server (defineSecret) — clients no
// longer ship it. `consultationStream` is the sole path to Gemini for
// this feature; it verifies the caller's Firebase ID token, enforces
// the per-uid rate limit + daily quota, reserves one slot, then relays
// the model's token stream to the browser as Server-Sent Events.
//
// Why onRequest (not onCall): onCall buffers the whole response, so the
// coach's answer would appear all at once. onRequest lets us res.write()
// each chunk as it arrives from Gemini, preserving the typewriter UX.
//
// Refund policy: the slot is reserved BEFORE streaming. If Gemini fails
// server-side (5xx / safety block), the server refunds the slot itself
// (dailyQuota.release) and emits an `error` event. A mid-stream client
// disconnect after the first token is the one case that consumes a slot
// without a full answer — rare, and the user did receive partial value.

// Per-uid min interval — covers stream spam that would otherwise burn
// Gemini tokens past the daily cap one 1.5s-spaced call at a time.
const CONSULTATION_MIN_INTERVAL_MS = 1_500;
const ACCESS_STATUS_MIN_INTERVAL_MS = 300;

const CONSULTATION_RATE_LIMIT = {
  collection: "consultationRateLimit",
  minIntervalMs: CONSULTATION_MIN_INTERVAL_MS,
  errorCode: ErrorCode.CONSULTATION_RATE_LIMITED,
};

// Same origins the leaked client key was HTTP-referrer-locked to. The
// coach is only ever invoked from the first-party web app.
const CONSULT_ALLOWED_ORIGINS = [
  "https://ignia.fit",
  "https://macrolog.firebaseapp.com",
  "http://localhost:4200",
];

// The client assembles the grounded system instruction (profile + 14-day
// table) and the question; the server only relays them. These bound the
// payload so a hostile caller can't push arbitrary-length prompts at the
// project's Gemini quota. Mirrors the weekly-report caps.
const CONSULT_SYSTEM_MAX_CHARS = 20_000;
const CONSULT_PROMPT_MAX_CHARS = 2_000;
// Server pins the model so the client can't swap in a pricier one.
// Matches environment.gemini.model (moving flash alias).
const CONSULT_MODEL = "gemini-flash-latest";

interface ConsultInput {
  systemInstruction?: unknown;
  prompt?: unknown;
}

/** Map an HttpsError thrown by the caller-access/quota preamble to an
    HTTP JSON error the client's fetch path understands. Sent BEFORE any
    SSE bytes, so the client sees a non-200 and reads `{ code }`. */
function sendPreambleError(res: Response, err: unknown): void {
  if (err instanceof HttpsError) {
    const status = err.httpErrorCode?.status ?? 500;
    const details = (err.details ?? {}) as { code?: string; retryAfterMs?: number };
    res.status(status).json({ code: details.code, retryAfterMs: details.retryAfterMs });
    return;
  }
  console.error("consultationStream preamble error:", err);
  res.status(500).json({ code: ErrorCode.REPORT_GENERATE_FAILED });
}

export const consultationStream = onRequest(
  { secrets: [geminiApiKey], cors: CONSULT_ALLOWED_ORIGINS, maxInstances: 5 },
  async (req, res) => {
    if (req.method !== "POST") {
      res.status(405).json({ code: ErrorCode.RATE_LIMITED });
      return;
    }

    // ── Verify the Firebase ID token (Authorization: Bearer <token>) ──
    const authz = req.headers.authorization;
    const idToken = authz?.startsWith("Bearer ") ? authz.slice(7) : null;
    if (!idToken) {
      res.status(401).json({ code: ErrorCode.UNAUTHENTICATED });
      return;
    }
    let decoded;
    try {
      decoded = await getAuth().verifyIdToken(idToken);
    } catch {
      res.status(401).json({ code: ErrorCode.UNAUTHENTICATED });
      return;
    }

    // ── Validate payload ──
    const { systemInstruction, prompt } = (req.body ?? {}) as ConsultInput;
    if (typeof systemInstruction !== "string" || systemInstruction.length === 0 ||
        systemInstruction.length > CONSULT_SYSTEM_MAX_CHARS) {
      res.status(400).json({ code: ErrorCode.REPORT_PAYLOAD_INVALID });
      return;
    }
    if (typeof prompt !== "string" || prompt.length === 0 ||
        prompt.length > CONSULT_PROMPT_MAX_CHARS) {
      res.status(400).json({ code: ErrorCode.REPORT_PAYLOAD_INVALID });
      return;
    }

    // ── Resolve caller (auth already checked → rate limit + tier) ──
    // The decoded ID token is structurally a CallerRequestLike token
    // (email + stripeRole custom claim live top-level), so we reuse the
    // exact tier/rate-limit logic the onCall callables use.
    const callerReq = { auth: { uid: decoded.uid, token: decoded } };
    let caller;
    try {
      caller = await callerAccess.resolveCaller(callerReq, CONSULTATION_RATE_LIMIT);
    } catch (err) {
      sendPreambleError(res, err);
      return;
    }

    // ── The two AI-cost guards, in the one order that is correct ──
    //
    // `withCostGuards` (cost-guards.ts) checks the org-wide ceiling BEFORE the
    // per-user reserve — so an ordinary "you hit your own limit" rejection
    // never burns a slot of the shared budget — reserves one slot (comped
    // bypasses; admin does NOT, see `Caller.quotaExempt`), meters the spend for
    // every tier, and refunds the SLOT if the work below throws. The spend is
    // never refunded: the user did not get their consultation, but the tokens
    // were still spent, and a ceiling that refunds real spend stops guarding
    // the bill. ADR-0008 owns the caller/quota model.
    //
    // Unlimited callers are metered but not blocked (spend-ceiling.ts).
    const limit = dailyQuota.limitFor("consultation", caller.paidClaim);
    try {
      await withCostGuards({ kind: "consultation", caller }, async ({ reservation }) => {
        // Comped callers hold no reservation, so there is no real count to
        // show; `-1` is the client's "hide the N-left caption" signal.
        const remaining = reservation ? reservation.remaining : -1;

        // ── Stream Gemini as SSE ──
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("X-Accel-Buffering", "no"); // defeat any proxy buffering
        res.flushHeaders?.();
        // First event carries the quota counter so the UI can update "N left".
        res.write(`event: meta\ndata: ${JSON.stringify({ remaining, limit })}\n\n`);

        try {
          const client = getGeminiClient();
          const stream = await client.models.generateContentStream({
            model: CONSULT_MODEL,
            contents: prompt,
            config: { systemInstruction, temperature: 0.4 },
          });
          let usage: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number } | undefined;
          for await (const chunk of stream) {
            // The final chunk carries the whole call's totals; keep the last seen.
            if (chunk.usageMetadata) usage = chunk.usageMetadata;
            const text = chunk.text;
            if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
          }
          res.write("event: done\ndata: {}\n\n");
          res.end();
          void recordAiUsage(db, { kind: "consultation", model: CONSULT_MODEL, ...usageFromMetadata(usage) });
        } catch (err) {
          console.error("consultationStream Gemini error:", err);
          // Rethrown, NOT handled here: the wrapper owes the user their slot
          // back (a transient Gemini failure must not cost a daily
          // consultation, and the client cannot refund it itself — its own
          // rate-limit window would reject the release call). The SSE `error`
          // event is written below, AFTER that refund has landed, so a client
          // that retries on the error cannot race it.
          throw err;
        }
      });
    } catch (err) {
      if (res.headersSent) {
        // The stream was already open, so the client is mid-response and can
        // only be told in-band. The refund, if there was one, has landed.
        res.write(`event: error\ndata: ${JSON.stringify({ code: ErrorCode.REPORT_GENERATE_FAILED })}\n\n`);
        res.end();
      } else {
        // A guard rejected before any SSE byte: FEATURE_DISABLED /
        // SERVICE_CEILING_REACHED from the ceiling, or a 429
        // CONSULTATION_QUOTA_EXCEEDED from the reserve.
        sendPreambleError(res, err);
      }
      return;
    }
  },
);

/**
 * Tells the client whether the signed-in user has unlimited access
 * (admin or comped friend). Client uses this on sign-in to adjust the
 * Subscribe card UI — show the friend/admin badge instead of the
 * $3/mo pitch. Server enforcement is independent in consultationStream;
 * this endpoint only shapes UI.
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
  // enforcement uses, so the UI badge can't drift from server behaviour.
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

  // Comped users hide the "N left" caption entirely (null signal). Admin is
  // counted like everyone else, so it reports a real number.
  // Paid users DO see a remaining count against the 30/day cap.
  if (caller.quotaExempt) {
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
