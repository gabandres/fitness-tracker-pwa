import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";
import { type EmailLocale, emailLocale, htmlLangFor } from "./locales";

// ─── Oura Cloud API — account linking (OAuth2 authorization code) ───
//
// WHY THIS EXISTS, AND WHY IT CONTRADICTS AN ADR. ADR-0026 deliberately
// chose the OS health store (HealthKit / Health Connect) over Oura's Cloud
// API: the health path is free, needs no secret, and needs no OAuth. That
// reasoning still holds on its own terms — but the health path had still
// never imported a single real Oura record, so "it already works for free"
// was never actually demonstrated. The owner overruled the ADR and
// registered a Cloud API application; see ADR-0026 Amendment 2. This module
// is the server half of that decision. The health-store importer is NOT
// removed and remains the zero-cost path.
//
// SCOPE. This file links and unlinks an Oura account and keeps the
// credential fresh. It does **not** fetch workouts — mapping Oura workouts
// into `CardioBlock`s is a separate ticket and belongs next to
// `packages/core/src/health-workouts.ts`, which already owns that mapping
// for the health-store path.

/** Not secret. It is sent in the authorize URL, which is a browser
 *  redirect, so it is visible to anyone who links an account. */
const CLIENT_ID = "347c0b55-f507-47e4-8cf2-afcb67c3085f";

const AUTHORIZE_URL = "https://cloud.ouraring.com/oauth/authorize";
const TOKEN_URL = "https://api.ouraring.com/oauth/token";

const SITE = "https://ignia.fit";

/** Must match the redirect URI registered at developer.ouraring.com
 *  EXACTLY — Oura compares it byte for byte, and it is sent again in the
 *  token exchange. The `firebase.json` rewrite for `/oura/callback` is what
 *  routes it here; without that rewrite hosting serves the SPA shell and
 *  the flow dead-ends on a branded 404 that returns 200. */
const REDIRECT_URI = `${SITE}/oura/callback`;

/**
 * `workout` and `daily`, and nothing else.
 *
 * Oura's console offers every scope it has, and requesting them all is the
 * default path of least resistance. It is the wrong one: every extra scope
 * lengthens the consent screen in front of the one thing the user is
 * actually agreeing to, and **changing scopes later forces every already-
 * connected user to re-consent**. So this is decided once, minimally.
 *
 * `/v2/usercollection/workout` carries activity, start/end, distance,
 * calories and intensity — everything a cardio block renders. `daily`
 * (readiness / sleep / activity summaries) gets added the day a feature
 * consumes one, not in advance.
 */
/**
 * The scopes Ignia asks Oura for. **Hand-mirrored by `OURA_REQUIRED_SCOPES` in
 * `packages/core/src/oura-scopes.ts`** — `functions/` is not a workspace and
 * cannot import that package, so both sides assert this literal in their own
 * suites instead.
 *
 * **Adding a scope means changing BOTH.** Oura cannot widen a grant without the
 * user consenting again, so an already-connected user keeps the old scope and
 * the new data is simply absent — no error, no prompt. Changing only this
 * constant means nobody is ever told to reconnect; changing only the core list
 * means everybody is told to, forever.
 */
const SCOPE = "workout daily";

export const ouraClientSecret: ReturnType<typeof defineSecret> =
  defineSecret("OURA_CLIENT_SECRET");

/** Where the credential lives. `users/{uid}/private/**` matches NO rule in
 *  `firestore.rules`, so the `match /{document=**} { allow read, write: if
 *  false }` catch-all denies every client read and write of it. That is the
 *  entire access control: the Admin SDK bypasses rules, clients cannot see
 *  a refresh token, and no rules deploy is needed. `oura-link.spec.ts`
 *  asserts the deny so a future rules refactor cannot silently expose it. */
function tokenDoc(uid: string) {
  return getFirestore().doc(`users/${uid}/private/oura`);
}

