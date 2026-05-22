"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAdminClaims = exports.bootstrapAdmin = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const audit_log_1 = require("./audit-log");
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
exports.bootstrapAdmin = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const callerEmail = request.auth.token["email"];
    if (!callerEmail || !SEED_ADMINS.includes(callerEmail)) {
        throw new https_1.HttpsError("permission-denied", "Only seed admins can bootstrap.");
    }
    const db = (0, firestore_1.getFirestore)();
    const snap = await db.doc(ADMINS_DOC).get();
    if (snap.exists) {
        throw new https_1.HttpsError("already-exists", "Admin list already bootstrapped.");
    }
    const auth = (0, auth_1.getAuth)();
    const seeded = [];
    for (const email of SEED_ADMINS) {
        try {
            const user = await auth.getUserByEmail(email);
            const existing = user.customClaims || {};
            await auth.setCustomUserClaims(user.uid, { ...existing, admin: true });
            await auth.revokeRefreshTokens(user.uid);
            seeded.push(email);
        }
        catch {
            // user doesn't exist yet — skip silently
        }
    }
    if (seeded.length === 0) {
        throw new https_1.HttpsError("internal", "No seed admin accounts found in Firebase Auth.");
    }
    await db.doc(ADMINS_DOC).set({ emails: seeded });
    return { seeded };
});
/**
 * Grant or revoke admin access for a user by email. Caller must already
 * have the admin custom claim. Keeps config/admins and the target user's
 * custom claims in sync.
 */
exports.setAdminClaims = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    if (request.auth.token["admin"] !== true) {
        throw new https_1.HttpsError("permission-denied", "Only admins can manage admin access.");
    }
    const { email, grant } = request.data;
    if (!email || typeof grant !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "email (string) and grant (boolean) are required.");
    }
    const normalized = email.toLowerCase().trim();
    const auth = (0, auth_1.getAuth)();
    let target;
    try {
        target = await auth.getUserByEmail(normalized);
    }
    catch {
        throw new https_1.HttpsError("not-found", `No Firebase Auth user found with email: ${normalized}`);
    }
    const db = (0, firestore_1.getFirestore)();
    const snap = await db.doc(ADMINS_DOC).get();
    const currentEmails = snap.exists ? (snap.data()?.["emails"] || []) : [];
    if (!grant) {
        const remaining = currentEmails.filter((e) => e !== normalized);
        if (remaining.length === 0) {
            throw new https_1.HttpsError("failed-precondition", "Cannot remove the last admin.");
        }
    }
    const existingClaims = target.customClaims || {};
    if (grant) {
        await auth.setCustomUserClaims(target.uid, { ...existingClaims, admin: true });
    }
    else {
        const rest = Object.fromEntries(Object.entries(existingClaims).filter(([k]) => k !== "admin"));
        await auth.setCustomUserClaims(target.uid, rest);
    }
    await auth.revokeRefreshTokens(target.uid);
    const updated = grant
        ? (currentEmails.includes(normalized) ? currentEmails : [...currentEmails, normalized])
        : currentEmails.filter((e) => e !== normalized);
    await db.doc(ADMINS_DOC).set({ emails: updated }, { merge: true });
    await (0, audit_log_1.writeAuditLog)({
        action: grant ? "admin_grant" : "admin_revoke",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetEmail: normalized,
        details: { totalAdmins: updated.length },
    });
    return { email: normalized, admin: grant, totalAdmins: updated.length };
});
//# sourceMappingURL=admin-claims.js.map