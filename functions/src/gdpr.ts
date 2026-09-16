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
  // The retrospective milestone record (#108/#109/#110). Added in the same
  // change that created the collection — and it was `gdpr-collection-parity`
  // that made that happen rather than diligence: the rules block was written
  // first and this list was forgotten, exactly the drift the spec exists for.
  "milestones",
  // ── Added 2026-08-26 (#99). These three existed in `firestore.rules` and in
  // neither obligation, which is the exact failure this constant was created
  // to end — it ended it for the collections that were in the list, and nobody
  // re-derived the list from the rules afterwards.
  //
  // Steps and active energy imported from Apple Health / Health Connect. Health
  // data about a person, so both erasable and portable.
  "dailyActivity",
  // Text the user wrote, under their own uid.
  "feedback",
  // The client-READABLE half of a provider link: connected, connectedAt,
  // lastSyncedAt, lastRecordCount. Erased by nothing until now, so a deleted
  // account left a record saying it had been connected to Oura and when it
  // last synced.
  //
  // **It holds no credential, and that is worth stating because the first
  // reading of this gap said it did.** The Oura refresh token lives at
  // `users/{uid}/private/oura` (`oura-link.ts`), and `private` has been in this
  // list all along — so the token was always erased. What survived was status,
  // which is a real Art. 17 gap and not a leaked secret. It is exported like
  // any other personal data for the same reason: withholding it would need the
  // bearer-token argument that applies to `private` and does not apply here.
  "integrations",
  "private",
] as const;

/**
 * Subcollections deliberately withheld from the Art. 20 export, and why.
 *
 * Art. 20 covers *personal data*, not bearer tokens. `private` holds the Apple
 * refresh token — handing it back in a downloadable JSON widens its blast
 * radius for no portability benefit, the same reasoning `redactProfileSecrets`
 * applies to the profile doc. Erasure still covers it; only export skips it.
 *
 * **Withheld from EXPORT is not withheld from ERASURE**, and that distinction
 * is the whole reason this set exists separately from `USER_SUBCOLLECTIONS`.
 *
 * `integrations` was briefly added here while fixing #99, on the belief that it
 * held the Oura grant. It does not — it is the client-READABLE half of a
 * provider link (connected, connectedAt, lastSyncedAt), and the token is in
 * `private`. It is exported, because excluding it would have rested on an
 * argument that turned out not to apply to it.
 */
export const EXPORT_EXCLUDED: ReadonlySet<string> = new Set(["private"]);

/**
 * Personal data that is NOT under `users/{uid}`.
 *
 * `USER_SUBCOLLECTIONS` made the two obligations agree with each other. It can
 * only ever reach children of `users/{uid}`, and that limit was known: the
 * parity spec's own comment records that an earlier pass saw `publicSlugs` and
 * `usageEvents`, correctly refused to add them to that list (doing so would
 * have deleted another user's slug reservation), and stopped there. Refusing
 * to put them in the subcollection list was right. Concluding that they
 * therefore needed no erasure was the part nobody asked.
 *
 * `firestore.rules` had already written down the intent for one of them —
 * *"Deletion is the account-deletion path, which runs in the admin SDK and
 * bypasses these rules"* — against a delete path that never touched the
 * collection. Measured 2026-09-16: 7 `usageEvents` documents belonging to 3
 * accounts that no longer exist in Firebase Auth.
 *
 * Each entry says how a document is traced back to a uid, because that is the
 * part that differs — a doc id prefix, a `uid` field, or a second collection
 * keyed by a value the first one holds.
 */
export const UID_KEYED_TOP_LEVEL = [
  {
    /** `usageEvents/<uid>_<YYYY-MM-DD>` — per-day product counters. Integer
     *  counts only, but they are counts OF one identified person's behaviour,
     *  which is what makes them personal data rather than statistics. */
    collection: "usageEvents",
    by: "uid-field",
  },
  {
    /** `publicSlugs/<slug>` = `{ uid, claimedAt }`, and `publicProfiles/<slug>`
     *  is the world-readable mirror keyed by that same slug.
     *
     *  **This is the more dangerous of the two and the less obvious.** The
     *  mirror is maintained by `onUserUpdate`, an `onDocumentUpdated` trigger,
     *  and `deleteAccount` DELETES `users/{uid}` — a delete does not fire an
     *  update trigger, and there is no `onDocumentDeleted` anywhere in
     *  `functions/src`. So a deleted account's display name, start weight,
     *  current weight and goal would stay readable by anyone, forever, at
     *  `ignia.fit/u/<slug>`. No live orphan exists today only because no
     *  account currently has a public profile (measured 2026-09-16: zero
     *  documents in both collections) — the gap is latent, not absent, and
     *  `/u/**` is a kept surface (ADR-0036). */
    collection: "publicSlugs",
    by: "uid-field",
    /** Deleted alongside, keyed by the slug (the `publicSlugs` doc id). */
    mirror: "publicProfiles",
  },
] as const;