/**
 * The client-visible half: "is Oura connected, and since when".
 *
 * NOT a field on the user profile, and that is a deliberate call.
 * `isValidProfile` is a `hasOnly()` allow-list whose own comments say the
 * server-stamped keys are listed "so the client can round-trip a profile
 * that already carries it" — so an admin-SDK write of a key missing from
 * that list does not fail at write time, it silently breaks **every
 * subsequent client profile update**, because the client sends the whole
 * document back and the allow-list rejects it. Adding a key there costs two
 * validator edits plus an immutability pin on update.
 *
 * A dedicated subcollection costs one new match block, cannot break profile
 * writes at all, and extends to a second provider without touching the
 * profile shape again. Rule: owner-readable, server-written.
 */
/** The public, client-READABLE half of the link (`allow write: if false` in
 *  `firestore.rules`, so only the Admin SDK writes here). Exported because
 *  `oura-workouts.ts` stamps the last-sync fields the Connected apps screen
 *  renders — a client cannot write them, by design. */
export function integrationDoc(uid: string) {
  return getFirestore().doc(`users/${uid}/integrations/oura`);
}

/** Where `preferredLocale` lives — read only, never written from here. */
function profileDoc(uid: string) {
  return getFirestore().doc(`users/${uid}`);
}

// ─── The `state` parameter ──────────────────────────────────────────
//
// The callback arrives from Oura's servers as a plain browser redirect.
// There is no Firebase session on it — on mobile the flow runs in a system
// browser that shares nothing with the app — so `state` is the ONLY thing
// that can say which user this authorization belongs to. That makes it
// load-bearing in two ways at once: CSRF defence, and identity.
//
// It is therefore signed, not random-and-stored. A stored nonce would need
// a Firestore collection, a rules decision and a cleanup job; an HMAC needs
// none of those and cannot be forged without the key.
//
// The key is DERIVED from `OURA_CLIENT_SECRET` rather than being a second
// secret, because Secret Manager's free tier is 6 active versions and this
// project already sits at its audited floor (CLAUDE.md → cost discipline;
// `scripts/doctor.mjs` fails on growth past it). Domain separation means
// the HMAC key and the client secret are not interchangeable in either
// direction: recovering one from the other requires inverting SHA-256.
//
// Consequence worth knowing: **rotating the Oura client secret invalidates
// every in-flight authorize URL.** Those land on the "link expired" page,
// which tells the user to try again — it degrades, it does not dead-end.

/** 15 minutes. Long enough to read a consent screen and sign in to Oura,
 *  short enough that a leaked URL in a browser history is not a standing
 *  invitation to bind someone's ring to the wrong account. */
const STATE_TTL_MS = 15 * 60 * 1000;

function stateKey(clientSecret: string): Buffer {
  return createHash("sha256").update(`ignia-oura-state-v1:${clientSecret}`).digest();
}

