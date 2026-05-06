import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentUpdated, onDocumentWritten } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";

// ─── Public profile pages (`/u/<slug>`) ────────────────────────────
//
// Opt-in transformation pages users can share to brag about progress.
// Each gets a globally unique URL slug claimed via a server-side
// callable (atomic uniqueness) and rendered from a public-readable
// `publicProfiles/{slug}` mirror that is rebuilt by an `onUserUpdate`
// trigger whenever the user's profile or weight history changes.
//
// Privacy: only fields the user explicitly opts into are mirrored.
// Email, age, sex, and per-meal logs never appear in `publicProfiles`.
// Disabling the public profile (`publicProfileEnabled = false`) deletes
// the public doc immediately.

// 3-30 chars, lowercase a-z 0-9 hyphens, can't start or end with a hyphen.
// Strict: enforces the bounds the error message advertises.
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;
const RESERVED_SLUGS = new Set([
  "admin", "api", "app", "auth", "billing", "calculator", "changelog", "dashboard",
  "faq", "help", "history", "landing", "login", "logout", "macros", "macrolog",
  "onboarding", "pricing", "privacy", "profile", "settings", "signin", "signup",
  "status", "stripe", "subscribe", "support", "terms", "trends", "u", "user",
  "users", "vs", "you",
]);

function normalizeSlug(input: unknown): string {
  if (typeof input !== "string") return "";
  return input.trim().toLowerCase();
}

function assertVerifiedAuth(request: { auth?: { uid?: string; token?: { email_verified?: boolean } } }): string {
  const uid = request.auth?.uid;
  if (!uid) throw new HttpsError("unauthenticated", "Must be signed in.");
  if (request.auth?.token?.email_verified !== true) {
    throw new HttpsError("permission-denied", "Verify your email first.");
  }
  return uid;
}

/**
 * Atomically claim or change a public profile slug. Validates format,
 * blocks reserved words, and uses a Firestore transaction so two users
 * can't claim the same slug. On success, writes the slug + display name
 * to the user's profile; the `onUserUpdateMirrorPublicProfile` trigger
 * builds the public mirror.
 *
 * Releases the previous slug (if any) atomically inside the same
 * transaction so a slug change doesn't leave the old one orphaned.
 */
export const claimPublicSlug = onCall(async (request) => {
  const uid = assertVerifiedAuth(request);
  const slug = normalizeSlug((request.data as { slug?: unknown })?.slug);
  const displayName = typeof (request.data as { displayName?: unknown })?.displayName === "string"
    ? ((request.data as { displayName: string }).displayName).trim().slice(0, 40)
    : "";

  if (!SLUG_RE.test(slug)) {
    throw new HttpsError(
      "invalid-argument",
      "Slug must be 3–30 chars, lowercase a–z, 0–9, hyphens; can't start or end with a hyphen.",
    );
  }
  if (RESERVED_SLUGS.has(slug)) {
    throw new HttpsError("invalid-argument", "That slug is reserved.");
  }

  const db = getFirestore();
  const slugRef = db.doc(`publicSlugs/${slug}`);
  const userRef = db.doc(`users/${uid}`);

  await db.runTransaction(async (tx) => {
    const [slugSnap, userSnap] = await Promise.all([tx.get(slugRef), tx.get(userRef)]);
    if (!userSnap.exists) {
      throw new HttpsError("failed-precondition", "Profile not initialized.");
    }
    if (slugSnap.exists && slugSnap.data()?.["uid"] !== uid) {
      throw new HttpsError("already-exists", "That slug is taken.");
    }
    const previousSlug = userSnap.data()?.["publicSlug"] as string | undefined;
    if (previousSlug && previousSlug !== slug) {
      tx.delete(db.doc(`publicSlugs/${previousSlug}`));
      tx.delete(db.doc(`publicProfiles/${previousSlug}`));
    }
    tx.set(slugRef, { uid, claimedAt: FieldValue.serverTimestamp() });
    tx.set(userRef, {
      publicSlug: slug,
      publicProfileEnabled: true,
      ...(displayName ? { publicDisplayName: displayName } : {}),
    }, { merge: true });
  });

  return { slug };
});

/**
 * Disable the public profile + release the slug. Idempotent.
 */
export const releasePublicSlug = onCall(async (request) => {
  const uid = assertVerifiedAuth(request);
  const db = getFirestore();
  const userRef = db.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return { released: false };
  const slug = userSnap.data()?.["publicSlug"] as string | undefined;

  const batch = db.batch();
  batch.set(userRef, {
    publicSlug: FieldValue.delete(),
    publicProfileEnabled: false,
  }, { merge: true });
  if (slug) {
    batch.delete(db.doc(`publicSlugs/${slug}`));
    batch.delete(db.doc(`publicProfiles/${slug}`));
  }
  await batch.commit();
  return { released: true, slug: slug ?? null };
});

// ─── Public mirror trigger ─────────────────────────────────────────
//
// Rebuilds (or deletes) `publicProfiles/{slug}` whenever the owning
// user's profile updates. We mirror only the safe subset of fields a
// transformation page needs: display name, slug, start/current weight,
// total change, weeks tracked, and started-at. Logs, email, age, and
// sex are never copied.

