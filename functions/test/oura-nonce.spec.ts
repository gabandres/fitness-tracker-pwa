import { describe, expect, it } from "vitest";
import { freshUid, testDb } from "./helpers";
import {
  consumeOuraNonce,
  issueOuraNonce,
  mintOuraState,
  parseOuraState,
  verifyOuraState,
} from "../src/oura-link";

// A signed state proved WHICH uid it was minted for, but it was a 15-minute
// bearer capability: replayable, and every URL minted in the window stayed
// live. The nonce makes each state single-use and only the newest one valid.
const SECRET = "oura_test_secret_0000000000";
const UID = "AbCdEfGhIjKlMnOpQrStUvWxYz12";
const NOW = 1_790_000_000_000;

describe("state with a nonce (pure)", () => {
  it("carries the nonce inside the signature", () => {
    const state = mintOuraState(UID, SECRET, NOW, "n0nce-ABCDEFGHIJKLMNOP");
    expect(parseOuraState(state, SECRET, NOW)).toEqual({ uid: UID, nonce: "n0nce-ABCDEFGHIJKLMNOP" });
    expect(verifyOuraState(state, SECRET, NOW)).toBe(UID);
  });

  it("rejects a swapped nonce — it is signed", () => {
    const state = mintOuraState(UID, SECRET, NOW, "n0nce-ABCDEFGHIJKLMNOP");
    const [u, iat, , sig] = state.split(".");
    expect(parseOuraState(`${u}.${iat}.other-nonce-ABCDEFGHIJ.${sig}`, SECRET, NOW)).toBeNull();
  });

  it("parses a legacy state as nonce-less, which the callback refuses", () => {
    expect(parseOuraState(mintOuraState(UID, SECRET, NOW), SECRET, NOW)).toEqual({ uid: UID, nonce: null });
  });
});

describe("nonce store (emulator)", () => {
  it("is single-use", async () => {
    testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const nonce = await issueOuraNonce(uid, now);
    expect(await consumeOuraNonce(uid, nonce, now)).toBe(true);
    expect(await consumeOuraNonce(uid, nonce, now)).toBe(false);
  });

  it("only the newest minted link is live", async () => {
    testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const first = await issueOuraNonce(uid, now);
    const second = await issueOuraNonce(uid, now);
    expect(await consumeOuraNonce(uid, first, now)).toBe(false);
    expect(await consumeOuraNonce(uid, second, now)).toBe(true);
  });

  it("expires with the state, and an expired nonce is still spent", async () => {
    testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const nonce = await issueOuraNonce(uid, now);
    expect(await consumeOuraNonce(uid, nonce, now + 16 * 60 * 1000)).toBe(false);
    expect((await testDb().doc(`users/${uid}/private/ouraLinkNonce`).get()).exists).toBe(false);
  });

  it("is bound to the uid it was issued for", async () => {
    testDb();
    const a = freshUid("oura");
    const b = freshUid("oura");
    const now = Date.now();
    const nonce = await issueOuraNonce(a, now);
    expect(await consumeOuraNonce(b, nonce, now)).toBe(false);
  });
});
