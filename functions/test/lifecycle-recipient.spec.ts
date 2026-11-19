import { describe, expect, it } from "vitest";
import { lifecycleRecipient } from "../src/lifecycle-recipient";

/**
 * The one rule every lifecycle sender (welcome, day-1 nudge, weekly digest)
 * applies to its recipient. Since 2026-11-19 an unverified account can own a
 * profile, complete onboarding and log, so each of those senders now meets
 * unverified accounts and must skip them.
 */
describe("lifecycleRecipient", () => {
  it("returns the Auth-record address of a verified, enabled account", () => {
    expect(lifecycleRecipient({ email: "a@example.com", emailVerified: true, disabled: false })).toBe("a@example.com");
  });

  it("skips an unverified account", () => {
    expect(lifecycleRecipient({ email: "a@example.com", emailVerified: false, disabled: false })).toBeNull();
  });

  it("skips when the verified flag is missing (only `true` passes)", () => {
    expect(lifecycleRecipient({ email: "a@example.com" })).toBeNull();
  });

  it("skips a disabled account even when verified", () => {
    expect(lifecycleRecipient({ email: "a@example.com", emailVerified: true, disabled: true })).toBeNull();
  });

  it("skips an account with no email, and a missing record", () => {
    expect(lifecycleRecipient({ email: null, emailVerified: true })).toBeNull();
    expect(lifecycleRecipient({ emailVerified: true })).toBeNull();
    expect(lifecycleRecipient(null)).toBeNull();
    expect(lifecycleRecipient(undefined)).toBeNull();
  });
});
