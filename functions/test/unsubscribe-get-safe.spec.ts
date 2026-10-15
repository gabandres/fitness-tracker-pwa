import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { freshUid, testDb } from "./helpers";

// The secret param reads process.env at call time; set before the handler runs.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "test-resend-key";

import { confirmPage, unsubscribeToken, unsubscribeWeeklyDigest } from "../src/unsubscribe";

/**
 * Link scanners (Safe Links, Mimecast, Proofpoint) GET every link in a mail.
 * Until 2026-10-15 a GET unsubscribed — so a recipient behind one was opted
 * out the moment the digest was scanned. GET now only confirms; the POST (the
 * RFC 8058 one-click, or the page's button) is what writes.
 */
function fakeRes() {
  const r = { statusCode: 0, body: "", headers: {} as Record<string, string> };
  // Enough of an Express response for the onRequest wrapper's cors
  // middleware (`on`, `setHeader`, `getHeader`, `end`) and for the handler.
  const res = {
    on() { return res; },
    setHeader(k: string, v: string) { r.headers[k] = v; },
    getHeader(k: string) { return r.headers[k]; },
    end() { return res; },
    set(k: string, v: string) { r.headers[k] = v; return res; },
    status(c: number) { r.statusCode = c; return res; },
    send(b: string) { r.body = b; return res; },
  };
  return { r, res };
}

async function hit(method: string, token: string) {
  const { r, res } = fakeRes();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (unsubscribeWeeklyDigest as any)({ method, query: { u: token }, headers: {} }, res);
  return r;
}

describe("unsubscribe: GET confirms, POST writes (emulator)", () => {
  it("a GET leaves the opt-in untouched and renders a POST form", async () => {
    const db = testDb();
    const uid = freshUid("unsub");
    await db.doc(`users/${uid}`).set({ weeklyDigestOptIn: true, createdAt: Timestamp.fromDate(new Date("2000-01-01")) });
    const token = unsubscribeToken(uid, process.env.RESEND_API_KEY!);

    const r = await hit("GET", token);
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain('method="post"');
    expect((await db.doc(`users/${uid}`).get()).data()?.["weeklyDigestOptIn"]).toBe(true);

    const p = await hit("POST", token);
    expect(p.statusCode).toBe(200);
    expect((await db.doc(`users/${uid}`).get()).data()?.["weeklyDigestOptIn"]).toBe(false);
  });

  it("a bad token writes nothing on either verb", async () => {
    const r = await hit("POST", "nope.nope");
    expect(r.body).toContain("couldn't read that link");
  });
});

describe("confirmPage", () => {
  it("posts back to the same signed URL and escapes the token", () => {
    const html = confirmPage('abc"><script>x</script>', "en");
    expect(html).toContain('method="post"');
    expect(html).toContain("https://ignia.fit/unsubscribe?u=");
    expect(html).not.toContain("<script>x</script>");
  });

  it("is localised", () => {
    expect(confirmPage("t", "es-PR")).toContain("Cancelar suscripción");
    expect(confirmPage("t", "pt-BR")).toContain("Cancelar inscrição");
  });
});