function signState(payload: string, clientSecret: string): string {
  return createHmac("sha256", stateKey(clientSecret))
    .update(payload)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** `<uid>.<issuedAtMs>[.<nonce>].<sig>`. Firebase uids are `[A-Za-z0-9]{28}`,
 *  the timestamp is digits and the nonce base64url, so the dots are
 *  unambiguous and no field needs escaping. The nonce, when present, is
 *  inside the signature. */
export function mintOuraState(uid: string, clientSecret: string, nowMs: number, nonce?: string): string {
  const payload = nonce ? `${uid}.${nowMs}.${nonce}` : `${uid}.${nowMs}`;
  return `${payload}.${signState(payload, clientSecret)}`;
}

/** Returns the uid this state authenticates, or `null` for anything
 *  malformed, tampered with, expired, or signed under a different key. */
export function verifyOuraState(
  state: string,
  clientSecret: string,
  nowMs: number,
): string | null {
  return parseOuraState(state, clientSecret, nowMs)?.uid ?? null;
}

/** {@link verifyOuraState}, plus the signed one-time nonce (null on a
 *  legacy nonce-less state, which `ouraCallback` refuses). */
export function parseOuraState(
  state: string,
  clientSecret: string,
  nowMs: number,
): { uid: string; nonce: string | null } | null {
  const parts = state.split(".");
  if (parts.length !== 3 && parts.length !== 4) return null;
  const uid = parts[0];
  const iatRaw = parts[1];
  const nonce = parts.length === 4 ? parts[2] : null;
  const sig = parts[parts.length - 1];
  if (!uid || !iatRaw || !sig) return null;
  if (nonce !== null && !/^[A-Za-z0-9_-]{16,64}$/.test(nonce)) return null;

  // `Number('')` is 0 and `Number('12abc')` is NaN — check the shape before
  // coercing, not after, or a blank timestamp reads as the epoch.
  if (!/^\d+$/.test(iatRaw)) return null;
  const iat = Number(iatRaw);

  const payload = nonce ? `${uid}.${iatRaw}.${nonce}` : `${uid}.${iatRaw}`;
  const got = Buffer.from(sig, "base64url");
  const want = Buffer.from(signState(payload, clientSecret), "base64url");
  // Length check first: timingSafeEqual THROWS on a length mismatch rather
  // than returning false.
  if (got.length !== want.length) return null;
  if (!timingSafeEqual(got, want)) return null;

  // Expiry is checked only after the signature verifies, so an attacker
  // cannot use timing here to learn anything about the key.
  // The lower bound catches a clock skew that would otherwise make a
  // far-future token valid forever.
  if (iat > nowMs + 60_000) return null;
  if (nowMs - iat > STATE_TTL_MS) return null;

  return { uid, nonce };
}

// ─── One-time nonce (2026-10-15 audit) ──────────────────────────────
//
// The HMAC proves WHICH uid a state was minted for; it does not make a state
// single-use. A signed state was a 15-minute bearer capability: replayable,
// and every URL minted in that window stayed valid. So minting now also
// stores a random nonce server-side and the callback CONSUMES it in a
// transaction — one state, one use, and only the most recently minted link
// per user is live (a new mint overwrites the stored nonce).
//
// Stored as a SHA-256, under `users/{uid}/private/` — no rule matches
// `private`, so clients can neither read nor forge it, and account deletion
// already erases it with the rest of `private`. No new rules, no new
// collection, no cleanup job: one doc per user, overwritten or deleted.
//
// The nonce alone did NOT stop an attacker who mints a link on their OWN
// account and gets a victim to complete it in the victim's browser: the
// browser leg carries no Ignia session, so nothing on it can tell the two
// people apart, and the victim's ring would be bound to the attacker's
// account. Closed 2026-10-15: `ouraCallback` no longer exchanges anything —
// it bounces the code to `ignia://oura/callback`, and the app redeems it
// through `completeOuraLink`, a SIGNED-IN callable that refuses a state whose
// uid is not the caller's. The nonce is consumed there, not in the browser.

function nonceDoc(uid: string) {
  return getFirestore().doc(`users/${uid}/private/ouraLinkNonce`);
}

function hashNonce(nonce: string): string {
  return createHash("sha256").update(`ignia-oura-nonce-v1:${nonce}`).digest("hex");
}

/** Store a fresh nonce for `uid`, replacing any previous one. */
export async function issueOuraNonce(uid: string, nowMs: number): Promise<string> {
  const nonce = randomBytes(18).toString("base64url");
  await nonceDoc(uid).set({
    hash: hashNonce(nonce),
    expiresAt: Timestamp.fromMillis(nowMs + STATE_TTL_MS),
  });
  return nonce;
}

/** Atomically check-and-delete. True only for the live, unexpired nonce. */
export async function consumeOuraNonce(uid: string, nonce: string, nowMs: number): Promise<boolean> {
  const db = getFirestore();
  const ref = nonceDoc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const data = snap.data() ?? {};
    const want = typeof data["hash"] === "string" ? (data["hash"] as string) : "";
    const exp = data["expiresAt"] instanceof Timestamp ? (data["expiresAt"] as Timestamp).toMillis() : 0;
    const got = hashNonce(nonce);
    const match = want.length === got.length && timingSafeEqual(Buffer.from(want), Buffer.from(got));
    if (!match) return false;
    // Single use: delete on the matching read, even when expired.
    tx.delete(ref);
    return exp > nowMs;
  });
}

