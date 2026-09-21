import { getAuth } from "firebase-admin/auth";
import { onCall, HttpsError, type CallableRequest } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";
import { brandActionLink } from "./auth-links";
import { withinBudget } from "./password-reset";
import {
  getResend,
  baseSendOptions,
  transactionalSendOptions,
  resendApiKey,
} from "./resend-client";
import { emailLocale } from "./locales";
import { verifyEmailEmail } from "./email-templates";

/**
 * Owned email-verification mail.
 *
 * ─── Why this exists ──────────────────────────────────────────────
 *
 * Both clients used to call the SDK's `sendEmailVerification`, which has
 * Firebase send the message from `noreply@<project>.firebaseapp.com`. That
 * From-domain cannot be DMARC-aligned with ignia.fit — alignment compares the
 * From domain against the DKIM `d=`, so no record published on ignia.fit can
 * help it — and a user reported exactly the predicted outcome on 2026-08-14:
 * the verification mail landed in junk.
 *
 * The usual fix is Firebase Auth's custom-SMTP setting, pointed at Resend.
 * **It is not available on this project.** Every write to
 * `notification.sendEmail` is refused with `EMAIL_TEMPLATE_UPDATE_NOT_ALLOWED`,
 * including a single-field one, because `emailPrivacyConfig
 * .enableImprovedEmailPrivacy` is on. Turning that off to unlock the setting
 * would trade a real security property (email-enumeration protection) for a
 * deliverability fix that this file provides without giving anything up.
 *
 * So the link is generated server-side and delivered through Resend from our
 * own verified domain, exactly as `password-reset.ts` already does — same
 * templates, same headers, same rate-limit machinery.
 *
 * ─── Security properties ──────────────────────────────────────────
 *
 * Unlike `sendPasswordReset`, this endpoint is AUTHENTICATED, which makes it a
 * far smaller surface:
 *
 *  1. NOT AN ENUMERATION ORACLE, trivially: the address is read from the auth
 *     token, never from the request body. A caller cannot ask us to mail an
 *     address they do not already control the session for.
 *  2. NOT A SPAM RELAY. Rate limited per uid. There is no IP axis because
 *     there is no anonymous caller to bound — an attacker would need a valid
 *     session per address they wanted to mail.
 *  3. NO EMAIL IN LOGS. There is a uid here, so diagnostics log the uid, which
 *     is what the rest of the codebase does.
 *
 * Already-verified callers are a no-op: re-verification is meaningless, and
 * honouring it would let a signed-in user mail themselves without limit.
 */

/** Deliberately generous — a real person who mistypes and retries is never blocked. */
export const MAX_PER_USER = 5;

/**
 * Firebase Auth's OWN throttle on link generation — separate from, and much
 * tighter than, `MAX_PER_USER` above.
 *
 * Observed in production 2026-09-14: a new account signed up (which mails a
 * link automatically) and tapped "Resend" eight seconds later. Our budget
 * allows five, so the second call sailed straight past it into
 * `generateEmailVerificationLink`, which answered `400
 * TOO_MANY_ATTEMPTS_TRY_LATER`. With nothing to catch that, it fell to the
 * generic `internal` below — an HTTP 500 in the logs, and
 * `verify.resendFailed` ("Couldn't resend the email. Try again.") on screen,
 * shown to a user whose email had in fact just gone out. Both halves were
 * wrong: nothing had failed, and trying again immediately is the one action
 * that keeps it failing.
 *
 * The Admin SDK does not surface this as `auth/too-many-requests`. It masks it
 * as `auth/internal-error` and leaves the Identity Toolkit's status token in
 * the raw message, so the token is what we match — both spellings, because the
 * masking is the SDK's choice and not a contract.
 *
 * Matching a string is right here, unlike `isProviderExhausted` in
 * `analyze-photo.ts` which deliberately refuses to: `TOO_MANY_ATTEMPTS_TRY_LATER`
 * is a server error ENUM, not human prose someone can reword.
 */
