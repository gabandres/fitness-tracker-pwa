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
    const day = utcDayKey();
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 1, remaining: 2, day });
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 2, remaining: 1, day });
    expect(await quota.reserve(uid, "photo", false)).toEqual({ usedAfter: 3, remaining: 0, day });
    await expectQuotaExceeded(quota.reserve(uid, "photo", false), "PHOTO_QUOTA_EXCEEDED", 3);
    expect(await quota.peek(uid, "photo")).toBe(3); // failed reserve consumed nothing
  });

  it("uses the paid cap for paid callers", async () => {
    const uid = freshUid();
    expect(await quota.reserve(uid, "consultation", true)).toEqual({ usedAfter: 1, remaining: 29, day: utcDayKey() });
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
    expect(await quota.reserve(uid, "consultation", false)).toEqual({
      usedAfter: 1,
      remaining: 2,
      day: utcDayKey(),
    });
  });

  it("is a no-op when no doc exists yet", async () => {
    const uid = freshUid();
    expect(await quota.release(uid, "photo")).toBe(false);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });

  /**
   * The reason `reserve` hands back a `day` at all. A scan reserved at
   * 23:59:59 and refunded at 00:00:01 must credit the day it charged — a
   * release that defaults to "today" would leave the overcharge in place AND
   * hand out a free scan tomorrow, wrong in both directions at once.
   */
  it("refunds the day it was told to, not today", async () => {
    const uid = freshUid();
    const yesterday = "2026-08-20";

    await quota.reserve(uid, "photo", false); // charges TODAY
    expect(await quota.peek(uid, "photo")).toBe(1);

    // A refund aimed at another day must not touch today's counter.
    expect(await quota.release(uid, "photo", yesterday)).toBe(false);
    expect(await quota.peek(uid, "photo")).toBe(1);

    // Aimed at the day actually charged, it lands.
    expect(await quota.release(uid, "photo", utcDayKey())).toBe(true);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });

  it("round-trips the day reserve reported", async () => {
    const uid = freshUid();
    const { day } = await quota.reserve(uid, "photo", false);
    expect(day).toBe(utcDayKey());
    expect(await quota.release(uid, "photo", day)).toBe(true);
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

/**
 * Multi-image capture (ADR-0029 item 5) is the whole reason this counts UNITS
 * and not calls. Before it, one call was one image and the two numbers were
 * the same, so nothing forced the distinction.
 *
 * The measured cost multiplier for three images is only ~1.4x, not 3x — output
 * tokens are two thirds of a scan and do not scale with image count. **That is
 * not why this matters.** A guard whose unit is wrong stops being a guard the
 * moment the feature it guards changes shape, however small the multiplier.
 */
describe("reserve(units) — charging per image", () => {
  it("consumes a slot per image", async () => {
    const uid = freshUid();
    const day = utcDayKey();
    expect(await quota.reserve(uid, "photo", false, 3)).toEqual({ usedAfter: 3, remaining: 0, day });
  });

  it("is ALL OR NOTHING when the request would overshoot", async () => {
    // The load-bearing case. With one slot left, a 3-image scan must be
    // refused outright — reserving 2 of 3 charges a user for a scan they never
    // receive, and `used >= limit` (the old test) would have let it through
    // and landed at 3-of-3 by overshoot.
    const uid = freshUid();
    await quota.reserve(uid, "photo", false, 2);
    await expectQuotaExceeded(quota.reserve(uid, "photo", false, 3), "PHOTO_QUOTA_EXCEEDED", 3);
    // And nothing was consumed by the failed attempt: one single still fits.
    expect((await quota.reserve(uid, "photo", false)).remaining).toBe(0);
  });

  it("defaults to one, so every existing caller is unchanged", async () => {
    const uid = freshUid();
    expect((await quota.reserve(uid, "photo", false)).usedAfter).toBe(1);
  });

  it("refuses a multi-image scan that alone exceeds a free day", async () => {
    // 3/day free: three images is exactly the whole allowance, four is not a
    // thing the client offers and must not be a thing the server accepts.
    const uid = freshUid();
    await expectQuotaExceeded(quota.reserve(uid, "photo", false, 4), "PHOTO_QUOTA_EXCEEDED", 3);
  });
});

describe("release(units) — the parameter used to be ignored", () => {
  /**
   * `release` accepted `units` and always refunded exactly 1. Harmless while
   * every caller reserved one slot; not harmless on 2026-08-26, when
   * `analyzePhoto` briefly reserved one per image and a failed 3-image scan
   * charged three and refunded one — a silent, permanent overcharge on the path
   * that only runs after something has already gone wrong.
   *
   * `analyzePhoto` reserves 1 again, so nothing is exposed to this today. It is
   * pinned because a parameter that lies is a trap for the next caller.
   */
  it("refunds the number of slots it was given", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false, 3);
    expect(await quota.peek(uid, "photo")).toBe(3);

    await quota.release(uid, "photo", undefined, 3);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });

  it("still defaults to one", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false, 2);
    await quota.release(uid, "photo");
    expect(await quota.peek(uid, "photo")).toBe(1);
  });

  it("cannot mint credit with an over-large refund", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false, 1);
    await quota.release(uid, "photo", undefined, 99);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });

  it("treats a zero or negative refund as one, never as a top-up", async () => {
    const uid = freshUid();
    await quota.reserve(uid, "photo", false, 2);
    await quota.release(uid, "photo", undefined, 0);
    expect(await quota.peek(uid, "photo")).toBe(1);
    await quota.release(uid, "photo", undefined, -5);
    expect(await quota.peek(uid, "photo")).toBe(0);
  });
});

describe("a photo scan costs ONE slot however many images it carries", () => {
  /**
   * The product rule, pinned where it can be read: the daily quota is a
   * FAIRNESS mechanism and counts what a person perceives doing, which is
   * meals. `spendCeiling` is the solvency mechanism and keeps counting images.
   *
   * Measured off production traffic: a 1-image scan is 1,989 input tokens and a
   * 3-image scan 4,254 — 1.6x, not 3x, because the static prompt is paid once
   * either way. Charging three slots overcharged by roughly double, and it did
   * it to the exact workflow multi-image exists for.
   */
  it("lets a free user log three separate meals, photos notwithstanding", async () => {
    // Three scans of one meal each, three photos apiece, is what the cap
    // invites. It must not lock the day after the first one.
    const uid = freshUid();
    for (let scan = 0; scan < 3; scan++) {
      const r = await quota.reserve(uid, "photo", false, 1);
      expect(r.remaining).toBe(2 - scan);
    }
    expect(await quota.peek(uid, "photo")).toBe(3);
    await expectQuotaExceeded(quota.reserve(uid, "photo", false, 1), "PHOTO_QUOTA_EXCEEDED", 3);
  });
});
