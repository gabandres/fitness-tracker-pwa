import { describe, expect, it } from "vitest";
import { HttpsError } from "firebase-functions/v2/https";
import { DailyQuota, utcDayKey } from "../src/daily-quota";
import { freshUid, testDb } from "./helpers";

const db = testDb();
const quota = new DailyQuota(db);

async function expectQuotaExceeded(p: Promise<unknown>, code: string, limit: number): Promise<void> {
  try {
    await p;
    expect.unreachable("expected resource-exhausted");
  } catch (err) {
    expect(err).toBeInstanceOf(HttpsError);
    const e = err as HttpsError;
    expect(e.code).toBe("resource-exhausted");
    expect((e.details as { code: string; limit: number }).code).toBe(code);
    expect((e.details as { code: string; limit: number }).limit).toBe(limit);
  }
}

describe("utcDayKey", () => {
  it("formats YYYY-MM-DD in UTC", () => {
    expect(utcDayKey(new Date("2026-06-11T23:59:59Z"))).toBe("2026-06-11");
    expect(utcDayKey(new Date("2026-06-12T00:00:01Z"))).toBe("2026-06-12");
  });
});

describe("limitFor", () => {
  it("returns the tiered caps", () => {
    expect(quota.limitFor("photo", false)).toBe(3);
    expect(quota.limitFor("photo", true)).toBe(30);
    expect(quota.limitFor("consultation", false)).toBe(3);
    expect(quota.limitFor("consultation", true)).toBe(30);
  });
});

describe("reserve", () => {
  it("counts down the free cap and throws on the over-limit call", async () => {
    const uid = freshUid();
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 1, remaining: 2 });
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 2, remaining: 1 });
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 3, remaining: 0 });
    await expectQuotaExceeded(quota.reserve(uid, "photo", false), "PHOTO_QUOTA_EXCEEDED", 3);
    expect(await quota.peek(uid, "photo")).toBe(3); // failed reserve consumed nothing
  });

  it("uses the paid cap for paid callers", async () => {
    const uid = freshUid();
    expect(await quota.reserve(uid, "consultation", true)).toEqual({ usedAfter: 1, remaining: 29 });
  });

  it("throws the consultation code for consultation overruns", async () => {
    const uid = freshUid();
    for (let i = 0; i < 3; i++) await quota.reserve(uid, "consultation", false);
    await expectQuotaExceeded(quota.reserve(uid, "consultation", false), "CONSULTATION_QUOTA_EXCEEDED", 3);
  });

  it("keeps kinds isolated", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false);
    expect(await quota.peek(uid, "photo")).toBe(1);
    expect(await quota.peek(uid, "consultation")).toBe(0);
  });
});

describe("release", () => {
  it("refunds a reserved slot", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "consultation", false);
    await quota.reserve(uid, "consultation", false);
    expect(await quota.release(uid, "consultation")).toBe(true);
    expect(await quota.peek(uid, "consultation")).toBe(1);
  });

  it("never goes below zero — no credit from spam releases", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "consultation", false);
    expect(await quota.release(uid, "consultation")).toBe(true);
    expect(await quota.release(uid, "consultation")).toBe(false);
    expect(await quota.release(uid, "consultation")).toBe(false);
    expect(await quota.peek(uid, "consultation")).toBe(0);
    // The floor means the next reserve starts from 0, not negative.
    expect(await quota.reserve(uid, "consultation", false)).toEqual({ usedAfter: 1, remaining: 2 });
  });

  it("is a no-op when no doc exists yet", async () => {
    const uid = freshUid();
    expect(await quota.release(uid, "photo")).toBe(false);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });
});

describe("resetToday", () => {
  it("clears today's docs for both kinds", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false);
    await quota.reserve(uid, "consultation", false);
    await quota.resetToday(uid);
    expect(await quota.peek(uid, "photo")).toBe(0);
    expect(await quota.peek(uid, "consultation")).toBe(0);
  });
});

describe("deleteAll + dump", () => {
  it("dumps every quota doc for the uid and deletes them all", async () => {
    const uid = freshUid();
    const other = freshUid();
    await quota.reserve(uid, "photo", false);
    await quota.reserve(uid, "consultation", false);
    await quota.reserve(other, "photo", false);

    const photoDocs = await quota.dump(uid, "photo");
    expect(photoDocs).toHaveLength(1);
    expect(photoDocs[0].id).toBe(`${uid}_${utcDayKey()}`);
    expect(photoDocs[0].uid).toBe(uid);

    await quota.deleteAll(uid);
    expect(await quota.dump(uid, "photo")).toHaveLength(0);
    expect(await quota.dump(uid, "consultation")).toHaveLength(0);
    // Other users' docs untouched.
    expect(await quota.peek(other, "photo")).toBe(1);
  });
});
