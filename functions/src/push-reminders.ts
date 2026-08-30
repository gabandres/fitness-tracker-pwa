import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./init";

// ─── Daily Push Reminder ────────────────────────────────────────────
//
// Plain async task run by the hourly dispatcher (`hourly-tasks.ts`) —
// no longer its own scheduled function. Consolidating the hourly jobs
// keeps us within Cloud Scheduler's 3-job free tier.
//
// ─── `fcmToken` IS A WEB PUSH REGISTRATION. READ THIS BEFORE WIRING MOBILE ───
//
// Both tasks below select users by `fcmToken != null` and by nothing else, and
// that is safe ONLY because the field is written by exactly one client: the
// Angular PWA (`FirebaseService.saveFcmToken`, a VAPID web-push registration).
//
// **The trap is that the obvious mobile implementation would silently enrol
// every app user in a daily push they never asked for.** `expo-notifications`'
// `getDevicePushTokenAsync()` returns, on Android, a genuine FCM registration
// token — exactly what `messaging.send({ token })` accepts. So storing it in
// `fcmToken` LOOKS like it just works, and the sender below would immediately
// start pushing to it. Two things then go wrong at once:
//
//  1. **A 20:00 reminder nobody set.** `reminderHour ?? 20` is the intended web
//     default (on web, granting push permission IS the opt-in, and
//     `saveFcmToken` deliberately writes no hour). Mobile's reminder model is a
//     different shape entirely — a PER-MEAL schedule in AsyncStorage, planned by
//     `planReminders` in packages/core — so an app user would get a fourth,
//     unrequested nudge on top of the three they configured, from a schedule
//     that is invisible in the app and unchangeable from it.
//  2. **A push that leaves the app.** `runDayThreeCoachPush` sends a `webpush`
//     block linking to `https://ignia.fit/`. Correct for a browser; wrong for a
//     native client, which wants the `ignia://` scheme. And it is latched
//     one-shot per user, so a mobile user who receives it and taps into nothing
//     has burned their only chance at it.
//
// **So mobile push MUST use its own field** (`expoPushToken`, per the transport
// chosen in #112) and its own sender. `webPushRecipient` below encodes that
// rule rather than leaving it to a comment, and `push-reminders.spec.ts` fails
// the build if either task starts selecting a mobile registration.
//
// This is a NO-OP today — nothing writes `expoPushToken` yet — and becomes
// protective the moment #112 ships. That ordering is the point (#113).

/** How the daily reminder falls back when the user never picked an hour. On
 *  web, granting permission is the opt-in and this is the intended default. */
export const DEFAULT_REMINDER_HOUR = 20;

/**
 * Expo's own push tokens are opaque strings of this shape. FCM registration
 * tokens never look like this, so a value matching it in `fcmToken` means a
 * mobile client wrote to the wrong field — belt-and-braces beside the
 * `expoPushToken` check, which is the real guard.
 */
export function looksLikeExpoPushToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[/.test(token);
}

/** The fields these tasks read off a user document. */
export interface PushProfile {
  fcmToken?: unknown;
  /** Present ⇒ this account has a MOBILE push registration (#112). */
  expoPushToken?: unknown;
  reminderHour?: unknown;
  timezoneOffsetMin?: unknown;
}

export interface WebPushRecipient {
  token: string;
  reminderHour: number;
  tzOffsetMin: number;
}

/**
 * The web-push registration for this user, or `null` if there is not one.
 *
 * Returns null when the account holds a MOBILE registration, even if it also
 * holds an `fcmToken`. That direction is deliberate: a user with the app has
 * local per-meal reminders already, and a second server-sent nudge they never
 * configured is the failure this function exists to prevent. Withholding a push
 * is recoverable; sending an unrequested one at 20:00 is what makes people
 * disable notifications for good.
 */
export function webPushRecipient(data: PushProfile): WebPushRecipient | null {
  if (data.expoPushToken != null && data.expoPushToken !== '') return null;

  const token = data.fcmToken;
  if (typeof token !== 'string' || token === '') return null;
  if (looksLikeExpoPushToken(token)) return null;

  const hour = typeof data.reminderHour === 'number' ? data.reminderHour : DEFAULT_REMINDER_HOUR;
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;

  const tz = typeof data.timezoneOffsetMin === 'number' ? data.timezoneOffsetMin : 0;
  return { token, reminderHour: hour, tzOffsetMin: tz };
}

/**
 * The user's local hour right now.
 *
 * `getTimezoneOffset()` is positive west of UTC (+300 for UTC-5), i.e.
 * UTC = local + offset, so local = UTC - offset.
 */
export function localHour(nowUtc: Date, tzOffsetMin: number): number {
  return (nowUtc.getUTCHours() - Math.round(tzOffsetMin / 60) + 24) % 24;
}

/**
 * Is this the one hour of the user's day the reminder may fire?
 *
 * A SINGLE hour, not a window: the dispatcher runs hourly, and an earlier
 * two-hour window (`reminderHour..reminderHour+1`) sent everybody two pushes a
 * day. Do not widen it.
 */
export function isReminderHour(recipient: WebPushRecipient, nowUtc: Date): boolean {
  return localHour(nowUtc, recipient.tzOffsetMin) === recipient.reminderHour;
}

