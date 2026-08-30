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
