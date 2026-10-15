/**
 * Recipe-URL import fetch proxy (v1.1). A dumb, hardened server-side fetch:
 * the browser can't fetch arbitrary recipe pages (no CORS on those sites), so
 * this callable fetches the page, extracts only its schema.org JSON-LD blocks,
 * and returns them for the client to parse via `@macrolog/core`
 * (`parseRecipeFromHtml`). ALL parsing/normalization stays in core — this
 * function only fetches and slims the payload.
 *
 * Mobile does NOT use this (React Native fetch isn't CORS-bound; it fetches +
 * parses directly). Web-only.
 *
 * Security: fetching a user-supplied URL server-side is an SSRF vector, so the
 * URL is validated (https only, standard port) and its resolved IP is checked
 * against private / loopback / link-local / metadata ranges. Since 2026-10-15:
 *
 *  - Redirects are followed MANUALLY, at most {@link MAX_REDIRECTS} hops, and
 *    every hop is validated before it is requested. `redirect: "follow"` used
 *    to let the runtime fetch each hop itself and only the FINAL URL was
 *    checked — after the request to an internal address had already gone out.
 *  - The connection is PINNED to the address that was validated. Resolving
 *    once to check and letting the HTTP client resolve again to connect is a
 *    DNS-rebinding window: a hostile resolver answers "public" to the check
 *    and "169.254.169.254" to the connect. The request now goes through
 *    `https.request` with a `lookup` that returns only the checked address,
 *    while SNI and the Host header keep the real hostname, so TLS still
 *    verifies the certificate for it.
 *
 * Response is size- and time-capped and must be HTML.
 *
 * NOTE: nothing in the repo calls this callable any more — the web logging app
 * that used it was retired (ADR-0036) and mobile fetches recipes directly.
 * Deleting it is the owner's call; until then it stays hardened.
 */
import { lookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";

const MIN_INTERVAL_MS = 1000;          // per-uid spam guard (in-memory, best-effort)
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;           // 2 MB cap on the fetched page
const MAX_URL_LEN = 2048;
const MAX_REDIRECTS = 3;
// A real browser UA — many recipe sites serve a bot challenge (or nothing) to
// non-browser agents, which would surface as "no recipe found".
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const lastCallByUid = new Map<string, number>();

/** True when an IP literal sits in a private / loopback / link-local / unique-
 *  local / CGNAT / metadata range that must never be reachable via this proxy. */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;            // link-local + GCP/AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true;                          // multicast + reserved
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("fe80")) return true;                          // link-local
    if (lower.startsWith("ff")) return true;                            // multicast
    if (lower.startsWith("::ffff:")) {
      // v4-mapped, in BOTH spellings. WHATWG URL parsing normalises
      // `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, and only the
      // dotted form used to be checked — the hex form sailed through.
      const tail = lower.slice(7);
      if (isIP(tail) === 4) return isBlockedIp(tail);
      const m = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(tail);
      if (m) {
        const hi = parseInt(m[1], 16);
        const lo = parseInt(m[2], 16);
        return isBlockedIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
      return true; // an unrecognised mapped form is not worth the risk
    }
    if (lower.startsWith("64:ff9b:")) return true; // NAT64 — reaches IPv4 space
    return false;
  }
  return false;
}

const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
]);

/** Validate a user-supplied URL and confirm it resolves to a public address.
 *  Throws a typed HttpsError on any failure. Returns the normalized URL and
 *  the ONE address the request must connect to (see the pinning note above). */
