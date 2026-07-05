import { getAuth } from "firebase-admin/auth";
import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import type { Response } from "express";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota, geminiApiKey } from "./init";

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

    // ── Reserve one slot (admins/comped bypass) ──
    const limit = dailyQuota.limitFor("consultation", caller.paidClaim);
    let remaining = -1;
    let reserved = false;
    if (!caller.unlimited) {
      try {
        const r = await dailyQuota.reserve(caller.uid, "consultation", caller.tier === "paid");
        remaining = r.remaining;
        reserved = true;
      } catch (err) {
        sendPreambleError(res, err); // 429 CONSULTATION_QUOTA_EXCEEDED
        return;
      }
    }

    // ── Stream Gemini as SSE ──
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("X-Accel-Buffering", "no"); // defeat any proxy buffering
    res.flushHeaders?.();
    // First event carries the quota counter so the UI can update "N left".
    res.write(`event: meta\ndata: ${JSON.stringify({ remaining, limit })}\n\n`);

    try {
      const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const stream = await client.models.generateContentStream({
        model: CONSULT_MODEL,
        contents: prompt,
        config: { systemInstruction, temperature: 0.4 },
      });
      for await (const chunk of stream) {
        const text = chunk.text;
        if (text) res.write(`data: ${JSON.stringify({ text })}\n\n`);
      }
      res.write("event: done\ndata: {}\n\n");
      res.end();
    } catch (err) {
      console.error("consultationStream Gemini error:", err);
      // We already consumed a slot; refund it server-side so a transient
      // Gemini failure doesn't silently cost the user one of their daily
      // consultations. (Client can't reliably refund — the rate-limit
      // window would reject its release call.)
      if (reserved) {
        void dailyQuota.release(caller.uid, "consultation");
      }
      res.write(`event: error\ndata: ${JSON.stringify({ code: ErrorCode.REPORT_GENERATE_FAILED })}\n\n`);
      res.end();
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
