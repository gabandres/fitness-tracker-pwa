import { createPrivateKey, sign as cryptoSign } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { db } from "./init";
import { ErrorCode } from "./error-codes";

/**
 * Sign in with Apple token revocation (App Review 5.1.1(v)).
 *
 * Apple expects an app that offers Sign in with Apple AND account deletion to
 * revoke the user's Apple token on deletion. Firebase brokers the SIWA sign-in
 * and never exposes Apple's refresh token, so we capture it ourselves: at
 * sign-in the client sends Apple's authorization code here, we exchange it for
 * a refresh token via Apple, and stash it at `users/{uid}/private/appleAuth`
 * (a subcollection no client rule grants access to). On account deletion
 * (gdpr.ts) we read it back and call Apple's revoke endpoint.
 *
 * DEPLOY-SAFE / DORMANT until configured: this reads its Apple config from
 * process.env and no-ops (throws, which callers on the delete path swallow)
 * when unset, so it ships without any secret bound. Revocation stays inert
 * until the owner turns it on.
 *
 * TO ACTIVATE (owner):
 *   1. Create a key at developer.apple.com → Keys → enable "Sign in with Apple".
 *   2. Set the three secrets:
 *        firebase functions:secrets:set APPLE_SIGNIN_PRIVATE_KEY   # .p8 contents
 *        firebase functions:secrets:set APPLE_SIGNIN_KEY_ID        # 10-char Key ID
 *        firebase functions:secrets:set APPLE_SIGNIN_TEAM_ID       # 10-char Team ID
 *   3. Bind them so Firebase injects them into process.env — add
 *        { secrets: [defineSecret("APPLE_SIGNIN_PRIVATE_KEY"),
 *                    defineSecret("APPLE_SIGNIN_KEY_ID"),
 *                    defineSecret("APPLE_SIGNIN_TEAM_ID")] }
 *      to BOTH `registerAppleRefreshToken` (here) and `deleteAccount` (gdpr.ts),
 *      then redeploy. Reading process.env already works with bound secrets.
 */

// For a NATIVE iOS app the SIWA client_id is the app's bundle id (not a
// Services ID) — this is the `aud` Apple stamps into the identity token.
const APPLE_CLIENT_ID = "fit.ignia.app";
const APPLE_TOKEN_URL = "https://appleid.apple.com/auth/token";
const APPLE_REVOKE_URL = "https://appleid.apple.com/auth/revoke";

/** Reads an Apple config value from the environment (populated once the secret
 *  is bound). Throws when unset so the delete-path caller can skip gracefully. */
function appleEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Apple Sign-In not configured: ${name} is unset`);
  return v;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

/**
 * The ES256 client-secret JWT Apple requires on both token endpoints. Signed
 * with the .p8 key; ECDSA signature must be raw R||S (JOSE), which Node emits
 * via `dsaEncoding: "ieee-p1363"` (its default DER form would be rejected).
 */
function makeClientSecret(): string {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "ES256", kid: appleEnv("APPLE_SIGNIN_KEY_ID") };
  const payload = {
    iss: appleEnv("APPLE_SIGNIN_TEAM_ID"),
    iat: now,
    exp: now + 300, // Apple caps client-secret lifetime; 5 min is plenty.
    aud: "https://appleid.apple.com",
    sub: APPLE_CLIENT_ID,
  };
  const signingInput = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const key = createPrivateKey(appleEnv("APPLE_SIGNIN_PRIVATE_KEY"));
  const signature = cryptoSign("sha256", Buffer.from(signingInput), { key, dsaEncoding: "ieee-p1363" });
  return `${signingInput}.${b64url(signature)}`;
}

/** Exchange Apple's one-time authorization code for a refresh token. */
async function exchangeAuthCode(authorizationCode: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    client_secret: makeClientSecret(),
    code: authorizationCode,
    grant_type: "authorization_code",
  });
  const res = await fetch(APPLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Apple token exchange failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { refresh_token?: string };
  if (!json.refresh_token) throw new Error("Apple token exchange returned no refresh_token");
  return json.refresh_token;
}

/**
 * Revoke a stored Apple refresh token. Best-effort by contract: callers on the
 * account-deletion path must swallow failures so deletion still completes.
 */
export async function revokeAppleToken(refreshToken: string): Promise<void> {
  const body = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    client_secret: makeClientSecret(),
    token: refreshToken,
    token_type_hint: "refresh_token",
  });
  const res = await fetch(APPLE_REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new Error(`Apple token revoke failed: ${res.status} ${await res.text()}`);
  }
}

/**
 * Called by the client right after a successful Sign in with Apple. Exchanges
 * the authorization code and stores the refresh token so deletion can revoke
 * it later. Non-critical: the client calls this fire-and-forget, so a failure
 * only means we can't revoke on deletion — it never blocks sign-in.
 */
export const registerAppleRefreshToken = onCall(
  { maxInstances: 5 },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const code = (request.data as { authorizationCode?: unknown })?.authorizationCode;
    if (typeof code !== "string" || !code) {
      throw new HttpsError("invalid-argument", "authorizationCode required.", { code: ErrorCode.BAD_REQUEST });
    }
    const refreshToken = await exchangeAuthCode(code);
    await db.doc(`users/${request.auth.uid}/private/appleAuth`).set({
      refreshToken,
      updatedAt: Timestamp.now(),
    });
    return { ok: true };
  },
);