/**
 * Every OTHER top-level collection in `firestore.rules`, and why erasure does
 * not touch it. A reason, not an omission — the parity spec requires each one
 * to appear either here or above, so a new top-level collection cannot be
 * added without someone deciding which it is.
 */
export const TOP_LEVEL_NOT_ERASED: Readonly<Record<string, string>> = {
  users: "the account root itself — erased by deleteAccount, subcollections via USER_SUBCOLLECTIONS",
  consultationQuota:
    "uid-keyed, and already erased — dailyQuota.deleteAll(uid) covers the photo and consultation counters",
  customers:
    "Stripe extension, REMOVED 2026-08-31 (CLAUDE.md); zero documents as of 2026-09-16. If subscriptions ever ship they go through Apple/Google IAP and this decision is re-made then",
  emailRateLimits:
    "not uid-keyed and not reachable from one: ids are a hash of the address (`pw_email_<hash>`, password-reset.ts), which is the point — the limiter never stores the email it throttles",
  auditLogs:
    "record of ADMIN actions, retained deliberately. An accountability log that the subject of an action can erase is not an accountability log; retention here is the legitimate-interest basis, not an oversight",
  config: "server-side configuration and aggregates; no personal data",
  opsBudget: "org-wide spend ceiling and kill-switch; no personal data",
  products: "Stripe catalog data; no personal data",
  status: "the /status heartbeat; no personal data",
  public: "public aggregate stats and app-version; no personal data",
  publicProfiles: "erased as the mirror of publicSlugs — see UID_KEYED_TOP_LEVEL",
};

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
 * Erase the uid-keyed TOP-LEVEL collections (see {@link UID_KEYED_TOP_LEVEL}).
 *
 * Driven off the constant for the same reason the subcollection path is: a
 * collection named in code and not in a list is the drift this file has
 * already paid for twice.
 *
 * Deliberately NOT folded into `USER_SUBCOLLECTIONS`. These are siblings of
 * `users/{uid}`, not children, and `deleteSubcollection` would resolve
 * `users/{uid}/publicSlugs` — a path that does not exist — while the real
 * documents survived. Worse, an earlier reading of that idea would have had
 * the delete walk `publicSlugs` wholesale and take other users' slug
 * reservations with it.
 */
async function deleteUidKeyedTopLevel(uid: string): Promise<void> {
  for (const entry of UID_KEYED_TOP_LEVEL) {
    const snap = await db.collection(entry.collection).where("uid", "==", uid).get();
    if (snap.empty) continue;
    const batch = db.batch();
    for (const d of snap.docs) {
      batch.delete(d.ref);
      // The mirror is keyed by THIS document's id (the slug), not by the uid,
      // so it can only be found from here.
      const mirror = (entry as { mirror?: string }).mirror;
      if (mirror) batch.delete(db.doc(`${mirror}/${d.id}`));
    }
    await batch.commit();
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
  // Art. 17 and Art. 20 cover the same data, and that is this file's whole
  // doctrine — so the usage counters join the payload the same day they become
  // erasable, rather than the day someone notices the asymmetry. They are
  // observed rather than volunteered, which does not exclude them: the test is
  // whether the data is about an identified person, and a per-day counter
  // under their uid is. The public-profile mirror is not exported: it is a
  // projection of the profile fields already in `profile`, and it is world-
  // readable, so there is nothing to hand back that the user cannot read.
  const [profileSnap, collections, photoQuota, consultationQuota, usageEvents] = await Promise.all([
    userRef.get(),
    Promise.all(exported.map((name) => dumpCollection(name))),
    dailyQuota.dump(uid, "photo"),
    dailyQuota.dump(uid, "consultation"),
    db.collection("usageEvents").where("uid", "==", uid).get()
      .then((s) => s.docs.map((d) => ({ id: d.id, ...d.data() }))),
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
    usageEvents,
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

    // 1c. Purge the uid-keyed TOP-LEVEL collections. Firestore does not
    //     cascade and these are siblings of `users/{uid}`, so nothing above
    //     reaches them: `usageEvents` counters, and the public-profile slug
    //     plus its world-readable mirror. `firestore.rules` has claimed since
    //     it was written that this path deletes the usage counters; until now
    //     it did not.
    await deleteUidKeyedTopLevel(uid);

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