/** The full authorize URL a user is sent to. Exported for tests. */
export function ouraAuthorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    response_type: "code",
    scope: SCOPE,
    state,
  });
  return `${AUTHORIZE_URL}?${q.toString()}`;
}

// ─── Token exchange ─────────────────────────────────────────────────

interface OuraTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

function isTokenResponse(v: unknown): v is OuraTokenResponse {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o["access_token"] === "string" && o["access_token"].length > 0
    && typeof o["refresh_token"] === "string" && o["refresh_token"].length > 0
    && typeof o["expires_in"] === "number" && Number.isFinite(o["expires_in"]);
}

/**
 * POST to Oura's token endpoint, form-encoded.
 *
 * Credentials go in the BODY rather than an HTTP Basic header. Oura accepts
 * either; the body form is what its own documentation leads with, and it
 * avoids a base64 header that some proxies log verbatim.
 */
async function postToken(
  params: Record<string, string>,
  clientSecret: string,
): Promise<OuraTokenResponse> {
  const body = new URLSearchParams({
    ...params,
    client_id: CLIENT_ID,
    client_secret: clientSecret,
  });

  // A hung token endpoint would otherwise hold a function instance for the
  // full request timeout. 15s is well past Oura's observed latency.
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    // Never log the response body verbatim — an error payload from a token
    // endpoint can echo back the code or the secret.
    throw new Error(`oura token endpoint returned ${res.status}`);
  }

  const json: unknown = await res.json();
  if (!isTokenResponse(json)) {
    throw new Error("oura token response missing access_token/refresh_token/expires_in");
  }
  return json;
}

async function persistTokens(uid: string, tok: OuraTokenResponse, nowMs: number): Promise<void> {
  await tokenDoc(uid).set(
    {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token,
      // Stored absolute, not relative: `expires_in` is only meaningful at
      // the instant of the response.
      expiresAt: Timestamp.fromMillis(nowMs + tok.expires_in * 1000),
      scope: SCOPE,
      updatedAt: Timestamp.fromMillis(nowMs),
    },
    { merge: true },
  );
}

/**
 * Returns a valid access token, refreshing if it is within `skewMs` of
 * expiry.
 *
 * **Oura's refresh tokens are single-use** — the old one is invalidated the
 * moment a refresh succeeds, and the response carries a replacement. So the
 * write of the new refresh token is not bookkeeping: if it is lost, the
 * link is permanently broken and the user has to re-authorize. The refresh
 * is therefore awaited and persisted before the token is handed out, never
 * fired off in the background.
 *
 * Exported for the workout sync that will consume it.
 */
export async function getOuraAccessToken(
  uid: string,
  clientSecret: string,
  nowMs: number = Date.now(),
  skewMs: number = 60_000,
): Promise<string | null> {
  const snap = await tokenDoc(uid).get();
  if (!snap.exists) return null;
  const data = snap.data() ?? {};

  const access = data["accessToken"];
  const refresh = data["refreshToken"];
  const expiresAt = data["expiresAt"];
  if (typeof refresh !== "string" || !refresh) return null;

  const expiresMs = expiresAt instanceof Timestamp ? expiresAt.toMillis() : 0;
  if (typeof access === "string" && access && expiresMs - nowMs > skewMs) {
    return access;
  }

  try {
    const tok = await postToken({ grant_type: "refresh_token", refresh_token: refresh }, clientSecret);
    await persistTokens(uid, tok, nowMs);
    return tok.access_token;
  } catch (err) {
    console.error(`getOuraAccessToken: refresh failed uid=${uid}`, err);
    // A refresh that fails because the user revoked access at Oura is
    // permanent, and one that fails because Oura is down is not. We cannot
    // tell them apart from here without parsing an error body we have
    // deliberately not read, so the link is left in place and the caller
    // simply gets no token this time. `linkOuraStatus` surfaces the
    // staleness to the user rather than silently pretending to be linked.
    return null;
  }
}

// ─── Callables ──────────────────────────────────────────────────────

