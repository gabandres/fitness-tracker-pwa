import { describe, expect, it } from "vitest";
import { testDb, freshUid } from "./helpers";
import {
  claimFeedbackNotify,
  decideFeedbackNotify,
  FEEDBACK_NOTIFY_GLOBAL_PER_DAY,
  FEEDBACK_NOTIFY_PER_USER_PER_DAY,
} from "../src/feedback-notify";

// Every feedback doc used to become one email through the Resend plan that
// password-reset and verification mail share (100/day). These pin the budget
// that stops a feedback loop from locking people out of account recovery.

const DAY = "2026-10-15";

describe("decideFeedbackNotify (pure)", () => {
  it("allows the first ping of the day and counts it on both axes", () => {
    expect(decideFeedbackNotify(undefined, undefined, DAY)).toEqual({
      allowed: true, globalCount: 1, userCount: 1,
    });
  });

  it("stops one reporter at the per-user cap", () => {
    const d = decideFeedbackNotify({ day: DAY, count: 0 }, { day: DAY, count: FEEDBACK_NOTIFY_PER_USER_PER_DAY }, DAY);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("user");
  });

  it("stops everyone at the global cap", () => {
    const d = decideFeedbackNotify({ day: DAY, count: FEEDBACK_NOTIFY_GLOBAL_PER_DAY }, undefined, DAY);
    expect(d.allowed).toBe(false);
    expect(d.reason).toBe("global");
  });

  it("rolls over at the day boundary — yesterday's count is not today's", () => {
    const d = decideFeedbackNotify(
      { day: "2026-10-14", count: 999 },
      { day: "2026-10-14", count: 999 },
      DAY,
    );
    expect(d).toEqual({ allowed: true, globalCount: 1, userCount: 1 });
  });

  it("treats a malformed counter as empty, never as a crash", () => {
    expect(decideFeedbackNotify({ day: DAY, count: "x" }, { count: 5 }, DAY).allowed).toBe(true);
  });

  it("keeps the global cap well under the 100/day Resend plan", () => {
    expect(FEEDBACK_NOTIFY_GLOBAL_PER_DAY).toBeLessThanOrEqual(25);
  });
});

describe("claimFeedbackNotify (emulator)", () => {
  it("lets a reporter ping up to the cap, then refuses — transactionally", async () => {
    const db = testDb();
    const uid = freshUid("fb");
    const now = new Date("2030-01-01T12:00:00Z"); // a day no other test touches
    await db.doc("opsBudget/feedbackNotify").delete();
    const results: boolean[] = [];
    for (let i = 0; i < FEEDBACK_NOTIFY_PER_USER_PER_DAY + 2; i++) {
      results.push((await claimFeedbackNotify(db, uid, now)).allowed);
    }
    expect(results.filter(Boolean)).toHaveLength(FEEDBACK_NOTIFY_PER_USER_PER_DAY);
    expect(results.slice(-2)).toEqual([false, false]);
    const userDoc = await db.doc(`users/${uid}/private/feedbackNotify`).get();
    expect(userDoc.data()?.["count"]).toBe(FEEDBACK_NOTIFY_PER_USER_PER_DAY);
  });

  it("refuses everyone once the global budget is spent", async () => {
    const db = testDb();
    const now = new Date("2030-01-02T12:00:00Z");
    await db.doc("opsBudget/feedbackNotify").set({ day: "2030-01-02", count: FEEDBACK_NOTIFY_GLOBAL_PER_DAY });
    const r = await claimFeedbackNotify(db, freshUid("fb"), now);
    expect(r).toEqual({ allowed: false, reason: "global" });
    await db.doc("opsBudget/feedbackNotify").delete();
  });
});
