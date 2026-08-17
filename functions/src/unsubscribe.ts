import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { resendApiKey } from "./resend-client";

// ─── One-click unsubscribe (RFC 8058) ───────────────────────────────
//
// WHY THIS EXISTS. Lifecycle mail used to advertise
// `List-Unsubscribe-Post: List-Unsubscribe=One-Click` while its
// `List-Unsubscribe` header held only a `mailto:` pointing at the owner's
// personal inbox. That is two separate faults:
//
//   1. RFC 8058 §1 requires the one-click POST target to be an **https URI**.
//      A mailto-only header with the Post header set is malformed, and Gmail /
//      Yahoo's bulk-sender expectations treat a working one-click unsubscribe
//      as a positive reputation signal — a broken one is worse than none.
//   2. Nothing was automated. An unsubscribe "click" mailed a human, so the
//      recipient stayed subscribed until someone read that mail and flipped a
//      Firestore flag by hand.
//
// The only recurring mail Ignia sends is the weekly digest, so unsubscribing
// means exactly one thing: `weeklyDigestOptIn = false`. Transactional mail
// (password reset, email verification) does not carry these headers at all and
// is unaffected — you cannot opt out of account-security mail.
//
// ─── Why the token is derived, not stored ───────────────────────────
//
// The obvious design — mint a random token and store it on the profile — is
// blocked by `firestore.rules`: `isValidProfile*` validates the user doc with
// `keys().hasOnly([...])`, so a new top-level field would reject every client
// profile write until a rules deploy landed first. A derived token needs no
// field, no rules change, and no extra read on send.
//
// The HMAC key is derived from `RESEND_API_KEY` rather than a new secret,
// because Secret Manager's free tier is 6 active versions and this project is
// already at its audited floor of 7 (see CLAUDE.md → cost discipline). It is
// never used raw: the key is `SHA-256("ignia-unsub-v1:" + apiKey)`, so the
// HMAC and the API key are not interchangeable in either direction. The one
// consequence worth knowing: **rotating the Resend key invalidates every
// unsubscribe link already sitting in an inbox.** Those links then land on the
// "we couldn't read that link" page, which points at in-app Settings, so the
// recipient still has a way out — it degrades, it does not dead-end.

const SITE = "https://ignia.fit";

/** Domain-separated HMAC key. Never the raw API key. */
function hmacKey(apiKey: string): Buffer {
  return createHash("sha256").update(`ignia-unsub-v1:${apiKey}`).digest();
}

/** 16 bytes is 128 bits of tag — far past what forging a "stop emailing me"
 *  action is worth, and it keeps the URL short enough to survive line-wrapping
 *  in a text/plain part. */
function sign(uid: string, apiKey: string): string {
  return createHmac("sha256", hmacKey(apiKey))
    .update(uid)
    .digest()
    .subarray(0, 16)
    .toString("base64url");
}

/** `<uid>.<sig>`. Firebase uids are `[A-Za-z0-9]{28}` so the dot is an
 *  unambiguous separator and neither half needs escaping. */
export function unsubscribeToken(uid: string, apiKey: string): string {
  return `${uid}.${sign(uid, apiKey)}`;
}

/** Returns the uid the token authenticates, or `null` for anything malformed,
 *  tampered with, or signed under a different key. */
export function verifyUnsubscribeToken(token: string, apiKey: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return null;
  const uid = token.slice(0, dot);
  const got = Buffer.from(token.slice(dot + 1), "base64url");
  const want = Buffer.from(sign(uid, apiKey), "base64url");
  // Length check first: timingSafeEqual throws on a length mismatch.
  if (got.length !== want.length) return null;
  return timingSafeEqual(got, want) ? uid : null;
}

/** The https URI that goes in `List-Unsubscribe` and in the mail body. */
export function unsubscribeUrl(uid: string, apiKey: string): string {
  return `${SITE}/unsubscribe?u=${encodeURIComponent(unsubscribeToken(uid, apiKey))}`;
}

