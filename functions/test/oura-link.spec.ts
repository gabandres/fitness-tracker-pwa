import { describe, expect, it } from "vitest";
import { mintOuraState, ouraAuthorizeUrl, verifyOuraState } from "../src/oura-link";

// Pure crypto — no emulator, no secret, no network.
//
// These assertions matter more than they look. The `state` parameter is the
// ONLY thing that tells `ouraCallback` which user an authorization belongs
// to: the callback is a bare browser redirect from Oura's servers with no
// Firebase session attached. So a break here is not "the link stops working"
// — it is either every link landing on the expired page, or, far worse, a
// forged state binding an attacker's ring to someone else's account.

const SECRET = "oura_test_secret_0000000000";
const UID = "xFm6lDvP7eSQdayrXqkVuHVRYIM2"; // 28 chars, real Firebase shape.
const NOW = 1_756_000_000_000;

describe("oura state token", () => {
  it("round-trips the uid", () => {
    expect(verifyOuraState(mintOuraState(UID, SECRET, NOW), SECRET, NOW)).toBe(UID);
  });

  it("rejects a state signed under a different client secret", () => {
    const state = mintOuraState(UID, SECRET, NOW);
    expect(verifyOuraState(state, "oura_other_secret_000000000", NOW)).toBeNull();
  });

  it("rejects a swapped uid — you cannot bind a ring to someone else", () => {
    // The whole point of signing rather than storing: an attacker who can
    // see their own state (it is in their own URL bar) must not be able to
    // edit the uid out of it.
    const state = mintOuraState(UID, SECRET, NOW);
    const forged = state.replace(UID, "AAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    expect(verifyOuraState(forged, SECRET, NOW)).toBeNull();
  });

  it("rejects a tampered signature", () => {
    const state = mintOuraState(UID, SECRET, NOW);
    const dot = state.lastIndexOf(".");
    const sig = state.slice(dot + 1);
    const flipped = (sig[0] === "A" ? "B" : "A") + sig.slice(1);
    expect(verifyOuraState(`${state.slice(0, dot)}.${flipped}`, SECRET, NOW)).toBeNull();
  });

  it("rejects a re-stamped issued-at — the timestamp is inside the signature", () => {
    // Naively the expiry could have been stored outside the MAC, which would
    // let anyone holding an old state slide its clock forward.
    const state = mintOuraState(UID, SECRET, NOW - 60 * 60 * 1000);
    const [uid, , sig] = state.split(".");
    expect(verifyOuraState(`${uid}.${NOW}.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("expires after 15 minutes", () => {
    const state = mintOuraState(UID, SECRET, NOW);
    expect(verifyOuraState(state, SECRET, NOW + 15 * 60 * 1000 - 1)).toBe(UID);
    expect(verifyOuraState(state, SECRET, NOW + 15 * 60 * 1000 + 1)).toBeNull();
  });

  it("rejects a state issued in the future beyond clock skew", () => {
    const state = mintOuraState(UID, SECRET, NOW + 10 * 60 * 1000);
    expect(verifyOuraState(state, SECRET, NOW)).toBeNull();
  });

  it("rejects malformed shapes without throwing", () => {
    // `timingSafeEqual` THROWS on a length mismatch rather than returning
    // false, and `Number('')` is 0 — both are live traps on this path, and an
    // uncaught throw here would 500 a page a human is looking at.
    for (const bad of ["", ".", "..", "a.b", "a.b.c.d", `${UID}..sig`, `${UID}.notanumber.sig`,
                       `${UID}.${NOW}.`, `${UID}.${NOW}.AA`]) {
      expect(() => verifyOuraState(bad, SECRET, NOW)).not.toThrow();
      expect(verifyOuraState(bad, SECRET, NOW)).toBeNull();
    }
  });
});

describe("oura authorize url", () => {
  const url = new URL(ouraAuthorizeUrl(mintOuraState(UID, SECRET, NOW)));

  it("points at Oura's authorize endpoint", () => {
    expect(url.origin + url.pathname).toBe("https://cloud.ouraring.com/oauth/authorize");
  });

  it("requests ONLY the workout and daily scopes", () => {
    // Changing scopes forces every already-connected user to re-consent, so
    // scope creep here has a real cost. If this assertion is updated, it
    // should be because a shipped feature reads the new scope.
    expect(url.searchParams.get("scope")).toBe("workout daily");
  });

  it("sends the exact registered redirect_uri", () => {
    // Oura compares this byte for byte against the console registration, and
    // `firebase.json` must rewrite the same path to `ouraCallback`.
    expect(url.searchParams.get("redirect_uri")).toBe("https://ignia.fit/oura/callback");
  });

  it("carries response_type=code and a state", () => {
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(verifyOuraState(url.searchParams.get("state") ?? "", SECRET, NOW)).toBe(UID);
  });
});