export async function runDailyReminders(): Promise<void> {
    const messaging = getMessaging();

    // Find all users with an FCM token.
    const usersSnap = await db
      .collection("users")
      .where("fcmToken", "!=", null)
      .get();

    if (usersSnap.empty) return;

    const nowUtc = new Date();

    // Process all users in parallel (not sequentially) to avoid
    // timeout at scale. allSettled so one failure doesn't block others.
    await Promise.allSettled(
      usersSnap.docs.map(async (userDoc) => {
        const data = userDoc.data();

        // Web registrations only — see the header. A mobile account is skipped
        // here even when it carries an `fcmToken`.
        const recipient = webPushRecipient(data);
        if (!recipient) return;
        if (!isReminderHour(recipient, nowUtc)) return;

        const { token, tzOffsetMin } = recipient;

        // Check if they logged today (in their local timezone).
        const userNow = new Date(nowUtc.getTime() - tzOffsetMin * 60 * 1000);
        const startOfDay = new Date(userNow);
        startOfDay.setUTCHours(0, 0, 0, 0);
        const startOfDayUtc = new Date(startOfDay.getTime() + tzOffsetMin * 60 * 1000);

        const logsSnap = await db
          .collection("users")
          .doc(userDoc.id)
          .collection("dailyLogs")
          .where("timestamp", ">=", Timestamp.fromDate(startOfDayUtc))
          .limit(1)
          .get();

        if (!logsSnap.empty) return; // Already logged today.

        try {
          await messaging.send({
            token,
            notification: {
              title: "Ignia",
              body: "You haven't logged today yet.",
            },
            webpush: {
              fcmOptions: { link: "https://ignia.fit" },
            },
          });
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            await userDoc.ref.update({ fcmToken: null });
            console.log(`Cleaned stale FCM token for user ${userDoc.id}`);
          } else {
            console.error(`FCM send failed for user ${userDoc.id}:`, err);
          }
        }
      }),
    );
}

// ─── Day-3 ask-coach push ──────────────────────────────────────────
//
// Once a user has ≥3 days of data the consultation panel becomes
// actually useful (before that, Gemini has nothing to ground its
// answers in). This push nudges them into their first AI conversation
// exactly when the data is ready, deep-linking to the body tab where
// the consultation lives. One-shot per user — latched via the
// `dayThreeCoachPushSent` flag on the user doc so we never spam.
//
// Ride the same hourly cadence as sendDailyReminders so we reuse the
// timezone / reminder-hour logic and stay within the user's explicit
// reminder window.

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runDayThreeCoachPush(): Promise<void> {
    const messaging = getMessaging();

    const usersSnap = await db
      .collection("users")
      .where("fcmToken", "!=", null)
      .get();

    if (usersSnap.empty) return;

    const nowUtc = new Date();

    await Promise.allSettled(
      usersSnap.docs.map(async (userDoc) => {
        const data = userDoc.data();
        if (data.dayThreeCoachPushSent) return; // already nudged.

        // Web registrations only — see the header. This one matters more than
        // the daily reminder: it is latched one-shot per user, so firing it at
        // a mobile client would spend the single chance on a `webpush` payload
        // linking to a web page the app cannot open.
        const recipient = webPushRecipient(data);
        if (!recipient) return;
        if (!isReminderHour(recipient, nowUtc)) return;

        const { token } = recipient;

        // Oldest log — single read, no aggregate needed. If the oldest
        // log is ≥3 days old the user has been around long enough for
        // the consultation panel to say something useful.
        const oldestSnap = await db
          .collection("users")
          .doc(userDoc.id)
          .collection("dailyLogs")
          .orderBy("timestamp", "asc")
          .limit(1)
          .get();
        if (oldestSnap.empty) return;

        const oldestTs = oldestSnap.docs[0].data().timestamp as Timestamp | undefined;
        if (!oldestTs) return;
        const ageMs = nowUtc.getTime() - oldestTs.toMillis();
        if (ageMs < 3 * DAY_MS) return;

        try {
          await messaging.send({
            token,
            notification: {
              title: "Ignia",
              // Lands on today-v2 root where the "Refine targets" coach
              // card surfaces for users still on the 2-Q heuristic — the
              // most actionable next step at day 3. Previous body
              // ("ask your coach what to adjust") deep-linked into the
              // consultation panel via /?tab=body, but the v2 cutover
              // dropped tab routing and the consultation isn't the
              // first card anyone sees on body-v2 anyway.
              body: "Three days of logs in. Tap to refine your daily targets.",
            },
            webpush: {
              fcmOptions: { link: "https://ignia.fit/" },
            },
          });
          await userDoc.ref.update({ dayThreeCoachPushSent: true });
        } catch (err: unknown) {
          const code = (err as { code?: string })?.code;
          if (
            code === "messaging/registration-token-not-registered" ||
            code === "messaging/invalid-registration-token"
          ) {
            await userDoc.ref.update({ fcmToken: null });
          } else {
            console.error(`Day-3 coach push failed for user ${userDoc.id}:`, err);
          }
        }
      }),
    );
}
