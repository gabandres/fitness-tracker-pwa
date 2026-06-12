import { beforeEach, describe, expect, it } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { HttpsError } from "firebase-functions/v2/https";
import { CallerAccess, CallerRequestLike } from "../src/caller-access";
import { ErrorCode } from "../src/error-codes";
import { freshUid, testDb } from "./helpers";

const db = testDb();
const access = new CallerAccess(db);

function req(uid: string, token: { email?: string; stripeRole?: string } = {}): CallerRequestLike {
  return { auth: { uid, token } };
}

beforeEach(() => access.clearCaches());

describe("resolveCaller — auth", () => {
  it("throws UNAUTHENTICATED when not signed in", async () => {
    try {
      await access.resolveCaller({ auth: null });
      expect.unreachable("expected unauthenticated");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      expect((err as HttpsError).code).toBe("unauthenticated");
      expect(((err as HttpsError).details as { code: string }).code).toBe(ErrorCode.UNAUTHENTICATED);
    }
  });
});

describe("resolveCaller — tier", () => {
  it("defaults to free with no claims", async () => {
    const caller = await access.resolveCaller(req(freshUid(), { email: "nobody@example.com" }));
    expect(caller.tier).toBe("free");
    expect(caller.unlimited).toBe(false);
  });

  it("maps stripeRole=paid to the paid tier", async () => {
    const caller = await access.resolveCaller(req(freshUid(), { email: "payer@example.com", stripeRole: "paid" }));
    expect(caller.tier).toBe("paid");
    expect(caller.unlimited).toBe(false);
  });

  it("recognises the admin email", async () => {
    const caller = await access.resolveCaller(req(freshUid(), { email: "gabrielandresbermudez@gmail.com" }));
    expect(caller.tier).toBe("admin");
    expect(caller.unlimited).toBe(true);
    expect(caller.paidClaim).toBe(false);
  });

  it("keeps the raw paid claim visible on unlimited tiers", async () => {
    // Tiers are mutually exclusive (admin outranks paid) but decorative
    // limit displays still need to know the caller pays.
    const caller = await access.resolveCaller(
      req(freshUid(), { email: "gabrielandresbermudez@gmail.com", stripeRole: "paid" }),
    );
    expect(caller.tier).toBe("admin");
    expect(caller.paidClaim).toBe(true);
  });

  it("comps emails on config/accessList (case-insensitive)", async () => {
    await db.doc("config/accessList").set({ compedEmails: ["Friend@Example.com"] });
    access.clearCaches();
    const caller = await access.resolveCaller(req(freshUid(), { email: "friend@example.com" }));
    expect(caller.tier).toBe("comped");
    expect(caller.unlimited).toBe(true);
  });

  it("comps a future referral compedUntil — quota bypass, not just a UI badge", async () => {
    const uid = freshUid();
    await db.doc(`users/${uid}`).set({ compedUntil: Timestamp.fromMillis(Date.now() + 86_400_000) });
    const caller = await access.resolveCaller(req(uid, { email: "referred@example.com" }));
    expect(caller.tier).toBe("comped");
    expect(caller.unlimited).toBe(true);
  });

  it("treats an expired compedUntil as not comped", async () => {
    const uid = freshUid();
    await db.doc(`users/${uid}`).set({ compedUntil: Timestamp.fromMillis(Date.now() - 1_000) });
    const caller = await access.resolveCaller(req(uid, { email: "lapsed@example.com" }));
    expect(caller.tier).toBe("free");
  });

  it("expired referral falls through to paid when stripeRole is set", async () => {
    const uid = freshUid();
    await db.doc(`users/${uid}`).set({ compedUntil: Timestamp.fromMillis(Date.now() - 1_000) });
    const caller = await access.resolveCaller(req(uid, { email: "lapsed-payer@example.com", stripeRole: "paid" }));
    expect(caller.tier).toBe("paid");
  });

  it("caches comped lookups until clearCaches", async () => {
    const email = `late-${freshUid()}@example.com`;
    const first = await access.resolveCaller(req(freshUid(), { email }));
    expect(first.tier).toBe("free");
    // Grant arrives after the lookup was cached — still free…
    const snap = await db.doc("config/accessList").get();
    const current = (snap.data()?.compedEmails as string[]) ?? [];
    await db.doc("config/accessList").set({ compedEmails: [...current, email] });
    const cached = await access.resolveCaller(req(freshUid(), { email }));
    expect(cached.tier).toBe("free");
    // …until the cache drops (60s TTL in prod).
    access.clearCaches();
    const fresh = await access.resolveCaller(req(freshUid(), { email }));
    expect(fresh.tier).toBe("comped");
  });
});

describe("resolveCaller — rate limit", () => {
  const SPEC = { collection: "testRateLimit", minIntervalMs: 60_000, errorCode: ErrorCode.RATE_LIMITED };

  it("throttles a second call inside the window with retryAfterMs", async () => {
    const uid = freshUid();
    await access.resolveCaller(req(uid, {}), SPEC);
    try {
      await access.resolveCaller(req(uid, {}), SPEC);
      expect.unreachable("expected resource-exhausted");
    } catch (err) {
      expect(err).toBeInstanceOf(HttpsError);
      const e = err as HttpsError;
      expect(e.code).toBe("resource-exhausted");
      const details = e.details as { code: string; retryAfterMs: number };
      expect(details.code).toBe(ErrorCode.RATE_LIMITED);
      expect(details.retryAfterMs).toBeGreaterThan(0);
      expect(details.retryAfterMs).toBeLessThanOrEqual(60_000);
    }
  });

  it("rate limits per uid, not globally", async () => {
    await access.resolveCaller(req(freshUid(), {}), SPEC);
    await access.resolveCaller(req(freshUid(), {}), SPEC); // different uid — no throw
  });

  it("skips the rate limit when no spec is given", async () => {
    const uid = freshUid();
    await access.resolveCaller(req(uid, {}));
    await access.resolveCaller(req(uid, {})); // no throw
  });
});
