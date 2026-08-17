import { describe, expect, it } from "vitest";
import {
  unsubscribeToken,
  unsubscribeUrl,
  verifyUnsubscribeToken,
} from "../src/unsubscribe";

// Pure crypto — no emulator, no secret. The value of these assertions is that
// the unsubscribe endpoint's ONLY authorisation is this token: if minting and
// verifying ever disagree, every unsubscribe click silently lands on the
// "we couldn't read that link" page, which looks like a broken email rather
// than a broken function.

const KEY = "re_test_0000000000000000";
const UID = "xFm6lDvP7eSQdayrXqkVuHVRYIM2"; // 28 chars, real Firebase shape.

describe("unsubscribe token", () => {
  it("round-trips the uid", () => {
    expect(verifyUnsubscribeToken(unsubscribeToken(UID, KEY), KEY)).toBe(UID);
  });

  it("is deterministic — the same uid always yields the same link", () => {
    // Links live in inboxes forever; a token that changed per send would make
    // every older copy of the mail dead.
    expect(unsubscribeToken(UID, KEY)).toBe(unsubscribeToken(UID, KEY));
  });

  it("rejects a token signed under a different key", () => {
    const token = unsubscribeToken(UID, KEY);
    expect(verifyUnsubscribeToken(token, "re_other_000000000000000")).toBeNull();
  });

  it("rejects a swapped uid — you cannot unsubscribe someone else", () => {
    const token = unsubscribeToken(UID, KEY);
    const forged = token.replace(UID, "AAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(verifyUnsubscribeToken(forged, KEY)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const token = unsubscribeToken(UID, KEY);
    const dot = token.lastIndexOf(".");
    const sig = token.slice(dot + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyUnsubscribeToken(`${token.slice(0, dot)}.${flipped}`, KEY)).toBeNull();
  });

  it("rejects malformed input without throwing", () => {
    // `timingSafeEqual` throws on a length mismatch — a caller must never be
    // able to turn a junk query string into a 500.
    for (const junk of ["", ".", "nodot", `${UID}.`, `.${UID}`, "a.b", `${UID}.!!!!`]) {
      expect(() => verifyUnsubscribeToken(junk, KEY)).not.toThrow();
      expect(verifyUnsubscribeToken(junk, KEY)).toBeNull();
    }
  });

  it("never embeds the API key itself", () => {
    const token = unsubscribeToken(UID, KEY);
    expect(token).not.toContain(KEY);
    expect(token).not.toContain(KEY.slice(3));
  });

  it("builds an https URL — RFC 8058 one-click accepts nothing else", () => {
    const url = unsubscribeUrl(UID, KEY);
    expect(url.startsWith("https://")).toBe(true);
    const token = new URL(url).searchParams.get("u");
    expect(token).not.toBeNull();
    expect(verifyUnsubscribeToken(token!, KEY)).toBe(UID);
  });
});
