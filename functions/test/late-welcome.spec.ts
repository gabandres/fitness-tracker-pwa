import { describe, expect, it } from "vitest";
import { lateWelcomeCandidate, lateWelcomeNewAccount, lateWelcomeWindow } from "../src/late-welcome";

/**
 * UX_AUDIT S24-1b (2026-11-20): an account that finishes onboarding before it
 * verifies gets no welcome from the trigger, so an hourly sweep sends it once
 * the address is verified. These pin who the sweep even looks at; the Auth
 * check itself is `lifecycleRecipient` (its own spec).
 */
describe("lateWelcomeCandidate", () => {
  const base = { profileCompleted: true };

  it("is a completed profile with no welcome sent", () => {
    expect(lateWelcomeCandidate(base)).toBe(true);
  });

  it("is never an account already welcomed, half-onboarded, seeded or opted out", () => {
    expect(lateWelcomeCandidate({ ...base, welcomeEmailSentAt: new Date() })).toBe(false);
    expect(lateWelcomeCandidate({ profileCompleted: false })).toBe(false);
    expect(lateWelcomeCandidate({})).toBe(false);
    expect(lateWelcomeCandidate({ ...base, syntheticAccount: true })).toBe(false);
    expect(lateWelcomeCandidate({ ...base, weeklyDigestOptIn: false })).toBe(false);
  });

  it("does not need the opt-in to be set: lifecycle mail is opt-out", () => {
    expect(lateWelcomeCandidate({ ...base, weeklyDigestOptIn: true })).toBe(true);
  });
});

describe("lateWelcomeWindow", () => {
  it("leaves the first half hour to the trigger and stops after 14 days", () => {
    const now = Date.UTC(2026, 10, 20, 12, 0, 0);
    const { fromMs, toMs } = lateWelcomeWindow(now);
    expect(now - toMs).toBe(30 * 60 * 1000);
    expect(now - fromMs).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe("lateWelcomeNewAccount", () => {
  const now = Date.UTC(2026, 10, 20, 12, 0, 0);

  it("is an account created inside the 14 days", () => {
    expect(lateWelcomeNewAccount("Mon, 16 Nov 2026 15:00:00 GMT", now)).toBe(true);
  });

  it("is not an old account that went through onboarding again, nor an unreadable date", () => {
    expect(lateWelcomeNewAccount("Sat, 01 Aug 2026 10:00:00 GMT", now)).toBe(false);
    expect(lateWelcomeNewAccount(undefined, now)).toBe(false);
    expect(lateWelcomeNewAccount("not a date", now)).toBe(false);
  });
});
