import { describe, expect, it } from "vitest";
import { MAX_PER_EMAIL, normalizeEmail, withinBudget } from "../src/password-reset";

// `withinBudget` talks to Firestore, so this suite needs the emulator the
// `npm test` wrapper boots. `normalizeEmail` is pure.

describe("normalizeEmail", () => {
  it("lowercases and trims", () => {
    expect(normalizeEmail("  Ada@Example.COM  ")).toBe("ada@example.com");
  });

  it("accepts ordinary addresses", () => {
    for (const ok of [
      "a@b.co",
      "first.last+tag@sub.example.com",
      "user_name@example-domain.io",
    ]) {
      expect(normalizeEmail(ok)).toBe(ok.toLowerCase());
    }
  });

  it("rejects non-strings and empty input", () => {
    for (const bad of [null, undefined, 42, {}, [], "", "   "]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("rejects malformed addresses", () => {
    for (const bad of ["nodomain", "no@tld", "@example.com", "a b@example.com", "a@b"]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("rejects header-injection attempts", () => {
    // Newlines or angle brackets reaching a mail API are how a naive
    // implementation grows a Bcc: it never intended to send.
    for (const bad of [
      "victim@example.com\nBcc: everyone@example.com",
      "victim@example.com\r\nSubject: spam",
      "a<b>@example.com",
      'a"b@example.com',
      "a,b@example.com",
      "a;b@example.com",
    ]) {
      expect(normalizeEmail(bad)).toBeNull();
    }
  });

  it("rejects absurdly long input", () => {
    expect(normalizeEmail("a".repeat(250) + "@example.com")).toBeNull();
  });
});

describe("withinBudget", () => {
  // Unique per run so repeated local runs don't inherit a spent window.
  const key = (n: string) => `test_${n}_${Math.random().toString(36).slice(2, 10)}`;

  it("allows exactly `max` calls, then blocks", async () => {
    const k = key("cap");
    for (let i = 0; i < MAX_PER_EMAIL; i++) {
      expect(await withinBudget(k, MAX_PER_EMAIL)).toBe(true);
    }
    expect(await withinBudget(k, MAX_PER_EMAIL)).toBe(false);
    // Still blocked — a blocked attempt must not reset the window.
    expect(await withinBudget(k, MAX_PER_EMAIL)).toBe(false);
  });

  it("tracks keys independently", async () => {
    const a = key("a");
    const b = key("b");
    for (let i = 0; i < MAX_PER_EMAIL; i++) await withinBudget(a, MAX_PER_EMAIL);
    expect(await withinBudget(a, MAX_PER_EMAIL)).toBe(false);
    // A different address (or IP) is unaffected by another's exhaustion.
    expect(await withinBudget(b, MAX_PER_EMAIL)).toBe(true);
  });

  it("respects a per-axis limit of 1", async () => {
    const k = key("one");
    expect(await withinBudget(k, 1)).toBe(true);
    expect(await withinBudget(k, 1)).toBe(false);
  });
});
