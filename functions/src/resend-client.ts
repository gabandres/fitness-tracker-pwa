import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";

// `defineSecret` returns a `SecretParam` whose type lives at
// firebase-functions/lib/params/types — not a public module path, which
// makes the inferred export unportable under `declaration: true`. Annotate
// explicitly with `ReturnType<typeof defineSecret>` so downstream imports
// (index.ts uses it for `secrets: [resendApiKey]`) stay resolvable.
export const resendApiKey: ReturnType<typeof defineSecret> = defineSecret("RESEND_API_KEY");

// ─── Sending identity ───────────────────────────────────────────────
//
// DELIVERABILITY: the From-domain is the single biggest lever we have.
// While this falls back to `onboarding@resend.dev` — Resend's shared
// sandbox domain — every message we send is unaligned with ignia.fit,
// fails DMARC alignment, and inherits the reputation of every other
// developer testing on that sandbox. No amount of DNS work on ignia.fit
// helps until the From-domain is ours.
//
// The fix is a verified `mail.ignia.fit` sending domain in Resend, then:
//   firebase functions:config unset  # (not used here — env, not config)
//   Set MACROLOG_EMAIL_FROM="Ignia <hello@mail.ignia.fit>" on the
//   functions runtime and redeploy.
//
// Blocked at time of writing: the Resend account is on the free plan,
// which allows exactly ONE domain, and it is already spent on an
// unrelated project. See `docs/email-deliverability.md` for the full
// runbook and the DNS records to publish.
//
// Flipping this env before the domain verifies fails LOUD — Resend
// rejects sends from an unverified domain — rather than silently
// landing everything in spam. That is the desired failure mode.
const FROM_FALLBACK = "Ignia <onboarding@resend.dev>";
const FROM_ENV = process.env.MACROLOG_EMAIL_FROM;
export const FROM_EMAIL = FROM_ENV && FROM_ENV.length > 0 ? FROM_ENV : FROM_FALLBACK;

/** True when we are still sending from Resend's shared sandbox domain. */
export const IS_SANDBOX_SENDER = FROM_EMAIL === FROM_FALLBACK;

// Reply-To is a real human mailbox on purpose: a monitored reply address is
// a positive reputation signal, and the welcome mail invites replies.
// TODO(owner): this defaults to a personal Gmail that is committed to the
// repo. Once mail.ignia.fit verifies, set MACROLOG_EMAIL_REPLY_TO to a
// domain address (e.g. hello@ignia.fit) and forward it wherever you like.
const REPLY_TO_FALLBACK = "gabrielandresbermudez@gmail.com";
const REPLY_TO_ENV = process.env.MACROLOG_EMAIL_REPLY_TO;
export const REPLY_TO =
  REPLY_TO_ENV && REPLY_TO_ENV.length > 0 ? REPLY_TO_ENV : REPLY_TO_FALLBACK;

export function getResend(): Resend {
  const key = resendApiKey.value();
  if (!key) {
    throw new Error("RESEND_API_KEY secret is not configured");
  }
  return new Resend(key);
}

// ─── Headers ────────────────────────────────────────────────────────
//
// Two header sets, because the two classes of mail have different consent
// models and mixing them is a real deliverability mistake:
//
//   LIFECYCLE (welcome, weekly digest) — the recipient opted into being
//   contacted. RFC 8058 one-click unsubscribe is expected here; Gmail and
//   Yahoo's bulk-sender rules effectively require it, and its absence is
//   treated as a soft spam signal.
//
//   TRANSACTIONAL (password reset) — account security mail that the
//   recipient asked for by acting, seconds ago, and cannot opt out of.
//   Advertising an unsubscribe on it is incoherent: an unsubscribe click
//   would either do nothing or lock someone out of account recovery.
//   Filters do not penalise its absence on genuinely transactional mail.

/** One-click unsubscribe (RFC 8058) — lifecycle mail only. */
export function emailHeaders(): Record<string, string> {
  return {
    "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Default send options for lifecycle mail. Spread first, so a caller can
 * override any single field.
 */
export function baseSendOptions() {
  return {
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    headers: emailHeaders(),
  };
}

/**
 * Override layer for transactional mail. Spread AFTER `baseSendOptions()`
 * — it replaces `headers` wholesale, dropping the unsubscribe pair.
 *
 * `Auto-Submitted` marks the message as machine-generated (RFC 3834) so
 * well-behaved autoresponders and vacation replies stay quiet, which keeps
 * our bounce/complaint signal clean.
 */
export function transactionalSendOptions() {
  return {
    headers: {
      "Auto-Submitted": "auto-generated",
      "X-Auto-Response-Suppress": "OOF, AutoReply",
    } as Record<string, string>,
  };
}
