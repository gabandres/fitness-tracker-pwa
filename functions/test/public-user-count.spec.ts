import { describe, expect, it, vi } from "vitest";

// ops.ts pulls in the Firestore admin client and the scheduler at import;
// only the pure rule is under test here.
vi.mock("../src/init", () => ({ db: {} }));
vi.mock("firebase-functions/v2/scheduler", () => ({ onSchedule: () => ({}) }));

import { isPublicUser } from "../src/ops";

/**
 * UX_AUDIT S24-1c (owner, 2026-11-20): the public "N quiet loggers" number
 * counts verified accounts only, now that an unverified one can own a profile.
 */
describe("isPublicUser", () => {
  it("counts a verified, enabled account", () => {
    expect(isPublicUser({ emailVerified: true, disabled: false })).toBe(true);
    expect(isPublicUser({ emailVerified: true })).toBe(true);
  });

  it("does not count an unverified or a disabled one", () => {
    expect(isPublicUser({ emailVerified: false })).toBe(false);
    expect(isPublicUser({})).toBe(false);
    expect(isPublicUser({ emailVerified: true, disabled: true })).toBe(false);
  });
});