/**
 * Mints a signed `state` and returns the authorize URL for the caller.
 *
 * The URL cannot be built on the client: `state` is an HMAC under a key
 * derived from the client secret, and that secret exists only on the
 * server. Building it here is what makes the callback able to trust the
 * identity it is handed.
 */
export const beginOuraLink = onCall(
  { secrets: [ouraClientSecret], maxInstances: 3 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const now = Date.now();
    const nonce = await issueOuraNonce(uid, now);
    const state = mintOuraState(uid, ouraClientSecret.value(), now, nonce);
    return { url: ouraAuthorizeUrl(state), scope: SCOPE, expiresInSec: STATE_TTL_MS / 1000 };
  },
);

/**
 * Forgets the stored credential.
 *
 * This revokes Ignia's copy, not Oura's grant — the user should also remove
 * the app at cloud.ouraring.com if they want the authorization itself gone,
 * and the UI says so. Deleting our copy is the part we can actually
 * guarantee, and doing it locally means "disconnect" never depends on
 * Oura's API being reachable.
 */
export const unlinkOura = onCall({ maxInstances: 3 }, async (request) => {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

  await tokenDoc(uid).delete();
  await integrationDoc(uid).delete();
  console.log(`unlinkOura: cleared uid=${uid}`);
  return { ok: true };
});

// ─── Completing the link (the app's half) ───────────────────────────

/** A refusal the app maps to its own copy via `details.code`. */
function linkError(
  status: "invalid-argument" | "permission-denied" | "failed-precondition" | "unavailable",
  message: string,
  code: ErrorCode,
): HttpsError {
  return new HttpsError(status, message, { code });
}

/** Oura's codes are short opaque strings; a state is ~110 chars. Anything far
 *  past these is not a real redirect and is refused before any I/O. */
const MAX_CODE_LEN = 512;
const MAX_STATE_LEN = 256;

export interface CompleteOuraLinkDeps {
  clientSecret: string;
  nowMs: number;
  /** Code → tokens. Real: Oura's token endpoint. Injected so the identity and
   *  single-use checks are testable without a network. */
  exchange: (code: string) => Promise<OuraTokenResponse>;
}

/**
 * Redeem an authorization code for `callerUid`.
 *
 * Order is the point:
 *  1. The state must verify (signature + 15-minute expiry) and carry a nonce.
 *  2. **Its uid must be the caller's.** This is the check the browser leg
 *     cannot make: a link minted on someone else's account dies here, and its
 *     nonce is NOT consumed, so a third party holding a state cannot burn it.
 *  3. The nonce is consumed (single use, newest-link-only).
 *  4. Only then is the code exchanged and the credential stored.
 */
export async function completeOuraLinkFor(
  callerUid: string,
  input: { code?: unknown; state?: unknown },
  deps: CompleteOuraLinkDeps,
): Promise<{ ok: true }> {
  const code = typeof input.code === "string" ? input.code : "";
  const state = typeof input.state === "string" ? input.state : "";
  if (!code || !state || code.length > MAX_CODE_LEN || state.length > MAX_STATE_LEN) {
    throw linkError("invalid-argument", "code and state are required.", ErrorCode.BAD_REQUEST);
  }

  const parsed = parseOuraState(state, deps.clientSecret, deps.nowMs);
  if (!parsed || !parsed.nonce) {
    throw linkError("failed-precondition", "Link expired.", ErrorCode.OURA_LINK_EXPIRED);
  }
  if (parsed.uid !== callerUid) {
    console.warn(`completeOuraLink: state uid does not match caller uid=${callerUid}`);
    throw linkError("permission-denied", "Link belongs to another account.", ErrorCode.OURA_LINK_WRONG_ACCOUNT);
  }
  const fresh = await consumeOuraNonce(callerUid, parsed.nonce, deps.nowMs);
  if (!fresh) {
    throw linkError("failed-precondition", "Link expired or already used.", ErrorCode.OURA_LINK_EXPIRED);
  }

  let tok: OuraTokenResponse;
  try {
    tok = await deps.exchange(code);
  } catch (err) {
    console.error(`completeOuraLink: exchange failed uid=${callerUid}`, err);
    throw linkError("unavailable", "Could not finish linking Oura.", ErrorCode.OURA_LINK_FAILED);
  }
  await persistTokens(callerUid, tok, deps.nowMs);
  // The status doc is what the client reads to render "connected". Written
  // AFTER the credential, so a crash between the two leaves the user looking
  // unlinked with a usable token — recoverable by linking again — rather
  // than looking linked with nothing behind it.
  await integrationDoc(callerUid).set(
    { connected: true, scope: SCOPE, connectedAt: Timestamp.fromMillis(deps.nowMs) },
    { merge: true },
  );
  console.log(`completeOuraLink: linked uid=${callerUid}`);
  return { ok: true };
}

