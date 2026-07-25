import { createHash } from "node:crypto";
import { getAuth } from "firebase-admin/auth";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { db } from "./init";
import { ErrorCode } from "./error-codes";
import {
  getResend,
  baseSendOptions,
  transactionalSendOptions,
  resendApiKey,
} from "./resend-client";
import { passwordResetEmail } from "./email-templates";

/**
 * Owned password-reset mail.
 *
 * Firebase Auth's built-in `sendPasswordResetEmail` sends from
 * `noreply@<project>.firebaseapp.com` with a template we cannot brand. That
 * From-domain is unaligned with ignia.fit, so it fails DMARC alignment and
 * reads as third-party mail to filters. Here we generate the same action
 * link server-side and deliver it ourselves through Resend, which gives us
 * both DKIM alignment on our own domain and full control of the HTML.
 *
 * ─── Security properties ──────────────────────────────────────────
 *
 * This endpoint is UNAUTHENTICATED by necessity — someone who has lost
 * their password cannot present a token. That makes it the most exposed
 * surface in the codebase, so it is built to three rules:
 *
 *  1. NOT AN ENUMERATION ORACLE. The response is `{ ok: true }` for every
 *     syntactically valid email, whether or not an account exists and
 *     whether or not delivery succeeded. The only non-ok responses are for
 *     malformed input and rate limiting, neither of which is a function of
 *     account existence. (A determined attacker could still attempt a
 *     timing side-channel on the existing-vs-missing branch; at 3 requests
 *     per hour per address, behind Cloud Functions' own latency variance,
 *     that channel is not practically exploitable.)
 *
 *  2. NOT A SPAM RELAY. Rate limited on two independent axes — the target
 *     address and the caller's IP — so neither a single victim can be
 *     mail-bombed nor a single host used to spray many addresses.
 *
 *  3. NO EMAIL IN LOGS. Cloud Logging is 30-day retained and visible to
 *     every project collaborator; the rest of this codebase deliberately
 *     logs uids only. Here there is no uid to log (the caller is
 *     anonymous), so diagnostics use a truncated SHA-256 of the address —
 *     enough to correlate repeat attempts, useless for recovering the
 *     address itself.
 */

// Fixed-window limits. Deliberately generous enough that a real person who
// mistypes their address twice is never blocked, tight enough that the
// endpoint is worthless as a mail cannon.
const WINDOW_MS = 60 * 60 * 1000; // 1 hour
export const MAX_PER_EMAIL = 3;
export const MAX_PER_IP = 10;

/** Where the user lands after Firebase's handler accepts the new password. */
const CONTINUE_URL = process.env.MACROLOG_RESET_CONTINUE_URL || "https://ignia.fit/app";

const RATE_LIMIT_COLLECTION = "emailRateLimits";

/** Truncated digest — a stable correlation handle that is not the address. */
function tag(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

/**
 * Deliberately conservative. This is a gate on who we will *attempt* to mail,
 * not an RFC 5322 parser: anything it rejects would have failed delivery
 * anyway, and being strict here shrinks the surface for header injection.
 */
const EMAIL_RE = /^[^\s@<>"';,]{1,64}@[^\s@<>"';,]{1,255}\.[a-z]{2,}$/i;

export function normalizeEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (email.length < 6 || email.length > 254) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/**
 * Fixed-window counter in a transaction. Returns true when the caller is
 * still within budget. Fails OPEN on an unexpected Firestore error: a
 * transient datastore blip must not lock every user out of account
 * recovery. The two axes together still bound the blast radius.
 */
export async function withinBudget(key: string, max: number): Promise<boolean> {
  const ref = db.collection(RATE_LIMIT_COLLECTION).doc(key);
  const now = Date.now();
  try {
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.data();
      const startedAt = (data?.["windowStartedAt"] as Timestamp | undefined)?.toMillis() ?? 0;
      const count = (data?.["count"] as number | undefined) ?? 0;

      if (!snap.exists || now - startedAt >= WINDOW_MS) {
        tx.set(ref, {
          count: 1,
          windowStartedAt: Timestamp.fromMillis(now),
          // TTL anchor: point a Firestore TTL policy at `expiresAt` so
          // these rows self-evict instead of accumulating forever.
          expiresAt: Timestamp.fromMillis(now + 2 * WINDOW_MS),
        });
        return true;
      }
      if (count >= max) return false;
      tx.update(ref, { count: FieldValue.increment(1) });
      return true;
    });
  } catch (err) {
    console.error(`sendPasswordReset: rate-limit read failed for key=${key}`, err);
    return true; // fail open — see doc comment
  }
}

