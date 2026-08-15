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
// `mail.ignia.fit` is a VERIFIED Resend sending domain (created 2026-07-24,
// `status: "verified"`, `sending: "enabled"`), its DKIM + SPF records are
// published in Cloudflare and DMARC `p=none` is on the apex — so mail from
// this address is DMARC-aligned. See `docs/email-deliverability.md`.
//
// This used to default to `onboarding@resend.dev`, Resend's SHARED SANDBOX
// domain, on the reasoning that the real domain was not verified yet. It
// verified on 2026-07-24 and the default was never moved, so for three weeks
// every welcome, password-reset and weekly-digest mail went out unaligned
// with ignia.fit and carrying the reputation of every other developer
// testing on that sandbox. Do not reintroduce a sandbox fallback: an
// unverified sender fails LOUD at Resend (a rejected send), which is a far
// better failure than silently landing every message in spam.
//
// `MACROLOG_EMAIL_FROM` still overrides, for staging or a domain change.
const FROM_FALLBACK = "Ignia <hello@mail.ignia.fit>";
const SANDBOX_SENDER = "Ignia <onboarding@resend.dev>";
const FROM_ENV = process.env.MACROLOG_EMAIL_FROM;
export const FROM_EMAIL = FROM_ENV && FROM_ENV.length > 0 ? FROM_ENV : FROM_FALLBACK;

/** True when we are sending from Resend's shared sandbox domain. */
export const IS_SANDBOX_SENDER = FROM_EMAIL === SANDBOX_SENDER;

// Reply-To is a real human mailbox on purpose: a monitored reply address is
// a positive reputation signal, and the welcome mail invites replies.
// TODO(owner): this defaults to a personal Gmail that is committed to the
// repo. The obvious tidy-up — `hello@ignia.fit` — would BLACK-HOLE every
// reply: the apex publishes no MX record, so there is nowhere for inbound
// mail to land, and a reply-to that bounces is worse for reputation than a
// Gmail that works. Moving it needs inbound mail to exist first (an MX, or
// a forwarder), not just a better-looking address.
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