export async function assertPublicUrl(
  raw: string,
  resolve: (host: string) => Promise<{ address: string; family: number }[]> = (host) =>
    lookup(host, { all: true }),
): Promise<{ url: URL; address: string; family: number }> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpsError("invalid-argument", "Not a valid URL.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  if (url.protocol !== "https:") {
    throw new HttpsError("invalid-argument", "Only https URLs are supported.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  if (url.port && url.port !== "443") {
    throw new HttpsError("invalid-argument", "Non-standard ports are not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new HttpsError("invalid-argument", "That host is not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  // If the host is an IP literal, check it directly; else resolve it.
  // `URL` keeps IPv6 literals bracketed; strip them for `isIP`.
  const bare = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  const literal = isIP(bare);
  if (literal) {
    if (isBlockedIp(bare)) {
      throw new HttpsError("invalid-argument", "That address is not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
    }
    return { url, address: bare, family: literal };
  }
  let resolved: { address: string; family: number }[];
  try {
    resolved = await resolve(host);
  } catch {
    throw new HttpsError("invalid-argument", "Host could not be resolved.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  if (resolved.length === 0 || resolved.some((r) => isBlockedIp(r.address))) {
    throw new HttpsError("invalid-argument", "That address is not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
  }
  return { url, address: resolved[0].address, family: resolved[0].family };
}

/**
 * One GET to an already-validated target, connected to `address` and nothing
 * else. Never follows redirects itself.
 */
function getPinned(
  target: { url: URL; address: string; family: number },
  signal: AbortSignal,
): Promise<IncomingMessage> {
  return new Promise((resolvePromise, reject) => {
    const req = httpsRequest(
      target.url,
      {
        method: "GET",
        signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
        // The pin. Node calls this instead of DNS; whatever the hostname
        // resolves to NOW is irrelevant — the validated address is the only
        // one this socket can reach. Handles both callback shapes (`all`).
        lookup: (_host: string, opts: { all?: boolean }, cb: (...args: unknown[]) => void) => {
          if (opts && opts.all) cb(null, [{ address: target.address, family: target.family }]);
          else cb(null, target.address, target.family);
        },
      } as Parameters<typeof httpsRequest>[1],
      (res) => resolvePromise(res),
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Read the body, bounded by MAX_BYTES. When Content-Length advertises more
 * than the cap we reject before reading a byte; a chunked page is read until
 * the cap and then cut off (enough to hold any <head> JSON-LD).
 */
async function readCappedStream(res: IncomingMessage): Promise<string> {
  const len = Number(res.headers["content-length"] ?? 0);
  if (Number.isFinite(len) && len > MAX_BYTES) {
    res.resume();
    throw new HttpsError("invalid-argument", "That page is too large to import.", {
      code: ErrorCode.RECIPE_FETCH_FAILED,
    });
  }
  const decoder = new TextDecoder();
  let out = "";
  let total = 0;
  for await (const chunk of res) {
    const buf = chunk as Buffer;
    total += buf.byteLength;
    out += decoder.decode(buf, { stream: true });
    if (total > MAX_BYTES) {
      res.destroy();
      break;
    }
  }
  return out;
}

/**
 * GET `startHref`, following at most {@link MAX_REDIRECTS} redirects by hand.
 * Every hop is re-validated (scheme, port, host, resolved address) BEFORE it
 * is requested, and each request is pinned to the address validated for it.
 */
export async function fetchPublicHtml(
  startHref: string,
  signal: AbortSignal,
  deps: {
    validate?: typeof assertPublicUrl;
    get?: typeof getPinned;
  } = {},
): Promise<{ status: number; contentType: string; body: string }> {
  const validate = deps.validate ?? assertPublicUrl;
  const get = deps.get ?? getPinned;
  let target = await validate(startHref);
  for (let hop = 0; ; hop++) {
    const res = await get(target, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume(); // discard the redirect body
      if (hop >= MAX_REDIRECTS) {
        throw new HttpsError("unavailable", "Too many redirects.", { code: ErrorCode.RECIPE_FETCH_FAILED });
      }
      // Relative Locations resolve against the CURRENT hop, then the result
      // goes through the full check — scheme and port included.
      target = await validate(new URL(res.headers.location, target.url).href);
      continue;
    }
    if (status < 200 || status >= 300) {
      res.resume();
      throw new HttpsError("unavailable", `Page returned ${status}.`, { code: ErrorCode.RECIPE_FETCH_FAILED });
    }
    const contentType = String(res.headers["content-type"] ?? "");
    if (!contentType.includes("html")) {
      res.resume();
      throw new HttpsError("invalid-argument", "That URL is not a web page.", { code: ErrorCode.RECIPE_URL_INVALID });
    }
    return { status, contentType, body: await readCappedStream(res) };
  }
}

/** Pull only the <script type="application/ld+json"> blocks out of the page and
 *  re-wrap them, so the client receives a few KB of JSON-LD instead of the full
 *  page. Core does the actual parsing over this. */
function slimToJsonLd(html: string): string {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
  const blocks = html.match(re);
  return blocks ? blocks.join("\n") : "";
}

export const importRecipe = onCall(
  { maxInstances: 5, memory: "512MiB" },
  async (request): Promise<{ html: string }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Must be signed in.", { code: ErrorCode.UNAUTHENTICATED });
    }
    const uid = request.auth.uid;

    const now = Date.now();
    const last = lastCallByUid.get(uid) ?? 0;
    if (now - last < MIN_INTERVAL_MS) {
      throw new HttpsError("resource-exhausted", "Slow down.", { code: ErrorCode.RATE_LIMITED });
    }
    lastCallByUid.set(uid, now);

    const { url } = (request.data ?? {}) as { url?: unknown };
    if (typeof url !== "string" || url.length === 0 || url.length > MAX_URL_LEN) {
      throw new HttpsError("invalid-argument", "Provide { url }.", { code: ErrorCode.RECIPE_URL_INVALID });
    }

    // The abort timer spans BOTH the fetch and the body read (a recipe host
    // that accepts the connection but stalls the body would otherwise hang to
    // the function timeout → 503). Everything network-facing is wrapped so any
    // unexpected throw becomes a clean callable error, never an instance crash.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    try {
      const page = await fetchPublicHtml(url, controller.signal);
      html = slimToJsonLd(page.body);
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Network reset, DNS hiccup, abort/timeout, bot-block connection drop, or
      // an unexpected stream error — surface one clean, typed failure.
      console.error("importRecipe fetch failed", { err });
      throw new HttpsError("unavailable", "Could not fetch that page.", { code: ErrorCode.RECIPE_FETCH_FAILED });
    } finally {
      clearTimeout(timer);
    }

    if (!html) {
      throw new HttpsError("not-found", "No recipe data found on that page.", { code: ErrorCode.RECIPE_NOT_FOUND });
    }
    return { html };
  },
);
