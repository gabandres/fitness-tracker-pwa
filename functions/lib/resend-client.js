"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.REPLY_TO = exports.FROM_EMAIL = exports.resendApiKey = void 0;
exports.getResend = getResend;
exports.emailHeaders = emailHeaders;
exports.baseSendOptions = baseSendOptions;
const params_1 = require("firebase-functions/params");
const resend_1 = require("resend");
// `defineSecret` returns a `SecretParam` whose type lives at
// firebase-functions/lib/params/types — not a public module path, which
// makes the inferred export unportable under `declaration: true`. Annotate
// explicitly with `ReturnType<typeof defineSecret>` so downstream imports
// (index.ts uses it for `secrets: [resendApiKey]`) stay resolvable.
exports.resendApiKey = (0, params_1.defineSecret)("RESEND_API_KEY");
// Pointing at the default Resend sandbox sender until macrolog.app (or
// another owned domain) is verified in Resend. Switch FROM_EMAIL to the
// verified domain address at that point — Resend will reject sends from
// an unverified domain, so an accidental flip without domain verification
// fails loud rather than silently landing in spam.
const FROM_FALLBACK = "Macro Log <onboarding@resend.dev>";
const FROM_ENV = process.env.MACROLOG_EMAIL_FROM;
exports.FROM_EMAIL = FROM_ENV && FROM_ENV.length > 0 ? FROM_ENV : FROM_FALLBACK;
exports.REPLY_TO = "gabrielandresbermudez@gmail.com";
function getResend() {
    const key = exports.resendApiKey.value();
    if (!key) {
        throw new Error("RESEND_API_KEY secret is not configured");
    }
    return new resend_1.Resend(key);
}
// One-click unsubscribe (RFC 8058). Even transactional welcome emails
// land in inboxes faster when these headers are present; some providers
// treat their absence as a soft spam signal.
function emailHeaders() {
    return {
        "List-Unsubscribe": `<mailto:${exports.REPLY_TO}?subject=unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    };
}
function baseSendOptions() {
    return {
        from: exports.FROM_EMAIL,
        replyTo: exports.REPLY_TO,
        headers: emailHeaders(),
    };
}
//# sourceMappingURL=resend-client.js.map