export interface SendPasswordResetRequest {
  email: string;
  locale?: string;
}

export interface SendPasswordResetResponse {
  ok: true;
}

export const sendPasswordReset = onCall<SendPasswordResetRequest, Promise<SendPasswordResetResponse>>(
  // `maxInstances` is the backstop the per-key rate limits can't provide: those
  // bound one address and one IP, but a distributed spray across many of both
  // would still fan out instances (and burn Resend quota) without a ceiling.
  // Password resets are inherently low-volume, so a small cap costs nothing
  // real and bounds the blast radius of abuse. Matches the gdpr.ts precedent.
  // Never set `minInstances` here — idle warm cost, see CLAUDE.md.
  { secrets: [resendApiKey], maxInstances: 5 },
  async (request: CallableRequest<SendPasswordResetRequest>): Promise<SendPasswordResetResponse> => {
    const email = normalizeEmail(request.data?.email);
    if (!email) {
      // Syntactic rejection only — reveals nothing about account existence.
      throw new HttpsError("invalid-argument", "A valid email address is required.", {
        code: ErrorCode.BAD_REQUEST,
      });
    }

    const locale: "en" | "es-PR" = request.data?.locale === "es-PR" ? "es-PR" : "en";
    const emailTag = tag(email);
    const ip = request.rawRequest?.ip || "unknown";

    const [emailOk, ipOk] = await Promise.all([
      withinBudget(`pw_email_${tag(email)}`, MAX_PER_EMAIL),
      withinBudget(`pw_ip_${tag(ip)}`, MAX_PER_IP),
    ]);
    if (!emailOk || !ipOk) {
      console.warn(
        `sendPasswordReset: rate limited emailTag=${emailTag} axis=${!emailOk ? "email" : "ip"}`,
      );
      throw new HttpsError("resource-exhausted", "Too many reset requests. Try again later.", {
        code: ErrorCode.RATE_LIMITED,
      });
    }

    // Everything from here on is best-effort and MUST resolve to ok:true.
    try {
      const auth = getAuth();

      // Fetched for personalisation only. Absent user => user-not-found,
      // which we swallow along with every other failure below.
      const user = await auth.getUserByEmail(email);

      // A SSO-only account (Google / Apple) has no password credential to
      // reset. Firebase would still mint a link, and following it would
      // silently attach a password to an account whose owner never chose
      // one — so treat it as a no-op instead.
      const hasPassword = user.providerData.some((p) => p.providerId === "password");
      if (!hasPassword) {
        console.log(`sendPasswordReset: no password provider emailTag=${emailTag} — skipped`);
        return { ok: true };
      }

      const link = await auth.generatePasswordResetLink(email, {
        url: CONTINUE_URL,
        handleCodeInApp: false,
      });

      const { subject, html, text } = passwordResetEmail({
        locale,
        resetLink: link,
        displayName: user.displayName ?? null,
      });

      const resend = getResend();
      const { error } = await resend.emails.send({
        ...baseSendOptions(),
        ...transactionalSendOptions(),
        to: email,
        subject,
        html,
        text,
      });
      if (error) {
        console.error(`sendPasswordReset: Resend error emailTag=${emailTag}`, error);
        return { ok: true };
      }
      console.log(`sendPasswordReset: sent emailTag=${emailTag} locale=${locale}`);
    } catch (err) {
      const code = (err as { code?: string } | null)?.code;
      if (code === "auth/user-not-found") {
        // The expected miss. Logged at debug volume so a spike in
        // enumeration attempts is still visible to an operator.
        console.log(`sendPasswordReset: no account emailTag=${emailTag}`);
      } else {
        console.error(`sendPasswordReset: unexpected failure emailTag=${emailTag}`, err);
      }
    }

    return { ok: true };
  },
);
