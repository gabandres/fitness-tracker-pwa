import { defineSecret } from "firebase-functions/params";
// TYPE-ONLY on purpose — see `getResend()` for why the value is required lazily.
import type { Resend } from "resend";

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
//
// This defaults to a personal Gmail that is committed to the repo, and the
// obvious tidy-up — `support@ignia.fit` — would BLACK-HOLE every reply
// today: **the apex publishes no MX record** (re-verified 2026-08-23,
// `nslookup -type=MX ignia.fit` falls through to SOA), so there is nowhere
// for inbound mail to land, and a reply-to that bounces costs more
// reputation than a Gmail that works. Moving it needs inbound mail to
// EXIST first, not just a better-looking address.
//
// What was missed until 2026-08-23: **the zone is already on Cloudflare
// nameservers** (`dilbert`/`sunny.ns.cloudflare.com`). So Cloudflare Email
// Routing gives real inbound on the apex for free, with no nameserver
// migration and no edit to any existing record — it only ADDS MX, and
// there is no MX to conflict with. That is the cheap half of the problem,
// and it was never cheap-looking because the same option is genuinely
// expensive on `bermudezsystems.com`, whose zone is NOT on Cloudflare
// (see `STATUS.md` §3 — do not carry that objection across; the two
// domains are in different positions).
//
// **DONE 2026-08-23, and verified by sending rather than by reading a
// dashboard.** Cloudflare Email Routing is on, and this was proven the hard
// way: the FIRST probe to `support@ignia.fit` hard-bounced with
// `550 5.1.1 Address does not exist` — the MX records were live and
// answering while the routing RULE did not yet exist, which is a state that
// looks completely finished from the DNS side. A second probe, after the
// rule was created, was accepted, and a real message from
// `gabriel@bermudezsystems.com` arrived. "It is configured" is not
// evidence — that same phrase was in this repo about the
// `bermudezsystems.com` forward for months while it had never been created,
// which is how the first real piece of in-app feedback went unread.
//
// One caveat worth keeping. **Forwarded mail can land in junk, and that is a
// property of the SENDER, not of the route.** The verification message came
// from `bermudezsystems.com`, which publishes DMARC `p=quarantine` and is
// not DKIM-signed by Northwest — so forwarding breaks its SPF and
// `p=quarantine` does exactly what it says. A reply from an ordinary user
// mailbox does not have that problem: Gmail, iCloud and Outlook all
// DKIM-sign, and DKIM survives a forward, so DMARC still aligns.
//
// The FROM address is a separate question and a harder one: sending as
// `support@ignia.fit` needs the APEX verified as a second Resend sending
// domain (DKIM + SPF at the apex, alongside Email Routing's SPF). It is
// not required for a working Reply-To, and `hello@mail.ignia.fit` is
// verified and DMARC-aligned — outbound-only by design, not by accident.
const REPLY_TO_FALLBACK = "support@ignia.fit";
const REPLY_TO_ENV = process.env.MACROLOG_EMAIL_REPLY_TO;
export const REPLY_TO =
  REPLY_TO_ENV && REPLY_TO_ENV.length > 0 ? REPLY_TO_ENV : REPLY_TO_FALLBACK;

/**
 * The Resend SDK, loaded on first use rather than at module scope.
 *
 * **This is a cold-start fix for functions that never send mail.** `init.ts`
 * imports this module, and every function imports `init.ts` — so a static
 * `import { Resend } from "resend"` was evaluated on the cold start of
 * `analyzePhoto`, `searchFoods`, `logWebhook` and everything else, none of
 * which send email. Measured in an isolated process on this workstation:
 * **79 ms**, and a cold Cloud Run vCPU is slower. Cold starts are the single
 * largest latency item in this codebase (~3.4 s of a 5.7 s photo scan, and at
 * this traffic level essentially every request pays one), so work that a
 * request cannot reach does not belong on that path.
 *
 * The type import above is erased at compile time and costs nothing, so the
 * signature stays honest. `require` rather than `await import` keeps this
 * function synchronous — making it async would ripple through every mail
 * caller for no gain, and the output is CommonJS, so `require` is the lazy
 * form here.
 */
export function getResend(): Resend {
  const key = resendApiKey.value();
  if (!key) {
    throw new Error("RESEND_API_KEY secret is not configured");
  }
  // Aliased rather than destructured to `Resend`: the type-only import above
  // already binds that name in this scope, and TS treats the collision as
  // "used as a value before it was imported as a type" (TS1361).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require("resend") as typeof import("resend");
  return new sdk.Resend(key);
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

/**
 * One-click unsubscribe (RFC 8058) — lifecycle mail only.
 *
 * `List-Unsubscribe-Post` is advertised **only** alongside an https URI,
 * because RFC 8058 §1 defines one-click against an https target and nothing
 * else. This pair used to ship with a `mailto:` alone, which is malformed: the
 * provider's Unsubscribe button mailed a human, the recipient stayed
 * subscribed, and the header claimed an automation that did not exist.
 *
 * The mailto is kept as the second URI — a real monitored mailbox is a
 * legitimate fallback for clients that prefer it — but it is no longer the
 * only one. `unsubscribe.ts` mints the https token per recipient.
 */
export function emailHeaders(unsubscribeUrl?: string): Record<string, string> {
  const mailto = `<mailto:${REPLY_TO}?subject=unsubscribe>`;
  if (!unsubscribeUrl) return { "List-Unsubscribe": mailto };
  return {
    // https first: clients pick the first URI they can action.
    "List-Unsubscribe": `<${unsubscribeUrl}>, ${mailto}`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

/**
 * Default send options for lifecycle mail. Spread first, so a caller can
 * override any single field. Pass the recipient's unsubscribe URL — omitting
 * it silently downgrades the mail to a mailto-only opt-out.
 */
export function baseSendOptions(unsubscribeUrl?: string) {
  return {
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    headers: emailHeaders(unsubscribeUrl),
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
