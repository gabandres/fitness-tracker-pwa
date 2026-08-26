import { Timestamp } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { ErrorCode } from "./error-codes";
import { callerAccess, dailyQuota, db } from "./init";
import { redactProfileSecrets } from "./redact";
import { APPLE_SECRETS, revokeAppleToken } from "./apple-signin";

// ─── GDPR: data export (Art. 20) + account deletion (Art. 17) ──────

const DELETE_ACCOUNT_MIN_INTERVAL_MS = 5_000;
const EXPORT_DATA_MIN_INTERVAL_MS = 30_000;

/**
 * Every subcollection under `users/{uid}` — the single list that Art. 17
 * (erasure) and Art. 20 (portability) both derive from.
 *
 * **It is one list because keeping two in step by hand already failed.** The
 * erasure list used to be missing `workoutSessions`, `workoutTemplates` and
 * `exercises`; that was found and fixed. The export list was missing the same
 * three, and *stayed* missing them — the fix was applied to one obligation and
 * not the other, which is invisible from either function on its own. Firestore
 * does not cascade, and nothing enumerates subcollections for us, so a name
 * that is absent here is data we keep forever (Art. 17) or refuse to hand over
 * (Art. 20), silently in both directions.
 *
 * Adding a subcollection? Add it here and it is covered by both. That is the
 * whole point of the shape.
 */
export const USER_SUBCOLLECTIONS = [
  "dailyLogs",
  "presets",
  "customFoods",
  "reports",
  "dailyWeights",
  "dailyWater",
  "dailySleep",
  "measurements",
  "photos",
  "workoutSessions",
  "workoutTemplates",
  "exercises",
  // Completed fasts (ADR-0032, #97). Added in the same change that created the
  // collection, which is the point of `gdpr-collection-parity.spec.ts`: the
  // workout trio was erasable for months before anyone made it portable,
  // because the two lists were maintained by hand and drifted.
  "fasts",
  "private",
] as const;

/**
 * Subcollections deliberately withheld from the Art. 20 export, and why.
 *
 * Art. 20 covers *personal data*, not bearer tokens. `private` holds the Apple
 * refresh token — handing it back in a downloadable JSON widens its blast
 * radius for no portability benefit, the same reasoning `redactProfileSecrets`
 * applies to the profile doc. Erasure still covers it; only export skips it.
 */
export const EXPORT_EXCLUDED: ReadonlySet<string> = new Set(["private"]);

/**
 * Recursively delete all documents in a subcollection in batches of 500
 * (Firestore's max batch size). Firestore doesn't cascade on user or doc
 * deletion, so we have to walk each subcollection manually.
 */
async function deleteSubcollection(
  parentPath: string,
  subPath: string,
): Promise<void> {
  const collRef = db.collection(`${parentPath}/${subPath}`);
  const pageSize = 500;
  while (true) {
    const snap = await collRef.limit(pageSize).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    if (snap.size < pageSize) return;
  }
}

/**
 * Best-effort cancellation of any active Stripe subscriptions before the
 * Firebase Auth user is deleted. Writes `cancel_at_period_end: true` onto
 * the extension-managed subscription doc — the firestore-stripe-payments
 * extension picks up the write and mirrors it to Stripe, which is the
 * safe path that doesn't require us to hold the Stripe secret key here.
 *
 * Never throws: account deletion is a GDPR right-to-erasure path and
 * should not be blocked on a Stripe API blip. Any failure is logged so
 * operators can reconcile manually.
 */
async function cancelStripeSubscriptions(uid: string): Promise<void> {
  try {
    // Fetch all subscription docs and filter in memory. A `.where("status",
    // "in", [...])` would require a composite index on the subscriptions
    // subcollection that the Stripe extension doesn't create — without it
    // the query throws FAILED_PRECONDITION on first run. Subscription lists
    // per user are tiny (usually 0-2 docs), so the in-memory filter is free.
    const snap = await db
      .collection("customers")
      .doc(uid)
      .collection("subscriptions")
      .get();
    if (snap.empty) return;
    const ACTIVE = new Set(["trialing", "active", "past_due"]);
    const toCancel = snap.docs.filter((d) => ACTIVE.has(d.data()?.status as string));
    if (toCancel.length === 0) return;
    const batch = db.batch();
    toCancel.forEach((d) => {
      batch.set(d.ref, { cancel_at_period_end: true }, { merge: true });
    });
    await batch.commit();
    console.log(`cancelStripeSubscriptions: marked ${toCancel.length} sub(s) cancel_at_period_end for uid=${uid}`);
  } catch (err) {
    console.warn(
      `cancelStripeSubscriptions failed for uid=${uid} — Stripe customer may need manual cleanup in the dashboard.`,
      err,
    );
  }
}

