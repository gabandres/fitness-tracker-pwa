import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { HttpsError, onCall, onRequest } from "firebase-functions/v2/https";
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
 * `workout` and nothing else.
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
const SCOPE = "workout";

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

/** `<uid>.<issuedAtMs>.<sig>`. Firebase uids are `[A-Za-z0-9]{28}` and the
 *  timestamp is digits, so the dots are unambiguous and neither field needs
 *  escaping. */
export function mintOuraState(uid: string, clientSecret: string, nowMs: number): string {
  const payload = `${uid}.${nowMs}`;
  return `${payload}.${signState(payload, clientSecret)}`;
}

/** Returns the uid this state authenticates, or `null` for anything
 *  malformed, tampered with, expired, or signed under a different key. */
export function verifyOuraState(
  state: string,
  clientSecret: string,
  nowMs: number,
): string | null {
  const parts = state.split(".");
  if (parts.length !== 3) return null;
  const [uid, iatRaw, sig] = parts;
  if (!uid || !iatRaw || !sig) return null;

  // `Number('')` is 0 and `Number('12abc')` is NaN — check the shape before
  // coercing, not after, or a blank timestamp reads as the epoch.
  if (!/^\d+$/.test(iatRaw)) return null;
  const iat = Number(iatRaw);

  const got = Buffer.from(sig, "base64url");
  const want = Buffer.from(signState(`${uid}.${iatRaw}`, clientSecret), "base64url");
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

  return uid;
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
  (request) => {
    const uid = request.auth?.uid;
    if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");

    const state = mintOuraState(uid, ouraClientSecret.value(), Date.now());
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

// ─── The callback page ──────────────────────────────────────────────
//
// Self-contained on purpose: no external CSS, fonts or JS. This is reached
// from a system browser or an in-app webview handed over by Oura, and it is
// the last thing a user sees before returning to the app. It mirrors the
// unsubscribe page's shell so the two branded interstitials stay
// consistent.

function page(title: string, body: string, locale: EmailLocale): string {
  return `<!doctype html>
<html lang="${htmlLangFor(locale)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
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
  <footer><a href="${SITE}">ignia.fit</a></footer>
</main>
</body>
</html>`;
}

const DONE: Record<EmailLocale, { title: string; body: string }> = {
  "en": {
    title: "Oura connected.",
    body: `<p>You can close this tab and go back to Ignia.</p>
       <p>Ignia can now read your <strong>workouts</strong> from Oura — nothing else.
          Not sleep, not readiness, not heart rate.</p>
       <p>You can disconnect any time in <strong>Settings → Connected apps</strong>.</p>`,
  },
  "es-PR": {
    title: "Oura conectado.",
    body: `<p>Puedes cerrar esta pestaña y volver a Ignia.</p>
       <p>Ignia ahora puede leer tus <strong>entrenamientos</strong> de Oura — nada más.
          Ni sueño, ni readiness, ni frecuencia cardíaca.</p>
       <p>Puedes desconectarlo cuando quieras en <strong>Ajustes → Apps conectadas</strong>.</p>`,
  },
  "pt-BR": {
    title: "Oura conectado.",
    body: `<p>Você pode fechar esta aba e voltar para o Ignia.</p>
       <p>O Ignia agora pode ler seus <strong>treinos</strong> do Oura — nada além disso.
          Nem sono, nem readiness, nem frequência cardíaca.</p>
       <p>Você pode desconectar quando quiser em <strong>Ajustes → Apps conectados</strong>.</p>`,
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
 * Routed by the `/oura/callback` rewrite in `firebase.json`.
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
    const uid = state ? verifyOuraState(state, ouraClientSecret.value(), Date.now()) : null;

    if (!uid) {
      // Deliberately does not distinguish "expired", "forged" and "absent".
      // Telling them apart is only useful to someone probing the endpoint.
      console.warn("ouraCallback: bad, missing or expired state");
      res.status(200).send(badStatePage());
      return;
    }

    // A denial is a normal outcome, not an error — the user pressed the
    // cancel button we put in front of them. Check it before the code, so a
    // denial never reads as a malformed request.
    if (q("error")) {
      console.log(`ouraCallback: user declined uid=${uid} error=${q("error")}`);
      const loc = await localeFor(uid);
      res.status(200).send(page(DENIED[loc].title, DENIED[loc].body, loc));
      return;
    }

    const code = q("code");
    if (!code) {
      console.warn(`ouraCallback: no code and no error uid=${uid}`);
      const loc = await localeFor(uid);
      res.status(200).send(page(FAILED[loc].title, FAILED[loc].body, loc));
      return;
    }

    const loc = await localeFor(uid);
    try {
      const now = Date.now();
      const tok = await postToken(
        { grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI },
        ouraClientSecret.value(),
      );
      await persistTokens(uid, tok, now);
      // The profile mirror is what the client reads to render "connected".
      // Written AFTER the credential, so a crash between the two leaves the
      // user looking unlinked with a usable token — recoverable by linking
      // again — rather than looking linked with nothing behind it.
      await integrationDoc(uid).set(
        { connected: true, scope: SCOPE, connectedAt: Timestamp.fromMillis(now) },
        { merge: true },
      );
      console.log(`ouraCallback: linked uid=${uid}`);
    } catch (err) {
      console.error(`ouraCallback: exchange failed uid=${uid}`, err);
      res.status(200).send(page(FAILED[loc].title, FAILED[loc].body, loc));
      return;
    }

    res.status(200).send(page(DONE[loc].title, DONE[loc].body, loc));
  },
);
