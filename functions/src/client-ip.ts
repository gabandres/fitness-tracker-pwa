/**
 * The client IP a request-scoped throttle should key on.
 *
 * `x-forwarded-for` is a comma-separated chain that grows from the LEFT: each
 * hop appends what IT saw, so the first entry is whatever the original client
 * chose to send and the last entry is what the nearest trusted proxy observed.
 * Cloud Run's front end appends the real peer address as the LAST entry, and
 * `logWebhook` is called on its Cloud Run URL directly (no Firebase Hosting
 * rewrite in `firebase.json`), so the last entry is the only one that was
 * not client-supplied.
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
