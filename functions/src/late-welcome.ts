import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { welcomeEmail } from "./email-templates";
import { emailLocale } from "./locales";
import { baseSendOptions, getResend, resendApiKey } from "./resend-client";
import { lifecycleRecipient } from "./lifecycle-recipient";
import { unsubscribeUrl } from "./unsubscribe";

/**
 * The welcome email for someone who verified their address AFTER finishing
 * onboarding (UX_AUDIT S24-1b). Plain async task run by the hourly dispatcher
 * (`hourly-tasks.ts`) — no scheduled job of its own.
 *
 * ## Why this exists
 *
 * `sendWelcomeEmail` (user-lifecycle.ts) fires once, on the `profileCompleted`
 * flip. Until 2026-11-19 nobody could reach that flip unverified. Since the
 * verification wall came down an account can finish onboarding first, and the
 * trigger rightly refuses an address nobody has proved they control — so that
 * person never got a welcome at all, however soon they verified. Verifying
 * changes the Auth record, not the profile, so no Firestore trigger sees it;
 * a sweep is the only thing that can.
 *
 * ## The window
 *
 * `onboardingV2CompletedAt` between 30 minutes and 14 days ago, no
 * `welcomeEmailSentAt`. The lower bound keeps the sweep out of the trigger's
 * way (the trigger sets the latch only after its send returns). Past 14 days a
 * "welcome" is no longer one, and the account drops out of the query for good.
 *
 * **The ACCOUNT must be that young too** ({@link lateWelcomeNewAccount}). The
 * completion stamp is rewritten when an old account goes through onboarding
 * again, and an account from before the welcome mail existed has no latch: the
 * first dry run (2026-11-20) found exactly one candidate, and it was that — a
 * long-standing account about to be "welcomed" months late.
 *
 * ## Consent and idempotency
 *
 * Same model as the trigger and the day-1 nudge: the Auth record's verified,
 * enabled address only; never to an account that opted out of mail
 * (`weeklyDigestOptIn === false`) or a seeded one. `welcomeEmailSentAt` is
 * latched in a transaction BEFORE the send, so a retried hour cannot
 * double-send; a send that then fails is logged and not retried — one missed
 * welcome is cheaper than two.
 */

const MIN_AGE_MS = 30 * 60 * 1000;
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** What the profile alone says, before the Auth record is read. Exported for test. */
export function lateWelcomeCandidate(data: Record<string, unknown>): boolean {
  return (
    data["profileCompleted"] === true &&
    !data["welcomeEmailSentAt"] &&
    data["syntheticAccount"] !== true &&
    data["weeklyDigestOptIn"] !== false
  );
}

/** Was the Auth account itself created inside the window? `creationTime` is
 *  the Auth record's string; an unreadable one is treated as old. Exported for
 *  test. */
export function lateWelcomeNewAccount(creationTime: string | undefined, nowMs: number): boolean {
  const created = creationTime ? Date.parse(creationTime) : NaN;
  return Number.isFinite(created) && nowMs - created <= MAX_AGE_MS;
}

/** The query window for a run at `nowMs`: [oldest, newest] completion times. Exported for test. */
export function lateWelcomeWindow(nowMs: number): { fromMs: number; toMs: number } {
  return { fromMs: nowMs - MAX_AGE_MS, toMs: nowMs - MIN_AGE_MS };
}

export async function runLateWelcome(): Promise<void> {
  const db = getFirestore();
  const nowMs = Date.now();
  const { fromMs, toMs } = lateWelcomeWindow(nowMs);
  const snap = await db
    .collection("users")
    .where("onboardingV2CompletedAt", ">=", Timestamp.fromMillis(fromMs))
    .where("onboardingV2CompletedAt", "<=", Timestamp.fromMillis(toMs))
    .get();
  if (snap.empty) return;

  let sent = 0;
  let failed = 0;
  for (const doc of snap.docs) {
    if (!lateWelcomeCandidate(doc.data())) continue;
    try {
      if ((await welcomeOne(db, doc.id, doc.data(), nowMs)) === "sent") sent++;
    } catch (err) {
      failed++;
      console.error(`lateWelcome: failed uid=${doc.id}`, err instanceof Error ? err.message : err);
    }
  }
  if (failed) console.warn(`lateWelcome: ${failed} user(s) failed`);
  if (sent) console.log(`lateWelcome: ${snap.size} in window, ${sent} sent`);
}

async function welcomeOne(
  db: FirebaseFirestore.Firestore,
  uid: string,
  data: FirebaseFirestore.DocumentData,
  nowMs: number,
): Promise<"sent" | "skipped"> {
  // Auth record only — never the client-writable profile `email` field.
  const user = await getAuth().getUser(uid).catch(() => null);
  const email = lifecycleRecipient(user);
  if (!user || !email) return "skipped"; // still unverified: next hour asks again
  if (!lateWelcomeNewAccount(user.metadata?.creationTime, nowMs)) return "skipped";

  // Latch first. The trigger, or a second worker, sees the stamp and stops.
  const ref = db.doc(`users/${uid}`);
  const claimed = await db.runTransaction(async (tx) => {
    const fresh = await tx.get(ref);
    if (fresh.data()?.["welcomeEmailSentAt"]) return false;
    tx.set(ref, { welcomeEmailSentAt: Timestamp.fromMillis(nowMs) }, { merge: true });
    return true;
  });
  if (!claimed) return "skipped";

  const locale = emailLocale(data["preferredLocale"] as string | undefined);
  const displayName = (data["displayName"] as string | undefined) ?? user.displayName ?? null;
  const unsub = unsubscribeUrl(uid, resendApiKey.value());
  const mail = welcomeEmail({ locale, displayName, unsubscribeUrl: unsub });
  try {
    // Never log the address: uid only (Cloud Logging is 30-day retained).
    const { error } = await getResend().emails.send({
      ...baseSendOptions(unsub),
      to: email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
    if (error) {
      console.error(`lateWelcome: send failed for ${uid}:`, error);
      return "skipped";
    }
    console.log(`lateWelcome: sent welcome email uid=${uid} locale=${locale}`);
    return "sent";
  } catch (err) {
    console.error(`lateWelcome: send threw for ${uid}:`, err);
    return "skipped";
  }
}
