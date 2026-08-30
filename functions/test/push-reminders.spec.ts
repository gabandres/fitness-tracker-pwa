import { describe, expect, it } from "vitest";
import {
  DEFAULT_REMINDER_HOUR,
  isReminderHour,
  localHour,
  looksLikeExpoPushToken,
  webPushRecipient,
} from "../src/push-reminders";

/**
 * #113 — the hourly push tasks must never fire at a mobile client.
 *
 * These two tasks have run hourly in production for months and were safe only
 * because exactly one client writes `fcmToken`: the Angular PWA. Nothing in the
 * code said so, and the obvious mobile implementation would have broken it
 * silently — `getDevicePushTokenAsync()` returns a real FCM registration token
 * on Android, so storing it in `fcmToken` looks like it just works and the
 * existing sender would immediately start pushing to it.
 *
 * The user-visible result would be a 20:00 reminder nobody set, on top of the
 * per-meal reminders the app already schedules locally, from a schedule that is
 * invisible in the app and unchangeable from it.
 *
 * So the rule is enforced here rather than described in a comment.
 */

const webProfile = () => ({ fcmToken: "fcm-abc", timezoneOffsetMin: 300 });

describe("webPushRecipient", () => {
  it("accepts a plain web registration", () => {
    expect(webPushRecipient(webProfile())).toEqual({
      token: "fcm-abc",
      reminderHour: DEFAULT_REMINDER_HOUR,
      tzOffsetMin: 300,
    });
  });

  it("defaults the hour, because on web the permission grant IS the opt-in", () => {
    // `FirebaseService.saveFcmToken` deliberately writes no `reminderHour`.
    expect(webPushRecipient(webProfile())?.reminderHour).toBe(20);
  });

  it("honours an hour the user chose", () => {
    expect(webPushRecipient({ ...webProfile(), reminderHour: 7 })?.reminderHour).toBe(7);
  });

  it("declines a profile with no token", () => {
    expect(webPushRecipient({})).toBeNull();
    expect(webPushRecipient({ fcmToken: "" })).toBeNull();
    expect(webPushRecipient({ fcmToken: null })).toBeNull();
  });

  it("declines a non-string token rather than sending to it", () => {
    expect(webPushRecipient({ fcmToken: 42 })).toBeNull();
  });

  it("declines an out-of-range hour instead of pushing at a wrong one", () => {
    expect(webPushRecipient({ ...webProfile(), reminderHour: 24 })).toBeNull();
    expect(webPushRecipient({ ...webProfile(), reminderHour: -1 })).toBeNull();
    expect(webPushRecipient({ ...webProfile(), reminderHour: 7.5 })).toBeNull();
  });

  it("assumes UTC when no timezone was ever written", () => {
    expect(webPushRecipient({ fcmToken: "t" })?.tzOffsetMin).toBe(0);
  });

  // ── The regression this file exists for ──────────────────────────────

  it("DECLINES an account holding a mobile registration", () => {
    expect(webPushRecipient({ expoPushToken: "ExponentPushToken[xyz]" })).toBeNull();
  });

  it("DECLINES a mobile account even when it also carries an fcmToken", () => {
    // This is the shape that would exist if a user has both the PWA and the
    // app. They already get local per-meal reminders; a second server-sent
    // nudge they never configured is what this prevents. Withholding a push is
    // recoverable — an unrequested 20:00 one is how people turn notifications
    // off for good.
    expect(
      webPushRecipient({ ...webProfile(), expoPushToken: "ExponentPushToken[xyz]" }),
    ).toBeNull();
  });

  it("DECLINES an Expo token misfiled into fcmToken", () => {
    // Belt and braces. A native Android FCM token written to `fcmToken` is
    // genuinely indistinguishable from a web one, which is exactly why the
    // `expoPushToken` field above is the real guard and this is only the
    // second line of defence.
    expect(webPushRecipient({ fcmToken: "ExponentPushToken[xyz]" })).toBeNull();
  });
});

describe("looksLikeExpoPushToken", () => {
  it.each(["ExponentPushToken[abc]", "ExpoPushToken[abc]"])("matches %s", (t) => {
    expect(looksLikeExpoPushToken(t)).toBe(true);
  });

  it("does not match an FCM registration token", () => {
    expect(looksLikeExpoPushToken("fPz1k:APA91bH-Xyz_123")).toBe(false);
  });
});

describe("localHour", () => {
  it("converts west of UTC", () => {
    // Puerto Rico is UTC-4 ⇒ getTimezoneOffset() === 240.
    expect(localHour(new Date("2026-08-29T00:00:00Z"), 240)).toBe(20);
  });

  it("converts east of UTC", () => {
    // Berlin in summer is UTC+2 ⇒ getTimezoneOffset() === -120.
    expect(localHour(new Date("2026-08-29T00:00:00Z"), -120)).toBe(2);
  });

  it("wraps rather than going negative", () => {
    expect(localHour(new Date("2026-08-29T02:00:00Z"), 300)).toBe(21);
  });
});

describe("isReminderHour", () => {
  const at = (hour: number) => ({ token: "t", reminderHour: hour, tzOffsetMin: 240 });

  it("fires on the user's chosen local hour", () => {
    expect(isReminderHour(at(20), new Date("2026-08-29T00:00:00Z"))).toBe(true);
  });

  it("is a SINGLE hour, not a window", () => {
    // An earlier two-hour window sent everyone two pushes a day. The dispatcher
    // runs hourly, so widening this re-creates that bug.
    expect(isReminderHour(at(20), new Date("2026-08-29T01:00:00Z"))).toBe(false);
    expect(isReminderHour(at(20), new Date("2026-08-28T23:00:00Z"))).toBe(false);
  });
});
