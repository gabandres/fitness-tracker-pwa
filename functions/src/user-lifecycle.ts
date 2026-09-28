import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { onDocumentUpdated, onDocumentCreated } from "firebase-functions/v2/firestore";
import { getResend, baseSendOptions, resendApiKey } from "./resend-client";
import { emailLocale } from "./locales";
import { welcomeEmail } from "./email-templates";
import { unsubscribeUrl } from "./unsubscribe";
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
// Deliverability note: until `mail.ignia.fit` is verified in Resend we
// ship from `onboarding@resend.dev` (Resend's shared sandbox), which is
// unaligned with our domain and lands in junk for a large share of
// recipients. Set `MACROLOG_EMAIL_FROM` once the domain verifies —
// see `docs/email-deliverability.md` for the runbook.

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
    const locale = emailLocale(preferredLocale);

    const displayName =
      (after.displayName as string | undefined) ??
      (await getAuth().getUser(uid).then((u) => u.displayName).catch(() => null));

    // Lifecycle mail carries a working one-click opt-out. The only recurring
    // mail Ignia sends is the weekly digest, so that is what it turns off.
    const unsubUrl = unsubscribeUrl(uid, resendApiKey.value());
    const { subject, html, text } = welcomeEmail({
      locale,
      displayName,
      unsubscribeUrl: unsubUrl,
    });

    // Never log email addresses — Cloud Logging is 30d-retained and
    // visible to any project collaborator. Stick to uid; an operator
    // can join to the email via Firestore console if needed.
    try {
      const resend = getResend();
      const { error } = await resend.emails.send({
        ...baseSendOptions(unsubUrl),
        to: email,
        subject,
        html,
        text,
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