/**
 * `completeOuraLink({ code, state })` — the app hands over what `ouraCallback`
 * bounced to `ignia://oura/callback`. Signed-in only; see
 * {@link completeOuraLinkFor} for the checks.
 */
export const completeOuraLink = onCall(
  { secrets: [ouraClientSecret], maxInstances: 3 },
  async (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
    const data = (request.data ?? {}) as { code?: unknown; state?: unknown };
    const clientSecret = ouraClientSecret.value();
    return completeOuraLinkFor(uid, data, {
      clientSecret,
      nowMs: Date.now(),
      exchange: (code) =>
        postToken({ grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI }, clientSecret),
    });
  },
);

// ─── The callback page ──────────────────────────────────────────────
//
// Self-contained on purpose: no external CSS, fonts or JS. This is reached
// from a system browser or an in-app webview handed over by Oura, and it is
// the last thing a user sees before returning to the app. It mirrors the
// unsubscribe page's shell so the two branded interstitials stay
// consistent.

/**
 * Where the callback page sends the browser — the app, carrying Oura's
 * `code` / `state` (or `error`) through unchanged for `completeOuraLink`.
 *
 * **This is also what closes the modal.** `WebBrowser.openAuthSessionAsync` dismisses
 * itself when the browser navigates to the redirect URL the app handed it — but
 * on iOS `ASWebAuthenticationSession` can only intercept a **custom scheme**,
 * not an `https://` one (that needs Universal Links). Our registered Oura
 * redirect is `https://ignia.fit/oura/callback`, so the session could never
 * match it: the user landed on this page, it said "you can close this", and
 * they had to tap Done themselves. That is the "not sleek" the owner reported.
 *
 * So the page bounces one more hop, to the app's own scheme, which the session
 * DOES match — and the modal closes on its own.
 *
 * The Oura-registered redirect URI is unchanged; this is what happens after it.
 */
const APP_RETURN_URL = "ignia://oura/callback";

/** The app deep link for this callback's query. Only the three parameters the
 *  app reads are forwarded; URLSearchParams percent-encodes them, so no `<`,
 *  `>` or quote can reach the HTML below. Exported for tests. */
export function appReturnUrl(params: { code?: string; state?: string; error?: string }): string {
  const q = new URLSearchParams();
  for (const k of ["code", "state", "error"] as const) {
    const v = params[k];
    if (v) q.set(k, v);
  }
  const qs = q.toString();
  return qs ? `${APP_RETURN_URL}?${qs}` : APP_RETURN_URL;
}

