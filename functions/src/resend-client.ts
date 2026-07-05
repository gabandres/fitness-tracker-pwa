import { defineSecret } from "firebase-functions/params";
import { Resend } from "resend";

// `defineSecret` returns a `SecretParam` whose type lives at
// firebase-functions/lib/params/types — not a public module path, which
// makes the inferred export unportable under `declaration: true`. Annotate
// explicitly with `ReturnType<typeof defineSecret>` so downstream imports
// (index.ts uses it for `secrets: [resendApiKey]`) stay resolvable.
export const resendApiKey: ReturnType<typeof defineSecret> = defineSecret("RESEND_API_KEY");

// Pointing at the default Resend sandbox sender until macrolog.app (or
// another owned domain) is verified in Resend. Switch FROM_EMAIL to the
// verified domain address at that point — Resend will reject sends from
// an unverified domain, so an accidental flip without domain verification
// fails loud rather than silently landing in spam.
const FROM_FALLBACK = "Ignia <onboarding@resend.dev>";
const FROM_ENV = process.env.MACROLOG_EMAIL_FROM;
export const FROM_EMAIL = FROM_ENV && FROM_ENV.length > 0 ? FROM_ENV : FROM_FALLBACK;
export const REPLY_TO = "gabrielandresbermudez@gmail.com";

export function getResend(): Resend {
  const key = resendApiKey.value();
  if (!key) {
    throw new Error("RESEND_API_KEY secret is not configured");
  }
  return new Resend(key);
}

// One-click unsubscribe (RFC 8058). Even transactional welcome emails
// land in inboxes faster when these headers are present; some providers
// treat their absence as a soft spam signal.
export function emailHeaders(): Record<string, string> {
  return {
    "List-Unsubscribe": `<mailto:${REPLY_TO}?subject=unsubscribe>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export function baseSendOptions() {
  return {
    from: FROM_EMAIL,
    replyTo: REPLY_TO,
    headers: emailHeaders(),
  };
}