// ─── Confirmation page ──────────────────────────────────────────────
//
// Deliberately self-contained: no external CSS, no fonts, no JS. This page is
// reached from an email client's in-app browser as often as from a real one.

function page(title: string, body: string, isEs: boolean): string {
  return `<!doctype html>
<html lang="${isEs ? "es" : "en"}">
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

function donePage(isEs: boolean): string {
  return isEs
    ? page(
      "Listo.",
      `<p>No volverás a recibir el resumen semanal.</p>
       <p>El resto de los correos de tu cuenta — restablecer contraseña, confirmar tu
          correo — siguen llegando, porque son de seguridad y no se pueden desactivar.</p>
       <p>¿Cambiaste de opinión? Actívalo otra vez en <strong>Ajustes → Resumen semanal</strong>.</p>`,
      true,
    )
    : page(
      "Done.",
      `<p>You won't receive the weekly recap again.</p>
       <p>Account mail — password resets, email confirmation — still arrives, because
          that is security mail and can't be switched off.</p>
       <p>Changed your mind? Turn it back on in <strong>Settings → Weekly digest</strong>.</p>`,
      false,
    );
}

function badTokenPage(): string {
  return page(
    "We couldn't read that link.",
    `<p>The link may have been broken by your email client, or it may have expired.</p>
     <p>You can always turn the weekly recap off inside the app:
        <strong>Settings → Weekly digest</strong>.</p>
     <p style="opacity:.75">Puedes apagar el resumen semanal en la app:
        <strong>Ajustes → Resumen semanal</strong>.</p>`,
    false,
  );
}

/**
 * `GET  /unsubscribe?u=<token>` — a human clicked the link in the mail.
 * `POST /unsubscribe?u=<token>` — RFC 8058 one-click, fired by the mail
 * provider with body `List-Unsubscribe=One-Click`. No body parsing: the
 * token in the URL is the whole authorisation, and acting on any POST to
 * this URL is exactly what the RFC asks for.
 *
 * Idempotent, and deliberately never reveals whether a uid exists — an
 * unknown-but-well-signed token gets the same "done" page as a real one, so
 * this endpoint cannot be used to probe for accounts.
 */
export const unsubscribeWeeklyDigest = onRequest(
  { cors: false, secrets: [resendApiKey], maxInstances: 3 },
  async (req, res) => {
    res.set("Cache-Control", "no-store");
    res.set("Content-Type", "text/html; charset=utf-8");

    const raw = req.query["u"];
    const token = typeof raw === "string" ? raw : "";
    const uid = token ? verifyUnsubscribeToken(token, resendApiKey.value()) : null;

    if (!uid) {
      // 200, not 400: a provider POSTing one-click retries on 4xx/5xx, and
      // there is nothing here a retry can fix.
      console.warn("unsubscribeWeeklyDigest: bad or missing token");
      res.status(200).send(badTokenPage());
      return;
    }

    let isEs = false;
    try {
      const db = getFirestore();
      const ref = db.doc(`users/${uid}`);
      const snap = await ref.get();
      isEs = snap.data()?.["preferredLocale"] === "es-PR";
      if (snap.exists) {
        await ref.set({ weeklyDigestOptIn: false }, { merge: true });
        console.log(`unsubscribeWeeklyDigest: opted out uid=${uid}`);
      } else {
        // Signed token, deleted account. Nothing to write; the recipient
        // still gets the confirmation they asked for.
        console.log(`unsubscribeWeeklyDigest: no profile uid=${uid}`);
      }
    } catch (err) {
      console.error(`unsubscribeWeeklyDigest: write failed uid=${uid}`, err);
      // Tell the truth rather than claiming success — but keep the status at
      // 200 so a one-click POST is not retried into a loop.
      res.status(200).send(
        page(
          "Something went wrong.",
          `<p>We couldn't save that just now. Please try the link again, or turn the
              weekly recap off in <strong>Settings → Weekly digest</strong>.</p>`,
          false,
        ),
      );
      return;
    }

    res.status(200).send(donePage(isEs));
  },
);