function page(title: string, body: string, locale: EmailLocale, bounceTo?: string): string {
  const bounce = !!bounceTo;
  // `&` is the only character URLSearchParams leaves that HTML cares about.
  const href = (bounceTo ?? "").replace(/&/g, "&amp;");
  // Belt and braces, because this runs in whatever browser Oura handed over:
  // a meta refresh for the ones that honour it, a script for the ones that
  // don't, and the visible link below as the manual fallback for both. The
  // 400ms delay lets the page paint first, so a user who sees it sees a
  // finished state rather than a flash.
  const bounceHead = bounce
    ? `<meta http-equiv="refresh" content="0.4;url=${href}">`
    : "";
  const bounceScript = bounce
    ? `<script>setTimeout(function(){location.replace(${JSON.stringify(bounceTo)})},400)</script>`
    : "";
  return `<!doctype html>
<html lang="${htmlLangFor(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
${bounceHead}
<title>${title} · Ignia</title>
<style>
  :root { color-scheme: light dark; --paper:#faf9f6; --ink:#1c1917; --muted:#57534e; --line:#e7e5e2; --accent:#c62f27; }
  @media (prefers-color-scheme: dark) {
    :root { --paper:#131210; --ink:#f3f1ec; --muted:#b3ada3; --line:#2b2822; --accent:#ff8a5c; }
  }
  body { margin:0; background:var(--paper); color:var(--ink);
         font:16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif; }
  main { max-width:560px; margin:0 auto; padding:64px 24px; }
  h1 { font-family:Georgia,'Iowan Old Style','Times New Roman',serif; font-style:italic;
       font-weight:400; font-size:32px; line-height:1.15; margin:0 0 14px; }
  p { margin:0 0 14px; color:var(--muted); }
  .eyebrow { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:11px;
             letter-spacing:0.22em; text-transform:uppercase; color:var(--accent); font-weight:700; margin:0 0 10px; }
  footer { margin-top:36px; padding-top:18px; border-top:1px solid var(--line); font-size:13px; }
  a { color:var(--accent); }
</style>
</head>
<body>
<main>
  <p class="eyebrow">Ignia</p>
  <h1>${title}</h1>
  ${body}
  ${bounce ? `<p><a href="${href}">Open Ignia</a></p>` : ""}
  <footer><a href="${SITE}">ignia.fit</a></footer>
</main>
${bounceScript}
</body>
</html>`;
}

/** The browser leg no longer links anything — the app does. So this page
 *  says "finishing in the app", and tells a reader who is NOT on the phone
 *  (a copied link, a desktop) where the connection actually completes. */
const RETURNING: Record<EmailLocale, { title: string; body: string }> = {
  "en": {
    title: "Finishing in Ignia…",
    body: `<p>Taking you back to the Ignia app to finish connecting Oura.</p>
       <p>If Ignia didn't open, open this on the phone where Ignia is installed and
          start again from <strong>Settings → Connected apps</strong> — the
          connection can only finish in the app.</p>`,
  },
  "es-PR": {
    title: "Terminando en Ignia…",
    body: `<p>Te llevamos de vuelta a la app de Ignia para terminar de conectar Oura.</p>
       <p>Si Ignia no se abrió, ábrelo en el teléfono donde tienes Ignia y empieza
          otra vez desde <strong>Ajustes → Apps conectadas</strong> — la conexión
          solo se puede terminar en la app.</p>`,
  },
  "pt-BR": {
    title: "Finalizando no Ignia…",
    body: `<p>Levando você de volta ao app Ignia para terminar de conectar a Oura.</p>
       <p>Se o Ignia não abriu, abra isto no celular onde o Ignia está instalado e
          comece de novo em <strong>Ajustes → Apps conectados</strong> — a conexão
          só pode ser finalizada no app.</p>`,
  },
};

const DENIED: Record<EmailLocale, { title: string; body: string }> = {
  "en": {
    title: "Not connected.",
    body: `<p>You cancelled at Oura, so nothing was linked and nothing changed.</p>
       <p>You can start again any time from <strong>Settings → Connected apps</strong>.</p>`,
  },
  "es-PR": {
    title: "No se conectó.",
    body: `<p>Cancelaste en Oura, así que no se enlazó nada y nada cambió.</p>
       <p>Puedes empezar otra vez desde <strong>Ajustes → Apps conectadas</strong>.</p>`,
  },
  "pt-BR": {
    title: "Não conectado.",
    body: `<p>Você cancelou na Oura, então nada foi vinculado e nada mudou.</p>
       <p>Você pode começar de novo em <strong>Ajustes → Apps conectados</strong>.</p>`,
  },
};

