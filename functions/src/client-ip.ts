/**
 * The client IP a request-scoped throttle should key on.
 *
 * `x-forwarded-for` is a comma-separated chain that grows from the LEFT: each
 * hop appends what IT saw, so the first entry is whatever the original client
 * chose to send and the last entry is what the nearest trusted proxy observed.
 * Cloud Run's front end appends the real peer address as the LAST entry, and
 * `logWebhook` and the callables (`sendPasswordReset`) are called on their
 * Cloud Run / cloudfunctions.net URLs directly (no Firebase Hosting rewrite in
 * `firebase.json`), so the last entry is the only one that was not
 * client-supplied. Do NOT use `req.ip` for this: the functions framework
 * turns on Express's `trust proxy`, which makes `req.ip` the FIRST entry —
 * the client's own claim. It is only the fallback when the header is absent.
 * (A route that IS served through a Hosting rewrite gains one more trusted
 * hop and would need the second-to-last entry; none exists today.)
 *
 * Keying on `[0]` — what this did until 2026-09-28 — let a caller rotate a
 * fake first entry per request and never share a bucket, which turned the
 * brute-force throttle on `webhookApiKey` into a formality.
 *
 * Pure: takes the header value and the framework's `req.ip` fallback so it can
 * be unit-tested without an Express request.
 */
export function clientIp(
  forwardedFor: string | string[] | undefined,
  fallback: string | undefined,
): string {
  const raw = Array.isArray(forwardedFor) ? forwardedFor.join(",") : forwardedFor;
  if (raw) {
    const parts = raw.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
    const last = parts[parts.length - 1];
    if (last) return last;
  }
  return fallback && fallback.length > 0 ? fallback : "unknown";
}
