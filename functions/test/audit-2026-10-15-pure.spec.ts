import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractWebhookApiKey } from "../src/log-webhook";
import { isExpoPushToken } from "../src/announce-ota";
import { assertPublicUrl, fetchPublicHtml, isBlockedIp } from "../src/import-recipe";

const src = (f: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../src/${f}`), "utf8");

describe("logWebhook rejects a missing/malformed key before any I/O", () => {
  it("accepts only a 36-char key from x-api-key or Bearer", () => {
    const key = "123e4567-e89b-12d3-a456-426614174000";
    expect(extractWebhookApiKey({ "x-api-key": key })).toBe(key);
    expect(extractWebhookApiKey({ authorization: `Bearer ${key}` })).toBe(key);
    expect(extractWebhookApiKey({})).toBeNull();
    expect(extractWebhookApiKey({ "x-api-key": "short" })).toBeNull();
    expect(extractWebhookApiKey({ "x-api-key": `${key}x` })).toBeNull();
    expect(extractWebhookApiKey({ authorization: "Basic abc" })).toBeNull();
  });

  it("shape-checks before the throttle write", () => {
    const s = src("log-webhook.ts");
    expect(s.indexOf("extractWebhookApiKey(req.headers)")).toBeLessThan(s.indexOf("await throttled(ip)"));
  });
});

describe("Expo push tokens are validated before chunking", () => {
  it("accepts both spellings, rejects everything else", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc-DEF_123]")).toBe(true);
    for (const bad of ["", "ExponentPushToken[]", "https://evil/hook", "ExponentPushToken[a b]", 42, null]) {
      expect(isExpoPushToken(bad)).toBe(false);
    }
  });
});

describe("import-recipe SSRF hardening", () => {
  it("blocks the v4-mapped metadata address in its HEX spelling too", () => {
    // `new URL("https://[::ffff:169.254.169.254]/").hostname` is "[::ffff:a9fe:a9fe]".
    expect(new URL("https://[::ffff:169.254.169.254]/").hostname).toBe("[::ffff:a9fe:a9fe]");
    expect(isBlockedIp("::ffff:a9fe:a9fe")).toBe(true);
    expect(isBlockedIp("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedIp("::ffff:0808:0808")).toBe(false); // 8.8.8.8
    expect(isBlockedIp("224.0.0.1")).toBe(true);
    expect(isBlockedIp("93.184.216.34")).toBe(false);
  });

  it("rejects an IPv6-literal URL to the metadata server", async () => {
    await expect(assertPublicUrl("https://[::ffff:169.254.169.254]/")).rejects.toMatchObject({
      details: { code: "RECIPE_URL_INVALID" },
    });
  });

  it("returns the validated address so the connection can be pinned to it", async () => {
    const t = await assertPublicUrl("https://recipes.example/x", async () => [{ address: "93.184.216.34", family: 4 }]);
    expect(t.address).toBe("93.184.216.34");
  });

  // A fake GET that redirects; records every target it was asked to fetch.
  function fakeGet(locations: string[]) {
    const asked: string[] = [];
    let i = 0;
    const get = async (target: { url: URL; address: string }) => {
      asked.push(`${target.url.href}@${target.address}`);
      const loc = locations[i++];
      const res = {
        statusCode: loc ? 302 : 200,
        headers: loc ? { location: loc } : { "content-type": "text/html" },
        resume() {},
        destroy() {},
        async *[Symbol.asyncIterator]() { yield Buffer.from("<html></html>"); },
      };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return res as any;
    };
    return { get, asked };
  }
  const publicDns = async () => [{ address: "93.184.216.34", family: 4 }];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const validate = ((raw: string) => assertPublicUrl(raw, publicDns)) as any;

  it("validates a redirect hop BEFORE requesting it — an internal hop is never fetched", async () => {
    const { get, asked } = fakeGet(["https://169.254.169.254/computeMetadata/v1/"]);
    await expect(
      fetchPublicHtml("https://recipes.example/x", new AbortController().signal, { validate, get }),
    ).rejects.toMatchObject({ details: { code: "RECIPE_URL_INVALID" } });
    expect(asked).toEqual(["https://recipes.example/x@93.184.216.34"]);
  });

  it("refuses an http:// redirect hop", async () => {
    const { get } = fakeGet(["http://recipes.example/insecure"]);
    await expect(
      fetchPublicHtml("https://recipes.example/x", new AbortController().signal, { validate, get }),
    ).rejects.toMatchObject({ details: { code: "RECIPE_URL_INVALID" } });
  });

  it("follows at most 3 redirects", async () => {
    const hops = ["/a", "/b", "/c", "/d"];
    const { get, asked } = fakeGet(hops);
    await expect(
      fetchPublicHtml("https://recipes.example/x", new AbortController().signal, { validate, get }),
    ).rejects.toMatchObject({ details: { code: "RECIPE_FETCH_FAILED" } });
    expect(asked).toHaveLength(4);
  });

  it("follows a short public chain and returns the page", async () => {
    const { get } = fakeGet(["/a", "https://other.example/b"]);
    const page = await fetchPublicHtml("https://recipes.example/x", new AbortController().signal, { validate, get });
    expect(page.body).toContain("<html>");
  });
});

describe("mail goes to the Auth record, never the client-writable profile email", () => {
  it("weekly digest, welcome and day-1 nudge read no profile `email`", () => {
    for (const f of ["weekly-digest.ts", "user-lifecycle.ts", "day1-nudge.ts"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/data\["email"\]/);
      expect(s, f).not.toMatch(/after\.email/);
    }
  });
});

describe("password reset keys its IP budget on the trusted hop", () => {
  it("uses clientIp, not the spoofable rawRequest.ip", () => {
    const s = src("password-reset.ts");
    expect(s).toMatch(/clientIp\(request\.rawRequest\?\.headers\?\.\["x-forwarded-for"\]/);
    expect(s).not.toMatch(/const ip = request\.rawRequest\?\.ip \|\|/);
  });
});
