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
 * against private / loopback / link-local / metadata ranges BEFORE and AFTER
 * redirects. Response is size- and time-capped and must be HTML.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";

const MIN_INTERVAL_MS = 1000;          // per-uid spam guard (in-memory, best-effort)
const FETCH_TIMEOUT_MS = 8000;
const MAX_BYTES = 2_000_000;           // 2 MB cap on the fetched page
const MAX_URL_LEN = 2048;
const USER_AGENT = "IgniaRecipeImporter/1.0 (+https://ignia.fit)";

const lastCallByUid = new Map<string, number>();

/** True when an IP literal sits in a private / loopback / link-local / unique-
 *  local / CGNAT / metadata range that must never be reachable via this proxy. */
function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;            // link-local + GCP/AWS metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;  // CGNAT
    return false;
  }
  if (v === 6) {
    const lower = ip.toLowerCase();
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // unique-local
    if (lower.startsWith("fe80")) return true;                          // link-local
    if (lower.startsWith("::ffff:")) return isBlockedIp(lower.slice(7)); // v4-mapped
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
 *  Throws a typed HttpsError on any failure. Returns the normalized href. */
async function assertPublicUrl(raw: string): Promise<string> {
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
  const literal = isIP(host);
  if (literal) {
    if (isBlockedIp(host)) {
      throw new HttpsError("invalid-argument", "That address is not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
    }
  } else {
    let resolved: { address: string }[];
    try {
      resolved = await lookup(host, { all: true });
    } catch {
      throw new HttpsError("invalid-argument", "Host could not be resolved.", { code: ErrorCode.RECIPE_URL_INVALID });
    }
    if (resolved.length === 0 || resolved.some((r) => isBlockedIp(r.address))) {
      throw new HttpsError("invalid-argument", "That address is not allowed.", { code: ErrorCode.RECIPE_URL_INVALID });
    }
  }
  return url.href;
}

/** Pull only the <script type="application/ld+json"> blocks out of the page and
 *  re-wrap them, so the client receives a few KB of JSON-LD instead of the full
 *  page. Core does the actual parsing over this. */
function slimToJsonLd(html: string): string {
  const re = /<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>/gi;
  const blocks = html.match(re);
  return blocks ? blocks.join("\n") : "";
}

/** Read the response body up to MAX_BYTES, aborting once the cap is passed. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      total += value.length;
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
  }
  return Buffer.concat(chunks).toString("utf8");
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

    const href = await assertPublicUrl(url);

    // The abort timer spans BOTH the fetch and the body read (a recipe host
    // that accepts the connection but stalls the body would otherwise hang to
    // the function timeout → 503). Everything network-facing is wrapped so any
    // unexpected throw becomes a clean callable error, never an instance crash.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    let html: string;
    try {
      const res = await fetch(href, {
        method: "GET",
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      });

      // Re-validate after redirects: the final URL must still be public HTML.
      await assertPublicUrl(res.url || href);
      if (!res.ok) {
        throw new HttpsError("unavailable", `Page returned ${res.status}.`, { code: ErrorCode.RECIPE_FETCH_FAILED });
      }
      const contentType = res.headers.get("content-type") ?? "";
      if (!contentType.includes("html")) {
        throw new HttpsError("invalid-argument", "That URL is not a web page.", { code: ErrorCode.RECIPE_URL_INVALID });
      }

      html = slimToJsonLd(await readCapped(res));
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      // Network reset, DNS hiccup, abort/timeout, bot-block connection drop, or
      // an unexpected stream error — surface one clean, typed failure.
      console.error("importRecipe fetch failed", { href, err });
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
