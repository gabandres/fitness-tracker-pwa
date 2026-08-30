import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { requireAdmin } from "./admin-guard";
import { writeAuditLog } from "./audit-log";

const ADMINS_DOC = "config/admins";

/**
 * Seed emails used only to bootstrap the admin system on first boot.
 * Keep in sync with ADMIN_EMAILS in caller-access.ts (the server-side quota
 * bypass) and SEED_ADMIN_EMAILS in src/app/services/admin.service.ts (shows
 * the bootstrap CTA). The web `subscription.service.ts` copy is gone with
 * the logging app (ADR-0036). There is ONE admin — the owner — and this
 * list gains no second entry.
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
 * The console calls this once per browser session when it renders with the
 * claim, so the audit log has a row for every time the admin surface was
 * opened — not only for the mutations. Without it the log reads as broken
 * for as long as nobody suspends anyone (2026-08-30: zero rows after weeks
 * of use, because every audited action is a mutation and none had happened).
 */
export const adminNoteSession = onCall(async (request) => {
  const admin = requireAdmin(request);
  const { userAgent, release, viewport } = (request.data || {}) as { userAgent?: string; release?: string; viewport?: string };
  const id = await writeAuditLog({
    action: "admin_session",
    admin,
    details: {
      userAgent: typeof userAgent === "string" ? userAgent.slice(0, 200) : undefined,
      release: typeof release === "string" ? release.slice(0, 40) : undefined,
      viewport: typeof viewport === "string" ? viewport.slice(0, 20) : undefined,
    },
  });
  return { id };
});

// `setAdminClaims` — the grant/revoke callable — was DELETED on 2026-08-30
// (ADR-0036 decision 3, owner's instruction). There is exactly one admin, and
// the way to keep that true is to have no code path that can mint a second
// claim. `bootstrapAdmin` above survives only as disaster recovery: it is
// gated on SEED_ADMINS + a verified email and self-disables once
// `config/admins` exists. Changing the admin means changing SEED_ADMINS,
// deploying, and re-running the bootstrap — a code change, on purpose.
