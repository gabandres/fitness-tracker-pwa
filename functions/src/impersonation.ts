import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { writeAuditLog } from "./audit-log";

/**
 * Admin signs in as another user. Returns a Firebase custom token the
 * client uses with signInWithCustomToken. The target's existing session
 * (if any) is unaffected — they'd need to re-auth on their own device.
 */
export const startImpersonation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  if (request.auth.token["admin"] !== true) {
    throw new HttpsError("permission-denied", "Only admins can impersonate.");
  }

  const { targetEmail } = request.data as { targetEmail?: string };
  if (!targetEmail) {
    throw new HttpsError("invalid-argument", "targetEmail is required.");
  }

  const auth = getAuth();
  let target: UserRecord;
  try {
    target = await auth.getUserByEmail(targetEmail);
  } catch {
    throw new HttpsError("not-found", `No user found with email: ${targetEmail}`);
  }

  const customToken = await auth.createCustomToken(target.uid, {
    impersonatedBy: request.auth.uid,
  });

  await writeAuditLog({
    action: "impersonation_start",
    adminUid: request.auth.uid,
    adminEmail: (request.auth.token["email"] as string) || "",
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
export const stopImpersonation = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }

  const { originalUid } = request.data as { originalUid?: string };
  if (!originalUid) {
    throw new HttpsError("invalid-argument", "originalUid is required.");
  }

  const auth = getAuth();
  let originalUser: UserRecord;
  try {
    originalUser = await auth.getUser(originalUid);
  } catch {
    throw new HttpsError("not-found", "Original user not found.");
  }

  const claims = (originalUser.customClaims as Record<string, unknown>) || {};
  if (claims["admin"] !== true) {
    throw new HttpsError("permission-denied", "Can only return to an admin account.");
  }

  const customToken = await auth.createCustomToken(originalUid);

  await writeAuditLog({
    action: "impersonation_stop",
    adminUid: originalUid,
    adminEmail: originalUser.email || "",
  });

  return { customToken };
});
