"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopImpersonation = exports.startImpersonation = void 0;
const https_1 = require("firebase-functions/v2/https");
const auth_1 = require("firebase-admin/auth");
const audit_log_1 = require("./audit-log");
/**
 * Admin signs in as another user. Returns a Firebase custom token the
 * client uses with signInWithCustomToken. The target's existing session
 * (if any) is unaffected — they'd need to re-auth on their own device.
 */
exports.startImpersonation = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    if (request.auth.token["admin"] !== true) {
        throw new https_1.HttpsError("permission-denied", "Only admins can impersonate.");
    }
    const { targetEmail } = request.data;
    if (!targetEmail) {
        throw new https_1.HttpsError("invalid-argument", "targetEmail is required.");
    }
    const auth = (0, auth_1.getAuth)();
    let target;
    try {
        target = await auth.getUserByEmail(targetEmail);
    }
    catch {
        throw new https_1.HttpsError("not-found", `No user found with email: ${targetEmail}`);
    }
    const customToken = await auth.createCustomToken(target.uid, {
        impersonatedBy: request.auth.uid,
    });
    await (0, audit_log_1.writeAuditLog)({
        action: "impersonation_start",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetUid: target.uid,
        targetEmail,
    });
    return {
        customToken,
        targetUser: {
            uid: target.uid,
            email: target.email || "",
            displayName: target.displayName || "",
        },
    };
});
/**
 * Returns the admin to their own account. Requires the client to hand
 * over the original admin uid (which the client captured before the
 * impersonation swap). Verified against the custom-claims admin flag.
 */
exports.stopImpersonation = (0, https_1.onCall)(async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    const { originalUid } = request.data;
    if (!originalUid) {
        throw new https_1.HttpsError("invalid-argument", "originalUid is required.");
    }
    const auth = (0, auth_1.getAuth)();
    let originalUser;
    try {
        originalUser = await auth.getUser(originalUid);
    }
    catch {
        throw new https_1.HttpsError("not-found", "Original user not found.");
    }
    const claims = originalUser.customClaims || {};
    if (claims["admin"] !== true) {
        throw new https_1.HttpsError("permission-denied", "Can only return to an admin account.");
    }
    const customToken = await auth.createCustomToken(originalUid);
    await (0, audit_log_1.writeAuditLog)({
        action: "impersonation_stop",
        adminUid: originalUid,
        adminEmail: originalUser.email || "",
    });
    return { customToken };
});
//# sourceMappingURL=impersonation.js.map