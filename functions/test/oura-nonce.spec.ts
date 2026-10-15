import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { freshUid, testDb } from "./helpers";
import {
  appReturnUrl,
  completeOuraLinkFor,
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

// ─── completeOuraLink (2026-10-15): the APP finishes the link ───────────────
// The browser leg carries no Ignia session, so a link minted on an attacker's
// account and completed in a victim's browser used to bind the victim's ring
// to the attacker. The exchange now happens only in a signed-in callable that
// checks the state's uid against the caller's.
describe("completeOuraLinkFor (emulator)", () => {
  const TOKENS = { access_token: "at", refresh_token: "rt", expires_in: 3600, token_type: "bearer" };
  const deps = (now: number, exchange = vi.fn(async () => TOKENS)) => ({
    clientSecret: SECRET,
    nowMs: now,
    exchange,
  });
  async function mint(uid: string, now: number) {
    const nonce = await issueOuraNonce(uid, now);
    return mintOuraState(uid, SECRET, now, nonce);
  }

  it("links the caller's own state, once — and writes credential + status", async () => {
    const db = testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const state = await mint(uid, now);
    const d = deps(now);
    await expect(completeOuraLinkFor(uid, { code: "c0de", state }, d)).resolves.toEqual({ ok: true });
    expect(d.exchange).toHaveBeenCalledWith("c0de");
    expect((await db.doc(`users/${uid}/private/oura`).get()).data()?.["refreshToken"]).toBe("rt");
    expect((await db.doc(`users/${uid}/integrations/oura`).get()).data()?.["connected"]).toBe(true);

    // Replay: the nonce is spent, so the same state is refused and Oura is
    // not called a second time.
    const again = deps(now);
    await expect(completeOuraLinkFor(uid, { code: "c0de", state }, again)).rejects.toMatchObject({
      code: "failed-precondition",
      details: { code: "OURA_LINK_EXPIRED" },
    });
    expect(again.exchange).not.toHaveBeenCalled();
  });

  it("rejects a state minted for another account, without exchanging or burning it", async () => {
    const db = testDb();
    const attacker = freshUid("oura");
    const victim = freshUid("oura");
    const now = Date.now();
    const state = await mint(attacker, now);
    const d = deps(now);
    await expect(completeOuraLinkFor(victim, { code: "c0de", state }, d)).rejects.toMatchObject({
      code: "permission-denied",
      details: { code: "OURA_LINK_WRONG_ACCOUNT" },
    });
    expect(d.exchange).not.toHaveBeenCalled();
    expect((await db.doc(`users/${victim}/private/oura`).get()).exists).toBe(false);
    expect((await db.doc(`users/${attacker}/private/oura`).get()).exists).toBe(false);
    // Not consumed: a third party holding the state cannot spend it.
    expect((await db.doc(`users/${attacker}/private/ouraLinkNonce`).get()).exists).toBe(true);
  });

  it("rejects an expired state", async () => {
    testDb();
    const uid = freshUid("oura");
    const minted = Date.now() - 16 * 60 * 1000;
    const state = await mint(uid, minted);
    const d = deps(Date.now());
    await expect(completeOuraLinkFor(uid, { code: "c0de", state }, d)).rejects.toMatchObject({
      details: { code: "OURA_LINK_EXPIRED" },
    });
    expect(d.exchange).not.toHaveBeenCalled();
  });

  it("rejects a superseded link — only the newest Connect tap is live", async () => {
    testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const first = await mint(uid, now);
    await mint(uid, now);
    await expect(completeOuraLinkFor(uid, { code: "c0de", state: first }, deps(now))).rejects.toMatchObject({
      details: { code: "OURA_LINK_EXPIRED" },
    });
  });

  it("rejects a legacy nonce-less state and malformed input before any I/O", async () => {
    testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const d = deps(now);
    await expect(
      completeOuraLinkFor(uid, { code: "c0de", state: mintOuraState(uid, SECRET, now) }, d),
    ).rejects.toMatchObject({ details: { code: "OURA_LINK_EXPIRED" } });
    await expect(completeOuraLinkFor(uid, { state: "x" }, d)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(completeOuraLinkFor(uid, { code: 1, state: "x" }, d)).rejects.toMatchObject({ code: "invalid-argument" });
    await expect(completeOuraLinkFor(uid, { code: "c", state: "x".repeat(300) }, d)).rejects.toMatchObject({
      code: "invalid-argument",
    });
    expect(d.exchange).not.toHaveBeenCalled();
  });

  it("stores nothing when Oura refuses the code, and the nonce stays spent", async () => {
    const db = testDb();
    const uid = freshUid("oura");
    const now = Date.now();
    const state = await mint(uid, now);
    const d = deps(now, vi.fn(async () => { throw new Error("oura token endpoint returned 400"); }));
    await expect(completeOuraLinkFor(uid, { code: "bad", state }, d)).rejects.toMatchObject({
      code: "unavailable",
      details: { code: "OURA_LINK_FAILED" },
    });
    expect((await db.doc(`users/${uid}/private/oura`).get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}/integrations/oura`).get()).exists).toBe(false);
    expect((await db.doc(`users/${uid}/private/ouraLinkNonce`).get()).exists).toBe(false);
  });
});

describe("ouraCallback forwards to the app instead of exchanging (pure)", () => {
  it("builds the app deep link with only code / state / error, percent-encoded", () => {
    expect(appReturnUrl({ code: "a b", state: "u.1.n.s" })).toBe("ignia://oura/callback?code=a+b&state=u.1.n.s");
    expect(appReturnUrl({ state: "s", error: "access_denied" })).toBe("ignia://oura/callback?state=s&error=access_denied");
    expect(appReturnUrl({ code: '"><script>' })).not.toMatch(/[<>"]/);
    expect(appReturnUrl({})).toBe("ignia://oura/callback");
  });

  it("the callback handler no longer exchanges a code or consumes a nonce", () => {
    const s = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../src/oura-link.ts"), "utf8");
    const handler = s.slice(s.indexOf("export const ouraCallback"));
    expect(handler).not.toMatch(/postToken|persistTokens|consumeOuraNonce|integrationDoc/);
    expect(handler).toMatch(/appReturnUrl\(\{ code, state \}\)/);
  });
});
