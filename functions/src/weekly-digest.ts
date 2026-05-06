import { onSchedule } from "firebase-functions/v2/scheduler";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getResend, baseSendOptions, resendApiKey } from "./resend-client";
import { weeklyDigestEmail } from "./email-templates";

// ─── Weekly digest scheduler ────────────────────────────────────
//
// Runs hourly. Picks users where:
//   - `weeklyDigestOptIn === true`
//   - `lastWeeklyDigestSentAt` is missing OR > 6.5 days ago
//   - It is currently Sunday in the user's local timezone (10:00 local
//     window — within ±30 min of 10:00 to account for the hourly tick).
//
// Why hourly + per-tz rather than a single Sunday-10am-UTC fire: users
// span several timezones and "Sunday morning" is the high-engagement
// window for a recap. Firing in their local Sunday-10am dodges the
// "Saturday evening UTC" shifted send for west-coast users.
//
// Aggregates the last 7 days of dailyLogs + dailyWeights server-side
// and renders the digest via the shared template. Stamps
// `lastWeeklyDigestSentAt` to suppress duplicates the next tick.
//
// Resend deliverability: sandbox sender (onboarding@resend.dev) is
// rate-limited and routinely lands in spam. This function ships
// behind that constraint until macrolog.app is verified — the welcome
// email already runs on the same basis.

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const SEND_GUARD_MS = 6.5 * 24 * 60 * 60 * 1000;
const TARGET_LOCAL_HOUR = 10;

interface DailyLogDoc {
  timestamp: Timestamp;
  calories?: number;
  protein?: number;
  weight?: number;
}

interface DailyWeightDoc {
  date?: Timestamp;
  weight?: number;
}

function isSundayLocalHour(timezoneOffsetMin: number | undefined, nowMs: number): boolean {
  // Profile's `timezoneOffsetMin` is `Date.prototype.getTimezoneOffset()`
  // (minutes WEST of UTC, so a +5 offset means UTC-5). Convert to local
  // ms by subtracting the offset.
  const offsetMs = (timezoneOffsetMin ?? 0) * 60 * 1000;
  const localMs = nowMs - offsetMs;
  const local = new Date(localMs);
  const day = local.getUTCDay(); // 0 = Sunday
  if (day !== 0) return false;
  const hour = local.getUTCHours();
  return hour === TARGET_LOCAL_HOUR;
}

interface DigestStats {
  avgCalories: number | null;
  avgProtein: number | null;
  weightDeltaLbs: number | null;
  daysLogged: number;
  streak: number;
}