const FAILED: Record<EmailLocale, { title: string; body: string }> = {
  "en": {
    title: "Something went wrong.",
    body: `<p>We couldn't finish connecting Oura. Nothing was saved.</p>
       <p>Please try again from <strong>Settings → Connected apps</strong>.</p>`,
  },
  "es-PR": {
    title: "Algo salió mal.",
    body: `<p>No pudimos terminar de conectar Oura. No se guardó nada.</p>
       <p>Intenta otra vez desde <strong>Ajustes → Apps conectadas</strong>.</p>`,
  },
  "pt-BR": {
    title: "Algo deu errado.",
    body: `<p>Não conseguimos terminar de conectar a Oura. Nada foi salvo.</p>
       <p>Tente de novo em <strong>Ajustes → Apps conectados</strong>.</p>`,
  },
};

/** A bad or expired `state` means no uid ever resolved, so there is no
 *  profile to read a language off. Stack all three rather than guess — it
 *  is the one page here whose reader is definitionally unknown. */
function badStatePage(): string {
  return page(
    "That link expired.",
    `<p>Connection links are only good for 15 minutes. Nothing was saved.</p>
     <p>Start again from <strong>Settings → Connected apps</strong>.</p>
     <p style="opacity:.75">Empieza otra vez desde <strong>Ajustes → Apps conectadas</strong>.</p>
     <p style="opacity:.75">Comece de novo em <strong>Ajustes → Apps conectados</strong>.</p>`,
    "en",
  );
}

async function localeFor(uid: string): Promise<EmailLocale> {
  try {
    const snap = await profileDoc(uid).get();
    return emailLocale(snap.data()?.["preferredLocale"] as string | undefined);
  } catch {
    return "en";
  }
}

/**
 * `GET /oura/callback?code=…&state=…` — Oura redirects the user's browser
 * here after the consent screen. On denial it sends `?error=access_denied`
 * with no code.
 *
 * Routed by the `/oura/callback` rewrite in `firebase.json`. The registered
 * redirect URI stays this https URL; what changed (2026-10-15) is that this
 * page EXCHANGES NOTHING. It checks the state's signature and expiry — so a
 * stale or forged link gets an honest page instead of an app round-trip — and
 * forwards `code` / `state` / `error` to `ignia://oura/callback`, where the
 * signed-in app calls `completeOuraLink`. The nonce is NOT consumed here:
 * consuming it in a browser that has no Ignia session is exactly what let a
 * link minted on one account be completed by another person.
 *
 * Every terminal response is a 200 with an explanatory page: this URL is
 * rendered to a human, and a bare 4xx would show a browser error page with
 * no route back into the app.
 */
export const ouraCallback = onRequest(
  { cors: false, secrets: [ouraClientSecret], maxInstances: 3 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    // The URL carries an authorization code. Referrer-Policy stops it
    // leaking to any third party in a Referer header, and noindex keeps it
    // out of search results.
    res.set("Referrer-Policy", "no-referrer");
    res.set("Content-Type", "text/html; charset=utf-8");

    const q = (k: string): string => {
      const v = req.query[k];
      return typeof v === "string" ? v : "";
    };

    const state = q("state");
    const parsed = state ? parseOuraState(state, ouraClientSecret.value(), Date.now()) : null;
    if (!parsed || !parsed.nonce) {
      // Deliberately does not distinguish "expired", "forged" and "absent".
      // Telling them apart is only useful to someone probing the endpoint.
      console.warn("ouraCallback: bad, missing or expired state");
      res.status(200).send(badStatePage());
      return;
    }

    // The uid here is only the one the state CLAIMS — good enough to pick a
    // page language, never to link anything.
    const loc = await localeFor(parsed.uid);
    const error = q("error");
    const code = q("code");

    if (error) {
      // A denial is a normal outcome, not an error. Still bounce, so the
      // app's auth session closes and the app can say "not connected".
      console.log(`ouraCallback: user declined error=${error}`);
      res.status(200).send(page(DENIED[loc].title, DENIED[loc].body, loc, appReturnUrl({ state, error })));
      return;
    }
    if (!code) {
      console.warn("ouraCallback: no code and no error");
      res.status(200).send(page(FAILED[loc].title, FAILED[loc].body, loc));
      return;
    }

    res.status(200).send(page(RETURNING[loc].title, RETURNING[loc].body, loc, appReturnUrl({ code, state })));
  },
);