export function isAuthThrottled(err: unknown): boolean {
  if (err == null) return false;
  if (typeof err === "string") return err.includes("TOO_MANY_ATTEMPTS_TRY_LATER");
  if (typeof err !== "object") return false;
  const e = err as {
    code?: unknown;
    message?: unknown;
    errorInfo?: { code?: unknown; message?: unknown } | null;
  };
  if (e.code === "auth/too-many-requests" || e.errorInfo?.code === "auth/too-many-requests") {
    return true;
  }
  return [e.message, e.errorInfo?.message].some(
    (m) => typeof m === "string" && m.includes("TOO_MANY_ATTEMPTS_TRY_LATER"),
  );
}

/** Where the user lands after Firebase's handler accepts the code. */
const CONTINUE_URL = process.env.MACROLOG_VERIFY_CONTINUE_URL || "https://ignia.fit/";

export interface SendVerificationEmailRequest {
  locale?: string;
}

export interface SendVerificationEmailResponse {
  ok: true;
  /** True when the address was already verified and nothing was sent. */
  alreadyVerified?: boolean;
}

export const sendVerificationEmail = onCall<
  SendVerificationEmailRequest,
  Promise<SendVerificationEmailResponse>
>(
  // Matches the sendPasswordReset precedent: a small ceiling bounds the blast
  // radius of abuse, and verification mail is inherently low-volume.
  // Never set `minInstances` — idle warm cost, see CLAUDE.md.
  { secrets: [resendApiKey], maxInstances: 5 },
  async (
    request: CallableRequest<SendVerificationEmailRequest>,
  ): Promise<SendVerificationEmailResponse> => {
    const uid = request.auth?.uid;
    if (!uid) {
      throw new HttpsError("unauthenticated", "Sign in first.", {
        code: ErrorCode.UNAUTHENTICATED,
      });
    }

    const locale = emailLocale(request.data?.locale);

    if (!(await withinBudget(`verify_uid_${uid}`, MAX_PER_USER))) {
      console.warn(`sendVerificationEmail: rate limited uid=${uid}`);
      throw new HttpsError("resource-exhausted", "Too many requests. Try again later.", {
        code: ErrorCode.RATE_LIMITED,
      });
    }

    const auth = getAuth();
    const user = await auth.getUser(uid);

    // The address comes from the record, never from the request body.
    const email = user.email;
    if (!email) {
      // An SSO account with no email (or Apple's Hide My Email in a shape we
      // cannot mail) has nothing to verify.
      console.log(`sendVerificationEmail: no email on record uid=${uid} — skipped`);
      return { ok: true };
    }

    if (user.emailVerified) {
      return { ok: true, alreadyVerified: true };
    }

    // Unlike the reset path, a failure here MUST surface. A user staring at
    // the verification wall needs to know the mail did not go out, so this
    // deliberately does not swallow errors into a cheerful ok:true.
    let link: string;
    try {
      link = brandActionLink(
        await auth.generateEmailVerificationLink(email, {
          url: CONTINUE_URL,
          handleCodeInApp: false,
        }),
      );
    } catch (err) {
      if (isAuthThrottled(err)) {
        // Not a crash, and not worth alarming anyone with: a link went out
        // moments ago. A typed `resource-exhausted` is the DESIGNED rejection
        // path (CLAUDE.md / the triage skill: a typed HttpsError is not an
        // outage), and it also demotes the request log from ERROR to WARNING,
        // where this belongs.
        console.warn(
          `sendVerificationEmail: auth throttled uid=${uid} — a link was already sent recently`,
        );
        throw new HttpsError("resource-exhausted", "A verification email was just sent.", {
          code: ErrorCode.RATE_LIMITED,
        });
      }
      console.error(`sendVerificationEmail: link generation failed uid=${uid}`, err);
      throw new HttpsError("internal", "Could not send the verification email.", {
        code: ErrorCode.VERIFY_EMAIL_FAILED,
      });
    }

    const { subject, html, text } = verifyEmailEmail({
      locale,
      verifyLink: link,
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
      console.error(`sendVerificationEmail: Resend error uid=${uid}`, error);
      throw new HttpsError("internal", "Could not send the verification email.", {
        code: ErrorCode.VERIFY_EMAIL_FAILED,
      });
    }

    console.log(`sendVerificationEmail: sent uid=${uid} locale=${locale}`);
    return { ok: true };
  },
);
