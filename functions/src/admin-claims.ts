import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { writeAuditLog } from "./audit-log";

const ADMINS_DOC = "config/admins";

/**
 * Seed emails used only to bootstrap the admin system on first boot.
 * Keep in sync with ADMIN_EMAILS in src/app/services/subscription.service.ts
 * and the legacy ADMIN_EMAILS constant in this file's index.ts — the
 * client list shapes UI, this list gates bootstrap, and the index.ts
 * copy is a defense-in-depth fallback that stays paid even if claims
 * haven't propagated yet. All three point at the owner's email.
 */
const SEED_ADMINS = ["gabrielandresbermudez@gmail.com"];

/**
 * One-time bootstrap: creates config/admins and sets the admin custom
 * claim on the seed account(s). Only callable by a seed email, only
 * runs if the admins doc does not exist yet.
 */
export const bootstrapAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  const callerEmail = request.auth.token["email"];
  // Require a VERIFIED seed email — Firebase lets anyone create an
  // email/password account with an arbitrary unverified address, and the
  // token still carries it. Without the email_verified gate, someone who
  // registered a seed email they don't own (before the real owner) could
  // self-promote on first bootstrap. Defense in depth (the function also
  // self-disables once config/admins exists).
  if (
    !callerEmail ||
    !SEED_ADMINS.includes(callerEmail) ||
    request.auth.token["email_verified"] !== true
  ) {
    throw new HttpsError("permission-denied", "Only verified seed admins can bootstrap.");
  }

  const db = getFirestore();
  const snap = await db.doc(ADMINS_DOC).get();
  if (snap.exists) {
    throw new HttpsError("already-exists", "Admin list already bootstrapped.");
  }

  const auth = getAuth();
  const seeded: string[] = [];
  for (const email of SEED_ADMINS) {
    try {
      const user = await auth.getUserByEmail(email);
      const existing = (user.customClaims as Record<string, unknown>) || {};
      await auth.setCustomUserClaims(user.uid, { ...existing, admin: true });
      await auth.revokeRefreshTokens(user.uid);
      seeded.push(email);
    } catch {
      // user doesn't exist yet — skip silently
    }
  }
  if (seeded.length === 0) {
    throw new HttpsError("internal", "No seed admin accounts found in Firebase Auth.");
  }

  await db.doc(ADMINS_DOC).set({ emails: seeded });
  return { seeded };
});

/**
 * Grant or revoke admin access for a user by email. Caller must already
 * have the admin custom claim. Keeps config/admins and the target user's
 * custom claims in sync.
 */
export const setAdminClaims = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  if (request.auth.token["admin"] !== true) {
    throw new HttpsError("permission-denied", "Only admins can manage admin access.");
  }

  const { email, grant } = request.data as { email?: string; grant?: boolean };
  if (!email || typeof grant !== "boolean") {
    throw new HttpsError("invalid-argument", "email (string) and grant (boolean) are required.");
  }
  const normalized = email.toLowerCase().trim();

  const auth = getAuth();
  let target: UserRecord;
  try {
    target = await auth.getUserByEmail(normalized);
  } catch {
    throw new HttpsError("not-found", `No Firebase Auth user found with email: ${normalized}`);
  }

  const db = getFirestore();
  const snap = await db.doc(ADMINS_DOC).get();
  const currentEmails: string[] = snap.exists ? (snap.data()?.["emails"] as string[] || []) : [];

  if (!grant) {
    const remaining = currentEmails.filter((e) => e !== normalized);
    if (remaining.length === 0) {
      throw new HttpsError("failed-precondition", "Cannot remove the last admin.");
    }
  }

  const existingClaims = (target.customClaims as Record<string, unknown>) || {};
  if (grant) {
    await auth.setCustomUserClaims(target.uid, { ...existingClaims, admin: true });
  } else {
    const rest = Object.fromEntries(
      Object.entries(existingClaims).filter(([k]) => k !== "admin"),
    );
    await auth.setCustomUserClaims(target.uid, rest);
  }
  await auth.revokeRefreshTokens(target.uid);

  const updated = grant
    ? (currentEmails.includes(normalized) ? currentEmails : [...currentEmails, normalized])
    : currentEmails.filter((e) => e !== normalized);

  await db.doc(ADMINS_DOC).set({ emails: updated }, { merge: true });

  await writeAuditLog({
    action: grant ? "admin_grant" : "admin_revoke",
    adminUid: request.auth.uid,
    adminEmail: (request.auth.token["email"] as string) || "",
    targetEmail: normalized,
    details: { totalAdmins: updated.length },
  });

  return { email: normalized, admin: grant, totalAdmins: updated.length };
});