async function computeStatsForUser(uid: string, nowMs: number): Promise<DigestStats> {
  const db = getFirestore();
  const cutoff = Timestamp.fromMillis(nowMs - WEEK_MS);

  const [logsSnap, dwSnap] = await Promise.all([
    db.collection(`users/${uid}/dailyLogs`)
      .where("timestamp", ">=", cutoff)
      .get(),
    db.collection(`users/${uid}/dailyWeights`)
      .orderBy("date", "asc")
      .get(),
  ]);

  // Group logs by local-day key. We don't have the user's tz here for
  // ISO date, so use UTC date — the digest's avg/day is robust to ±1
  // shift; the alternative (per-user tz date math) adds complexity
  // for a marginal accuracy gain.
  const byDay = new Map<string, { kcal: number; protein: number; hadProtein: boolean }>();
  for (const d of logsSnap.docs) {
    const data = d.data() as DailyLogDoc;
    const key = data.timestamp.toDate().toISOString().slice(0, 10);
    const entry = byDay.get(key) ?? { kcal: 0, protein: 0, hadProtein: false };
    entry.kcal += data.calories ?? 0;
    if (typeof data.protein === "number") {
      entry.protein += data.protein;
      entry.hadProtein = true;
    }
    byDay.set(key, entry);
  }

  const days = [...byDay.values()];
  const daysLogged = days.length;
  const avgCalories = daysLogged > 0
    ? Math.round(days.reduce((a, b) => a + b.kcal, 0) / daysLogged)
    : null;
  const proteinDays = days.filter((d) => d.hadProtein);
  const avgProtein = proteinDays.length > 0
    ? Math.round(proteinDays.reduce((a, b) => a + b.protein, 0) / proteinDays.length)
    : null;

  // Weight delta — use the dailyWeights subcollection (preferred). Take
  // the first reading inside the 7-day window vs. the latest reading
  // (which may be from today or earlier this week).
  const weights = dwSnap.docs.map((d) => d.data() as DailyWeightDoc)
    .filter((d): d is DailyWeightDoc & { date: Timestamp; weight: number } =>
      d.date instanceof Timestamp && typeof d.weight === "number");
  const within = weights.filter((w) => w.date.toMillis() >= nowMs - WEEK_MS);
  let weightDeltaLbs: number | null = null;
  if (within.length >= 2) {
    weightDeltaLbs = Math.round((within[within.length - 1].weight - within[0].weight) * 10) / 10;
  }

  // Streak — same logic as the client computeStreak: consecutive days
  // back from today (or yesterday) that have a log entry. Server-side
  // doesn't apply Pro freeze tolerance — the digest reports the raw
  // walked streak so the email is always conservative.
  const datesSet = new Set(byDay.keys());
  let streak = 0;
  const cursor = new Date(nowMs);
  cursor.setUTCHours(0, 0, 0, 0);
  let key = cursor.toISOString().slice(0, 10);
  if (!datesSet.has(key)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    key = cursor.toISOString().slice(0, 10);
    if (!datesSet.has(key)) {
      // No streak; skip the walk.
      return { avgCalories, avgProtein, weightDeltaLbs, daysLogged, streak: 0 };
    }
  }
  while (datesSet.has(cursor.toISOString().slice(0, 10))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return { avgCalories, avgProtein, weightDeltaLbs, daysLogged, streak };
}

export const sendWeeklyDigest = onSchedule(
  {
    schedule: "every 1 hours",
    secrets: [resendApiKey],
    timeoutSeconds: 540,
    memory: "512MiB",
  },
  async () => {
    const db = getFirestore();
    const nowMs = Date.now();

    const optInSnap = await db.collection("users")
      .where("weeklyDigestOptIn", "==", true)
      .get();

    if (optInSnap.empty) {
      console.log("sendWeeklyDigest: no opt-in users");
      return;
    }

    let attempted = 0;
    let sent = 0;
    let skipped = 0;

    for (const doc of optInSnap.docs) {
      const uid = doc.id;
      const data = doc.data();
      const lastSent = data["lastWeeklyDigestSentAt"] as Timestamp | undefined;
      if (lastSent && nowMs - lastSent.toMillis() < SEND_GUARD_MS) {
        skipped++;
        continue;
      }
      const tzOffset = data["timezoneOffsetMin"] as number | undefined;
      if (!isSundayLocalHour(tzOffset, nowMs)) {
        skipped++;
        continue;
      }
      const email = data["email"] as string | undefined;
      if (!email) {
        skipped++;
        continue;
      }

      attempted++;
      const stats = await computeStatsForUser(uid, nowMs);
      // Skip users who haven't logged anything this week. Sending a
      // "0 / 7 days · 0 kcal" email to a lapsed user reads as nagging.
      if (stats.daysLogged === 0) {
        skipped++;
        continue;
      }

      // At-most-once: claim the send by transactionally stamping
      // `lastWeeklyDigestSentAt` BEFORE calling Resend. If a second
      // scheduler tick races us (overlapping invocations on a slow
      // run), it'll see the stamp and skip the user. Trade-off: a
      // Resend failure after the stamp means the user misses this
      // week's digest. That's the right trade — duplicate weekly
      // digests are spam-flag bait; a missed week is invisible.
      const userRef = db.doc(`users/${uid}`);
      const claimed = await db.runTransaction(async (tx) => {
        const snap = await tx.get(userRef);
        if (!snap.exists) return false;
        const last = snap.data()?.["lastWeeklyDigestSentAt"] as Timestamp | undefined;
        if (last && nowMs - last.toMillis() < SEND_GUARD_MS) return false;
        tx.set(userRef, { lastWeeklyDigestSentAt: Timestamp.fromMillis(nowMs) }, { merge: true });
        return true;
      });
      if (!claimed) {
        skipped++;
        continue;
      }

      const locale: "en" | "es-PR" = data["preferredLocale"] === "es-PR" ? "es-PR" : "en";
      const displayName = (data["displayName"] as string | undefined)
        || (await getAuth().getUser(uid).then((u) => u.displayName).catch(() => null));

      const { subject, html } = weeklyDigestEmail({ locale, displayName, ...stats });

      try {
        const resend = getResend();
        const { error } = await resend.emails.send({
          ...baseSendOptions(),
          to: email,
          subject,
          html,
        });
        if (error) {
          // Stamp already claimed above; we deliberately do NOT roll it
          // back. See comment on the transaction.
          console.error(`sendWeeklyDigest: Resend error uid=${uid}`, error);
          continue;
        }
        sent++;
      } catch (err) {
        console.error(`sendWeeklyDigest: unexpected failure uid=${uid}`, err);
      }
    }

    console.log(`sendWeeklyDigest: attempted=${attempted} sent=${sent} skipped=${skipped}`);
  },
);