// ─── GDPR Art. 20 data export ──────────────────────────────────────
// Returns a full JSON snapshot of everything we hold for the caller
// across `users/{uid}` + quota docs. CSV export in the dashboard covers
// daily logs only — this closes the "portability of all personal data"
// requirement. Response is inline JSON; the heaviest real-world account
// fits comfortably under the 10 MB callable response cap.
export const exportUserData = onCall({ maxInstances: 5 }, async (request) => {
  const { uid } = await callerAccess.resolveCaller(request, {
    collection: "exportRateLimit",
    minIntervalMs: EXPORT_DATA_MIN_INTERVAL_MS,
    errorCode: ErrorCode.RATE_LIMITED,
  });
  const userRef = db.doc(`users/${uid}`);

  const dumpCollection = async (name: string) => {
    const snap = await userRef.collection(name).get();
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  };

  // Driven off USER_SUBCOLLECTIONS so a new collection is exported the day it
  // is erasable, rather than the day someone notices. `workoutSessions`,
  // `workoutTemplates` and `exercises` join the payload here for the first
  // time — they were erasable but not portable.
  const exported = USER_SUBCOLLECTIONS.filter((name) => !EXPORT_EXCLUDED.has(name));
  const [profileSnap, collections, photoQuota, consultationQuota] = await Promise.all([
    userRef.get(),
    Promise.all(exported.map((name) => dumpCollection(name))),
    dailyQuota.dump(uid, "photo"),
    dailyQuota.dump(uid, "consultation"),
  ]);
  const byName = Object.fromEntries(exported.map((name, i) => [name, collections[i]]));

  // Redact credentials — GDPR Art. 20 scope is personal data, not bearer
  // tokens. `webhookApiKey` (Apple Shortcuts) and `fcmToken` (push channel)
  // are stripped by the shared redactor so a downloadable JSON can't widen
  // their blast radius. See redact.ts.
  const profile = redactProfileSecrets(
    profileSnap.exists ? (profileSnap.data() as Record<string, unknown>) : null,
  );

  // Key order and names are unchanged for the eight collections that were
  // already here, so an existing consumer of the JSON sees only additions.
  const payload = {
    exportedAt: Timestamp.now().toDate().toISOString(),
    uid,
    profile,
    ...byName,
    photoQuota,
    consultationQuota,
  };

  // Callable response cap is ~10 MB. Reject early with a typed error so
  // the client can tell the user why — the default overflow surfaces as
  // a generic internal error that's impossible to act on.
  const serialized = JSON.stringify(payload);
  if (serialized.length > 9_000_000) {
    throw new HttpsError(
      "resource-exhausted",
      "Your data is too large for an inline export. Contact support to receive a download link.",
      { code: ErrorCode.RATE_LIMITED, sizeBytes: serialized.length },
    );
  }
  return payload;
});

export const deleteAccount = onCall({ secrets: APPLE_SECRETS }, async (request) => {
  const { uid } = await callerAccess.resolveCaller(request, {
    collection: "deleteRateLimit",
    minIntervalMs: DELETE_ACCOUNT_MIN_INTERVAL_MS,
    errorCode: ErrorCode.RATE_LIMITED,
  });
  const userPath = `users/${uid}`;

  try {
    // 0. Flag any active Stripe subscriptions to cancel at period end so
    //    a deleted user doesn't keep getting billed. The extension's own
    //    auto-delete trigger handles the Stripe customer doc when the
    //    Auth user is deleted, but doesn't cancel live subscriptions —
    //    that's what this step is for.
    await cancelStripeSubscriptions(uid);

    // 0b. Revoke the Sign in with Apple token (App Review 5.1.1(v)). Read it
    //     before step 1 wipes `private`. Best-effort: a revoke failure (or the
    //     Apple secrets not being configured) must never block deletion —
    //     deletion is the hard requirement, revocation the soft one.
    try {
      const appleSnap = await db.doc(`${userPath}/private/appleAuth`).get();
      const refreshToken = appleSnap.get("refreshToken");
      if (typeof refreshToken === "string" && refreshToken) {
        await revokeAppleToken(refreshToken);
      }
    } catch (e) {
      console.warn(`Apple token revoke failed for uid=${uid} (non-fatal):`, e);
    }

    // 1. Delete every subcollection under users/{uid}. The list lives in
    //    USER_SUBCOLLECTIONS above — Firestore does NOT cascade, so a name
    //    missing from it orphans that data forever (GDPR Art. 17 gap), which
    //    is exactly what happened to the workout* + exercises trio once.
    await Promise.all(
      USER_SUBCOLLECTIONS.map((name) => deleteSubcollection(userPath, name)),
    );

    // 1b. Purge progress-photo BYTES from Storage (ADR-0010). The Firestore
    //     index docs above don't cascade to the Storage objects, so without
    //     this the photos linger after account deletion — a GDPR Art. 17 gap.
    await getStorage()
      .bucket()
      .deleteFiles({ prefix: `users/${uid}/photos/` });

    // 2. Delete quota docs (photo + consultation).
    await dailyQuota.deleteAll(uid);

    // 3. Delete the user profile doc itself.
    await db.doc(userPath).delete();

    // 4. Delete the Firebase Auth user. This signs them out of all
    //    sessions and prevents future logins. After this point the
    //    client's ID token is invalid.
    await getAuth().deleteUser(uid);

    console.log(`Account deleted for uid=${uid}`);
    return { success: true };
  } catch (err) {
    console.error(`deleteAccount failed for uid=${uid}:`, err);
    throw new HttpsError("internal", "Account deletion failed. Please contact support.", { code: ErrorCode.ACCOUNT_DELETE_FAILED });
  }
});
