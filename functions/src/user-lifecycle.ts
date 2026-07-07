import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentUpdated, onDocumentCreated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getResend, baseSendOptions, resendApiKey } from "./resend-client";
import { welcomeEmail } from "./email-templates";
import { db } from "./init";

// ─── Welcome email on profile completion ────────────────────────────
//
// Fires the first time `profileCompleted` flips false → true on a user
// doc. That's the moment we know a real human finished onboarding and
// has consented to be contacted — legally safer than sending on sign-up
// (which is just auth, no affirmative consent). Latched via
// `welcomeEmailSentAt` on the profile so reconfigurations never
// re-trigger. Resend delivery failures are logged, not thrown: a
// welcome email is not mission-critical and a transient Resend 5xx
// must never block onboarding.
//
// Deliverability note: until a custom domain is verified in Resend we
// ship from `onboarding@resend.dev` (Resend's sandbox). Real Day-7
// retention lift needs macrolog.app (or similar) verified — at that
// point set the `MACROLOG_EMAIL_FROM` env to the verified from-address.

export const sendWelcomeEmail = onDocumentUpdated(
  {
    document: "users/{uid}",
    secrets: [resendApiKey],
  },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const flippedToCompleted =
      before.profileCompleted !== true && after.profileCompleted === true;
    if (!flippedToCompleted) return;
    if (after.welcomeEmailSentAt) return; // already sent

    const uid = event.params.uid;
    // Email is no longer stored on the profile doc (PII minimization) —
    // read it from Firebase Auth. Legacy docs may still carry `after.email`;
    // prefer it to save an Auth read, else fetch by uid.
    const email =
      (after.email as string | undefined) ??
      (await getAuth().getUser(uid).then((u) => u.email).catch(() => undefined));
    if (!email) {
      console.warn(`sendWelcomeEmail: user ${uid} has no email — skipping.`);
      return;
    }

    // Pull a locale hint from the Firebase Auth user record (if present).
    // Clients write Transloco's active language to `preferredLocale` on the
    // profile when it changes; fall back to English otherwise.
    const preferredLocale = after.preferredLocale as string | undefined;
    const locale: "en" | "es-PR" = preferredLocale === "es-PR" ? "es-PR" : "en";

    const displayName =
      (after.displayName as string | undefined) ??
      (await getAuth().getUser(uid).then((u) => u.displayName).catch(() => null));

    const { subject, html } = welcomeEmail({ locale, displayName });

    // Never log email addresses — Cloud Logging is 30d-retained and
    // visible to any project collaborator. Stick to uid; an operator
    // can join to the email via Firestore console if needed.
    try {
      const resend = getResend();
      const { error } = await resend.emails.send({
        ...baseSendOptions(),
        to: email,
        subject,
        html,
      });
      if (error) {
        console.error(`sendWelcomeEmail: Resend error for uid=${uid}`, error);
        return;
      }
      await db.doc(`users/${uid}`).set(
        { welcomeEmailSentAt: Timestamp.now() },
        { merge: true },
      );
      console.log(`sendWelcomeEmail: sent welcome email uid=${uid} locale=${locale}`);
    } catch (err) {
      console.error(`sendWelcomeEmail: unexpected failure for uid=${uid}`, err);
    }
  },
);

// ─── First-entry latch ──────────────────────────────────────────────
// On the first daily-log create for a user, stamp `firstEntryAt` on
// their profile doc. Drives the activation metric in getPlatformStats
// without scanning the entire dailyLogs collection-group on every
// dashboard refresh. Idempotent: only writes when the field is missing,
// so subsequent log creates are a no-op.
export const onDailyLogCreated = onDocumentCreated(
  "users/{uid}/dailyLogs/{logId}",
  async (event) => {
    const uid = event.params.uid;
    const profileRef = db.doc(`users/${uid}`);
    const snap = await profileRef.get();
    if (!snap.exists) return;
    if (snap.data()?.["firstEntryAt"] != null) return;
    await profileRef.update({ firstEntryAt: Timestamp.now() });
  },
);

// ─── Referral reward grant ─────────────────────────────────────────
//
// Fires when a `users/{uid}/subscriptions/{subId}` doc is created or
// updated by the firestore-stripe-payments extension. When a referred
// user's subscription becomes active/trialing for the first time, both
// sides receive 30 days of comped Pro access via the `compedUntil`
// field — a server-stamped Timestamp the checkAccessStatus callable
// reads to decide unlimited access.
//
// Idempotent: latched by `referralRewardGrantedAt` on the referee's
// profile. Subscription churn (cancel + resub) won't double-grant.
//
// Self-referrals are blocked at the profile-create site (firebase.service.ts);
// invalid referrer uids (deleted account, typo) are caught here when
// the referrer's profile fetch returns empty.
const REFERRAL_REWARD_DAYS = 30;
const REFERRAL_REWARD_MS = REFERRAL_REWARD_DAYS * 24 * 60 * 60 * 1000;

export const onSubscriptionWritten = onDocumentWritten(
  "users/{uid}/subscriptions/{subId}",
  async (event) => {
    const after = event.data?.after?.data();
    if (!after) return;
    const status = after["status"] as string | undefined;
    if (status !== "active" && status !== "trialing") return;

    const refereeUid = event.params.uid;
    const refereeRef = db.doc(`users/${refereeUid}`);
    const refereeSnap = await refereeRef.get();
    if (!refereeSnap.exists) return;
    const referee = refereeSnap.data()!;
    if (referee["referralRewardGrantedAt"] != null) return; // already granted
    const referrerUid = referee["referredBy"] as string | undefined;
    if (!referrerUid || typeof referrerUid !== "string") return;
    if (referrerUid === refereeUid) return; // self-referral guard

    const referrerRef = db.doc(`users/${referrerUid}`);
    const referrerSnap = await referrerRef.get();
    if (!referrerSnap.exists) {
      // Referrer's account was deleted or the uid was malformed —
      // latch the referee so we don't keep retrying every subscription
      // write. The referee still gets their bonus (they signed up via
      // a real link at the time, even if the referrer is now gone).
      await refereeRef.update({
        referralRewardGrantedAt: Timestamp.now(),
        compedUntil: Timestamp.fromMillis(Date.now() + REFERRAL_REWARD_MS),
      });
      console.warn(`referral: referrer ${referrerUid} not found; granted referee ${refereeUid} only`);
      return;
    }

    // Both sides get +30d. If either already has compedUntil > now
    // (e.g. from a prior referral), extend from that point instead of
    // overwriting — the reward stacks on existing comped time.
    const now = Date.now();
    const grant = (current: Timestamp | undefined) => {
      const base = current && current.toMillis() > now ? current.toMillis() : now;
      return Timestamp.fromMillis(base + REFERRAL_REWARD_MS);
    };

    await Promise.all([
      refereeRef.update({
        referralRewardGrantedAt: Timestamp.now(),
        compedUntil: grant(referee["compedUntil"] as Timestamp | undefined),
      }),
      referrerRef.update({
        compedUntil: grant(referrerSnap.data()?.["compedUntil"] as Timestamp | undefined),
      }),
    ]);

    console.log(`referral: granted +${REFERRAL_REWARD_DAYS}d to referrer=${referrerUid} + referee=${refereeUid}`);
  },
);
