import { describe, expect, it } from "vitest";
import { PROFILE_SECRET_FIELDS, redactProfileSecrets } from "../src/redact";

// Pure test — no emulator needed. Locks the invariant that the GDPR export
// (gdpr.ts) and admin user-inspector (admin-ops.ts), which both call this,
// can never ship a profile's bearer secrets.
describe("redactProfileSecrets", () => {
  it("strips every secret field, preserves everything else", () => {
    const profile = {
      displayName: "Test",
      goalCalories: 2000,
      unitSystem: "us",
      webhookApiKey: "wk_live_supersecret",
      fcmToken: "device-push-token-abc",
    };
    const safe = redactProfileSecrets(profile);
    expect(safe).toEqual({ displayName: "Test", goalCalories: 2000, unitSystem: "us" });
    for (const field of PROFILE_SECRET_FIELDS) {
      expect(safe).not.toHaveProperty(field);
    }
  });

  it("does not mutate the input profile", () => {
    const profile = { a: 1, webhookApiKey: "x" };
    redactProfileSecrets(profile);
    expect(profile.webhookApiKey).toBe("x");
  });

  it("passes null / undefined through as null", () => {
    expect(redactProfileSecrets(null)).toBeNull();
    expect(redactProfileSecrets(undefined)).toBeNull();
  });

  it("returns a plain object when no secrets are present", () => {
    expect(redactProfileSecrets({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it("keeps a falsy-but-present non-secret field", () => {
    expect(redactProfileSecrets({ streak: 0, webhookApiKey: "x" })).toEqual({ streak: 0 });
  });
});
