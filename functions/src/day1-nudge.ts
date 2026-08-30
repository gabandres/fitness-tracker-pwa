import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { day1NudgeEmail, type Day1Variant } from "./email-templates";
import { emailLocale } from "./locales";
import { baseSendOptions, getResend, resendApiKey } from "./resend-client";
import { unsubscribeUrl } from "./unsubscribe";

/**
 * Day-1 re-engagement email. Plain async task run by the hourly dispatcher
 * (`hourly-tasks.ts`) — no scheduled job of its own.
 *
 * ## Why this exists (measured 2026-08-30)
 *
 * Six organic iOS installs between 21 and 28 Aug. Two logged 10 and 22 meals
 * on day 0 and never opened the app on day 1; two onboarded and never logged;
 * one came back. The product had no touch at all after the welcome email —
 * reminders are opt-in in Settings and nobody had turned them on. This is the
 * first day-1 touch: one email, roughly a day after onboarding, in one of two
 * shapes depending on what the person did on day 0.
 *
 * ## Consent and idempotency
 *
 * Lifecycle mail, same consent model as the welcome email: sent unless the
 * person has opted out (`weeklyDigestOptIn === false` — that flag is what the
 * one-click unsubscribe sets), and it carries the same unsubscribe link.
 * `day1NudgeSentAt` is latched in a transaction BEFORE the send, so a retried
 * hour cannot double-send. Seeded accounts (`syntheticAccount`) are skipped.
 *
 * ## The window
 *
 * `onboardingV2CompletedAt` between 20 h and 48 h ago. The dispatcher runs
 * hourly, so every account passes through the window once; the latch makes
 * the pass idempotent. Someone who logged in the last 20 h is skipped
 * outright — they are back, and a nudge would only be noise.
 */

const MIN_AGE_MS = 20 * 60 * 60 * 1000;
const MAX_AGE_MS = 48 * 60 * 60 * 1000;
const RECENT_LOG_MS = 20 * 60 * 60 * 1000;

export async function runDay1Nudge(): Promise<void> {
  const db = getFirestore();
  const nowMs = Date.now();
  const snap = await db
    .collection("users")
    .where("onboardingV2CompletedAt", ">=", Timestamp.fromMillis(nowMs - MAX_AGE_MS))
    .where("onboardingV2CompletedAt", "<=", Timestamp.fromMillis(nowMs - MIN_AGE_MS))
    .get();
  if (snap.empty) return;

  let sent = 0;
  let skipped = 0;
  for (const doc of snap.docs) {
    const uid = doc.id;
    const data = doc.data();
    if (data["day1NudgeSentAt"] || data["syntheticAccount"] === true || data["weeklyDigestOptIn"] === false) { skipped++; continue; }

    // Back already? Then this mail has nothing to say.
    const recent = await db.collection(`users/${uid}/dailyLogs`)
      .where("timestamp", ">=", Timestamp.fromMillis(nowMs - RECENT_LOG_MS)).limit(1).get();
    if (!recent.empty) { skipped++; continue; }

    const user = await getAuth().getUser(uid).catch(() => null);
    const email = user?.email ?? (data["email"] as string | undefined);
    if (!user || !email || !user.emailVerified || user.disabled) { skipped++; continue; }

    // Latch first. A second worker in the same hour sees the stamp and stops.
    const ref = db.doc(`users/${uid}`);
    const claimed = await db.runTransaction(async (tx) => {
      const fresh = await tx.get(ref);
      if (fresh.data()?.["day1NudgeSentAt"]) return false;
      tx.set(ref, { day1NudgeSentAt: Timestamp.fromMillis(nowMs) }, { merge: true });
      return true;
    });
    if (!claimed) { skipped++; continue; }

    const variant: Day1Variant = data["firstEntryAt"] ? "keepGoing" : "firstLog";
    const locale = emailLocale(data["preferredLocale"] as string | undefined);
    const unsub = unsubscribeUrl(uid, resendApiKey.value());
    const mail = day1NudgeEmail({ locale, variant, displayName: user.displayName ?? null, unsubscribeUrl: unsub });
    try {
      const { error } = await getResend().emails.send({ ...baseSendOptions(unsub), to: email, subject: mail.subject, html: mail.html, text: mail.text });
      if (error) {
        console.error(`day1Nudge: send failed for ${uid} (${variant}):`, error);
      } else {
        sent++;
      }
    } catch (err) {
      console.error(`day1Nudge: send threw for ${uid} (${variant}):`, err);
    }
  }
  console.log(`day1Nudge: ${snap.size} in window, ${sent} sent, ${skipped} skipped`);
}
