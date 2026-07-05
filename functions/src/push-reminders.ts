import { Timestamp } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { db } from "./init";

// ─── Daily Push Reminder ────────────────────────────────────────────
//
// Plain async task run by the hourly dispatcher (`hourly-tasks.ts`) —
// no longer its own scheduled function. Consolidating the hourly jobs
// keeps us within Cloud Scheduler's 3-job free tier.

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
        const token = data.fcmToken as string;
        const reminderHour = (data.reminderHour as number) ?? 20;
        const tzOffsetMin = (data.timezoneOffsetMin as number) ?? 0;

        // Compute the user's local hour.
        // getTimezoneOffset() returns positive for west of UTC (e.g., +300 for UTC-5,
        // meaning UTC = local + offset). So local = UTC - offset.
        const userLocalHour = (nowUtc.getUTCHours() - Math.round(tzOffsetMin / 60) + 24) % 24;

        // Single-hour window — schedule fires hourly, so allowing >1 hour
        // would double-fire the push. Earlier code used a 2-hour window
        // (reminderHour..reminderHour+1) and users got two pings per day.
        if (userLocalHour !== reminderHour) return;

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

        const token = data.fcmToken as string;
        const reminderHour = (data.reminderHour as number) ?? 20;
        const tzOffsetMin = (data.timezoneOffsetMin as number) ?? 0;
        const userLocalHour = (nowUtc.getUTCHours() - Math.round(tzOffsetMin / 60) + 24) % 24;
        if (userLocalHour !== reminderHour) return;

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
