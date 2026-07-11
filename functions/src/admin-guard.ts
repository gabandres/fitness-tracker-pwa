import { HttpsError } from "firebase-functions/v2/https";

/**
 * The audit-ready identity of an admin caller — exactly the two fields
 * every admin audit-log entry stamps. Returned by `requireAdmin` and
 * consumed by `writeAuditLog`, so the pair is never re-derived at a site.
 */
export interface AdminCaller {
  uid: string;
  email: string;
}

/** Structural subset of CallableRequest — lets tests fabricate a caller
    without constructing a full firebase-functions request. */
export interface AdminRequestLike {
  auth?: {
    uid: string;
    token: Record<string, unknown>;
  } | null;
}

/**
 * Gate an admin-only callable. Throws UNAUTHENTICATED when signed out and
 * PERMISSION_DENIED when the caller lacks the `admin` custom claim, then
 * returns the audit-ready `{ uid, email }`.
 *
 * The single home for the admin preamble the callables used to inline —
 * distinct from `CallerAccess.isAdmin` (an email-list quota-bypass check);
 * this gates on the custom claim set by `setAdminClaims` and needs no
 * Firestore read, so it stays a pure function rather than a method on the
 * db-backed CallerAccess.
 *
 * `message` overrides the permission-denied text for callables that want a
 * specific one (e.g. "Only admins can impersonate.").
 */
export function requireAdmin(request: AdminRequestLike, message = "Admin only."): AdminCaller {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  if (request.auth.token["admin"] !== true) {
    throw new HttpsError("permission-denied", message);
  }
  return {
    uid: request.auth.uid,
    email: (request.auth.token["email"] as string) || "",
  };
}
