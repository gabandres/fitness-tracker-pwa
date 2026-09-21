/**
 * Telling "Firebase Auth throttled us" apart from "the send genuinely broke".
 *
 * This classifier exists because of a production event on 2026-09-14: a new
 * account signed up (which mails a verification link automatically) and tapped
 * "Resend" eight seconds later. Our own per-uid budget allows five, so the
 * second call went through to `generateEmailVerificationLink`, which answered
 * `400 TOO_MANY_ATTEMPTS_TRY_LATER`. That fell to the generic `internal`
 * branch — a 500 in the request log, and "Couldn't resend the email. Try
 * again." on screen, to a user whose email had just been sent.
 *
 * The first fixture is the SHAPE actually observed, copied from the Cloud
 * Functions log, not an invented one.
 */
import { describe, expect, it } from "vitest";
import { isAuthThrottled } from "../src/verify-email";

describe("isAuthThrottled", () => {
  it("catches the exact production error from 2026-09-14", () => {
    // Verbatim from the log: the Admin SDK masks the throttle as
    // `auth/internal-error` and leaves the real status in the raw body.
    const raw =
      'An internal error has occurred. Raw server response: "{"error":{"code":400,' +
      '"message":"TOO_MANY_ATTEMPTS_TRY_LATER","errors":[{"message":' +
      '"TOO_MANY_ATTEMPTS_TRY_LATER","domain":"global","reason":"invalid"}]}}"';
    const err = Object.assign(new Error(raw), {
      code: "auth/internal-error",
      errorInfo: { code: "auth/internal-error", message: raw },
      codePrefix: "auth",
    });
    expect(isAuthThrottled(err)).toBe(true);
  });

  it("catches the unmasked spelling too", () => {
    // Nothing promises the masking above stays. If the SDK ever surfaces the
    // documented code instead, the user-facing outcome must not change.
    expect(isAuthThrottled({ code: "auth/too-many-requests" })).toBe(true);
    expect(isAuthThrottled({ errorInfo: { code: "auth/too-many-requests" } })).toBe(true);
  });

  it("reads the token from errorInfo when the message is absent", () => {
    expect(isAuthThrottled({ errorInfo: { message: "TOO_MANY_ATTEMPTS_TRY_LATER" } })).toBe(true);
  });

  it("does NOT match a genuine send failure", () => {
    // The case where VERIFY_EMAIL_FAILED is honest and must survive: these
    // are real breakage and should stay a 500 that someone investigates.
    expect(isAuthThrottled(new Error("getaddrinfo ENOTFOUND api.resend.com"))).toBe(false);
    expect(isAuthThrottled({ code: "auth/user-not-found" })).toBe(false);
    expect(isAuthThrottled({ code: "auth/internal-error", message: "An internal error" })).toBe(
      false,
    );
  });

  it("survives the shapes a catch block really receives", () => {
    expect(isAuthThrottled(null)).toBe(false);
    expect(isAuthThrottled(undefined)).toBe(false);
    expect(isAuthThrottled(400)).toBe(false);
    expect(isAuthThrottled({ errorInfo: null })).toBe(false);
    expect(isAuthThrottled("TOO_MANY_ATTEMPTS_TRY_LATER")).toBe(true);
  });
});