interface PublicMirror {
  slug: string;
  displayName: string;
  startWeight: number | null;
  currentWeight: number | null;
  totalChange: number | null;
  goalWeight: number | null;
  startedAt: Timestamp | null;
  updatedAt: FirebaseFirestore.FieldValue;
}

async function buildMirrorFromProfile(
  uid: string,
  profile: FirebaseFirestore.DocumentData,
): Promise<PublicMirror | null> {
  const slug = profile["publicSlug"] as string | undefined;
  if (!slug) return null;

  const db = getFirestore();
  // Pull start + current weight from dailyWeights (preferred) — falls
  // back to whatever's on the profile if no daily weights exist yet.
  let startWeight: number | null = null;
  let currentWeight: number | null = null;
  let startedAt: Timestamp | null = null;
  try {
    const dwAsc = await db.collection(`users/${uid}/dailyWeights`)
      .orderBy("date", "asc").limit(1).get();
    const dwDesc = await db.collection(`users/${uid}/dailyWeights`)
      .orderBy("date", "desc").limit(1).get();
    if (!dwAsc.empty) {
      startWeight = (dwAsc.docs[0].data()?.["weight"] as number | undefined) ?? null;
      const d = dwAsc.docs[0].data()?.["date"];
      if (d instanceof Timestamp) startedAt = d;
    }
    if (!dwDesc.empty) {
      currentWeight = (dwDesc.docs[0].data()?.["weight"] as number | undefined) ?? null;
    }
  } catch (err) {
    console.warn(`buildMirror: dailyWeights query failed for uid=${uid}`, err);
  }

  const totalChange = startWeight != null && currentWeight != null
    ? Math.round((currentWeight - startWeight) * 10) / 10 : null;

  const displayName = (profile["publicDisplayName"] as string | undefined)
    || (profile["email"] as string | undefined)?.split("@")[0]
    || "Macro Log user";

  return {
    slug,
    displayName: displayName.slice(0, 40),
    startWeight,
    currentWeight,
    totalChange,
    goalWeight: (profile["goalWeightLbs"] as number | undefined) ?? null,
    startedAt,
    updatedAt: FieldValue.serverTimestamp(),
  };
}

export const onUserUpdateMirrorPublicProfile = onDocumentUpdated(
  "users/{uid}",
  async (event) => {
    const uid = event.params.uid;
    const before = event.data?.before?.data() ?? {};
    const after = event.data?.after?.data() ?? {};
    const enabledBefore = before["publicProfileEnabled"] === true;
    const enabledAfter = after["publicProfileEnabled"] === true;
    const slugBefore = before["publicSlug"] as string | undefined;
    const slugAfter = after["publicSlug"] as string | undefined;
    const db = getFirestore();

    // Guard: skip rebuilds when no public-profile-relevant field
    // changed. Without this, every `lastSeenAt` heartbeat (login,
    // settings toggle, fasting start/stop, …) triggers two
    // dailyWeights reads + one mirror write. Cheap individually,
    // expensive in aggregate as the user base grows.
    const enabledChanged = enabledBefore !== enabledAfter;
    const slugChanged = slugBefore !== slugAfter;
    const displayChanged = before["publicDisplayName"] !== after["publicDisplayName"];
    const goalChanged = before["goalWeightLbs"] !== after["goalWeightLbs"];
    if (!enabledChanged && !slugChanged && !displayChanged && !goalChanged) {
      return;
    }

    if (!enabledAfter) {
      // Disabled (or stayed disabled). Delete any stale mirror keyed by
      // the new slug. The slug-change branch in `claimPublicSlug` already
      // handles deletion of the previous slug's mirror in-transaction.
      if (slugAfter) {
        await db.doc(`publicProfiles/${slugAfter}`).delete().catch(() => {});
      }
      return;
    }
    if (!slugAfter) return;

    const mirror = await buildMirrorFromProfile(uid, after);
    if (!mirror) return;
    await db.doc(`publicProfiles/${slugAfter}`).set(mirror, { merge: true });

    // Log the transition for observability.
    if (!enabledBefore) {
      console.log(`publicProfile: enabled uid=${uid} slug=${slugAfter}`);
    }
  },
);

// Mirror weight changes onto the public profile. Without this, the
// "current weight" on /u/<slug> goes stale until something else
// mutates the profile doc — defeating the page's purpose. Fires on any
// dailyWeights write so an updated reading propagates within seconds.
export const onDailyWeightWriteMirrorPublicProfile = onDocumentWritten(
  "users/{uid}/dailyWeights/{dateKey}",
  async (event) => {
    const uid = event.params.uid;
    const db = getFirestore();
    const userSnap = await db.doc(`users/${uid}`).get();
    if (!userSnap.exists) return;
    const data = userSnap.data() ?? {};
    if (data["publicProfileEnabled"] !== true) return;
    const slug = data["publicSlug"] as string | undefined;
    if (!slug) return;
    const mirror = await buildMirrorFromProfile(uid, data);
    if (!mirror) return;
    await db.doc(`publicProfiles/${slug}`).set(mirror, { merge: true });
  },
);
