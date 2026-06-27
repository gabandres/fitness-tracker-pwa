import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth, UserRecord } from "firebase-admin/auth";
import { writeAuditLog, tsToIso } from "./audit-log";
import { DailyQuota } from "./daily-quota";

const STATS_TTL_MS = 5 * 60 * 1000; // 5-min cache — cheap to refresh, expensive to run
const ACTIVITY_TTL_MS = 30 * 1000;  // 30-sec cache — feed barely changes between rapid refreshes

function requireAdmin(request: { auth?: { token?: Record<string, unknown> } }): void {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Must be signed in.");
  }
  if (request.auth.token?.["admin"] !== true) {
    throw new HttpsError("permission-denied", "Admin only.");
  }
}

// ─── listUsers ─────────────────────────────────────────────────────
// Firebase Auth users joined with their Firestore profile so the admin
// UI can show display name, sign-up date, plan status, email verified,
// and whether they've completed onboarding.

export const listUsers = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);

  const auth = getAuth();
  const db = getFirestore();

  // listUsers paginates at 1000 per page. At current scale a single page
  // covers everyone; if we ever exceed that, loop with pageToken.
  const users: Array<{
    uid: string;
    email: string;
    displayName: string;
    emailVerified: boolean;
    disabled: boolean;
    createdAt: string | null;
    lastSignInAt: string | null;
    providers: string[];
    admin: boolean;
    profileCompleted: boolean;
    stripeRole: string | null;
    preferredLocale: string | null;
  }> = [];

  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const claims = (u.customClaims as Record<string, unknown>) || {};
      users.push({
        uid: u.uid,
        email: u.email || "",
        displayName: u.displayName || "",
        emailVerified: u.emailVerified,
        disabled: u.disabled,
        createdAt: u.metadata.creationTime
          ? new Date(u.metadata.creationTime).toISOString() : null,
        lastSignInAt: u.metadata.lastSignInTime
          ? new Date(u.metadata.lastSignInTime).toISOString() : null,
        providers: u.providerData.map((p) => p.providerId),
        admin: claims["admin"] === true,
        profileCompleted: false,
        stripeRole: typeof claims["stripeRole"] === "string"
          ? claims["stripeRole"] as string : null,
        preferredLocale: null,
      });
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // Enrich with Firestore profile data (profileCompleted, preferredLocale).
  // Single collection read — cheaper than N per-user gets.
  const profileSnap = await db.collection("users").get();
  const profileByUid = new Map<string, { profileCompleted?: boolean; preferredLocale?: string }>();
  for (const d of profileSnap.docs) {
    profileByUid.set(d.id, d.data() as { profileCompleted?: boolean; preferredLocale?: string });
  }
  for (const u of users) {
    const p = profileByUid.get(u.uid);
    if (p) {
      u.profileCompleted = p.profileCompleted === true;
      u.preferredLocale = p.preferredLocale || null;
    }
  }

  return { users };
});

// ─── getPlatformStats ─────────────────────────────────────────────

export const getPlatformStats = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);
  const db = getFirestore();
  const cacheRef = db.doc("config/platformStats");

  // Allow bypass via { refresh: true } for manual recomputation.
  const { refresh } = (request.data || {}) as { refresh?: boolean };
  if (!refresh) {
    const cached = await cacheRef.get();
    if (cached.exists) {
      const updatedAt = (cached.data()?.["updatedAt"] as Timestamp | undefined)?.toMillis() ?? 0;
      if (Date.now() - updatedAt < STATS_TTL_MS) {
        return cached.data()?.["stats"];
      }
    }
  }

  const now = new Date();
  const d1 = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Tally all Auth users, paginating.
  const auth = getAuth();
  let totalUsers = 0, newUsers1d = 0, newUsers7d = 0, newUsers30d = 0;
  let verifiedCount = 0, disabledCount = 0;
  const providersBreakdown: Record<string, number> = {};
  // Map uid -> auth creation epoch ms; needed to compute first-entry-within-24h/72h
  // since profile docs don't store createdAt.
  const authCreatedByUid = new Map<string, number>();
  let pageToken: string | undefined;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      totalUsers++;
      if (u.emailVerified) verifiedCount++;
      if (u.disabled) disabledCount++;
      const created = u.metadata.creationTime ? new Date(u.metadata.creationTime) : null;
      if (created) authCreatedByUid.set(u.uid, created.getTime());
      if (created && created >= d1) newUsers1d++;
      if (created && created >= d7) newUsers7d++;
      if (created && created >= d30) newUsers30d++;
      for (const p of u.providerData) {
        providersBreakdown[p.providerId] = (providersBreakdown[p.providerId] || 0) + 1;
      }
    }
    pageToken = page.pageToken;
  } while (pageToken);

  // Activation funnel — count three thresholds, all derived from the
  // user-profile docs (not from a collection-group scan of dailyLogs):
  //   profileCompleted:    passed v1 long onboarding OR v2 short onboarding.
  //   onboardingV2CompletedAt: went through the 2-question flow.
  //   firstEntryAt:        stamped by the onDailyLogCreated trigger on
  //                        the first dailyLog write — single field
  //                        read per user instead of scanning every log.
  //
  // Note: pre-existing users who logged before the trigger shipped
  // won't have firstEntryAt set, so this metric undercounts legacy
  // accounts. Acceptable trade — the trigger costs are O(new entries)
  // and the metric is correct going forward. Manual backfill possible
  // via a one-shot script if the gap matters.
  let profileCompletedCount = 0;
  let onboardingV2CompletedCount = 0;
  let usersWithFirstEntryCount = 0;
  // Referral funnel signals — derived from same profile aggregate read.
  let signupsViaReferralCount = 0;
  let referralRewardGrantedCount = 0;
  let currentlyCompedCount = 0;
  let firstEntryWithin24hCount = 0;
  let firstEntryWithin72hCount = 0;
  const nowMs = Date.now();
  try {
    const profileSnap = await db.collection("users").select(
      "profileCompleted",
      "onboardingV2CompletedAt",
      "firstEntryAt",
      "referredBy",
      "referralRewardGrantedAt",
      "compedUntil",
    ).get();
    for (const d of profileSnap.docs) {
      const data = d.data();
      if (data["profileCompleted"] === true) profileCompletedCount++;
      if (data["onboardingV2CompletedAt"] != null) onboardingV2CompletedCount++;
      if (data["firstEntryAt"] != null) usersWithFirstEntryCount++;
      if (data["referredBy"] != null) signupsViaReferralCount++;
      if (data["referralRewardGrantedAt"] != null) referralRewardGrantedCount++;
      const compedUntil = data["compedUntil"] as Timestamp | undefined;
      if (compedUntil && compedUntil.toMillis() > nowMs) currentlyCompedCount++;
      // Activation latency: firstEntryAt - authCreatedAt.
      const firstEntry = data["firstEntryAt"] as Timestamp | undefined;
      const createdMs = authCreatedByUid.get(d.id);
      if (firstEntry && createdMs != null) {
        const deltaMs = firstEntry.toMillis() - createdMs;
        if (deltaMs <= 24 * 60 * 60 * 1000) firstEntryWithin24hCount++;
        if (deltaMs <= 72 * 60 * 60 * 1000) firstEntryWithin72hCount++;
      }
    }
  } catch (err) {
    console.warn("getPlatformStats: profile-aggregate query failed", err);
  }

  // Active users: anyone with a log in the last N days. The collection-
  // group query on dailyLogs.timestamp requires a collection-group index
  // (firestore.indexes.json). If that index is still building (or missing),
  // we degrade gracefully — the stats tab shouldn't 500 the entire panel
  // over one missing metric.
  // Two windowed scans — bounded by the where clause, much smaller
  // working set than an all-time scan as the dataset grows.
  let active7d = 0, active30d = 0;
  try {
    const logs30dSnap = await db.collectionGroup("dailyLogs")
      .where("timestamp", ">=", Timestamp.fromDate(d30))
      .select().get();
    active30d = new Set(logs30dSnap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean)).size;
    const logs7dSnap = await db.collectionGroup("dailyLogs")
      .where("timestamp", ">=", Timestamp.fromDate(d7))
      .select().get();
    active7d = new Set(logs7dSnap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean)).size;
  } catch (err) {
    console.warn("getPlatformStats: active-user query failed (likely missing index)", err);
  }

  // Paid subscribers: count customers/{uid}/subscriptions with active/trialing
  // status. A `.where("status", "in", [...])` collection-group query would need
  // a composite index the Stripe extension never creates — in-memory filter
  // instead, matching the `cancelStripeSubscriptions` pattern in index.ts.
  let activePaidSubs = 0;
  try {
    const allSubsSnap = await db.collectionGroup("subscriptions").get();
    const ACTIVE_STATUSES = new Set(["active", "trialing"]);
    activePaidSubs = allSubsSnap.docs.filter(
      (d) => ACTIVE_STATUSES.has((d.data()?.["status"] as string) || ""),
    ).length;
  } catch (err) {
    console.warn("getPlatformStats: subscriptions query failed", err);
  }

  // MRR estimate: sum recurring price on each active sub. Fallback $3/mo.
  const MACRO_PRICE = 3.00;
  const estimatedMRR = activePaidSubs * MACRO_PRICE;

  // Comped friends count.
  let compedCount = 0;
  try {
    const compedSnap = await db.doc("config/accessList").get();
    compedCount = ((compedSnap.data()?.["compedEmails"] as string[]) || []).length;
  } catch (err) {
    console.warn("getPlatformStats: comped query failed", err);
  }

  const stats = {
    totalUsers,
    newUsers1d,
    newUsers7d,
    newUsers30d,
    verifiedCount,
    disabledCount,
    providersBreakdown,
    active7d,
    active30d,
    activePaidSubs,
    compedCount,
    estimatedMRR: Math.round(estimatedMRR * 100) / 100,
    profileCompletedCount,
    onboardingV2CompletedCount,
    usersWithFirstEntryCount,
    signupsViaReferralCount,
    referralRewardGrantedCount,
    currentlyCompedCount,
    firstEntryWithin24hCount,
    firstEntryWithin72hCount,
  };

  await cacheRef.set({ stats, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return stats;
});

// ─── getRecentActivity ────────────────────────────────────────────
// Two-stream feed for the admin dashboard:
//   - last 20 sign-ups (Auth users by creationTime desc)
//   - last 20 daily-log entries (collection-group by timestamp desc)
// Merged + sorted by timestamp so the operator sees one chronological
// stream. Email lookup goes through a single auth.getUsers batch
// instead of N getUser calls.

export const getRecentActivity = onCall({ timeoutSeconds: 60 }, async (request) => {
  requireAdmin(request);
  const db = getFirestore();
  const auth = getAuth();

  // 30-sec cache — operators clicking refresh repeatedly otherwise
  // re-paginate every auth user on each press. Lifetime kept short so
  // live debugging stays responsive (we want to see new sign-ups
  // within seconds, not 5 min).
  const cacheRef = db.doc("config/activityCache");
  const cached = await cacheRef.get();
  if (cached.exists) {
    const updatedAt = (cached.data()?.["updatedAt"] as Timestamp | undefined)?.toMillis() ?? 0;
    if (Date.now() - updatedAt < ACTIVITY_TTL_MS) {
      return cached.data()?.["payload"];
    }
  }

  type Item = {
    type: "signup" | "entry";
    uid: string;
    email: string | null;
    timestamp: string;
    detail?: string;
  };
  const items: Item[] = [];

  // Recent sign-ups. listUsers doesn't sort, so pull all pages then
  // sort + slice. Wrapped in try/catch so a partial-page failure
  // mid-pagination still lets the entries query run and return data
  // — better degraded UX than aborting the whole feed. At our scale
  // this is tractable; if total ever exceeds 10k this should switch
  // to a Firestore-backed signup audit log indexed by createdAt.
  const allUsers: UserRecord[] = [];
  try {
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      allUsers.push(...page.users);
      pageToken = page.pageToken;
    } while (pageToken);
  } catch (err) {
    console.warn("getRecentActivity: listUsers failed mid-sweep, continuing with partial set", err);
  }

  const sortedSignups = allUsers
    .filter((u) => u.metadata.creationTime)
    .sort((a, b) =>
      new Date(b.metadata.creationTime!).getTime() -
      new Date(a.metadata.creationTime!).getTime(),
    )
    .slice(0, 20);

  for (const u of sortedSignups) {
    items.push({
      type: "signup",
      uid: u.uid,
      email: u.email || null,
      timestamp: new Date(u.metadata.creationTime!).toISOString(),
    });
  }

  // Email lookup map for the entry feed (avoid N round-trips).
  const emailByUid = new Map<string, string>();
  for (const u of allUsers) {
    if (u.email) emailByUid.set(u.uid, u.email);
  }

  // Recent entries. Collection-group on dailyLogs sorted by timestamp.
  // Same index already used by getPlatformStats — no new index needed.
  try {
    const entriesSnap = await db.collectionGroup("dailyLogs")
      .orderBy("timestamp", "desc")
      .limit(20)
      .get();
    for (const d of entriesSnap.docs) {
      const uid = d.ref.parent.parent?.id;
      if (!uid) continue;
      const data = d.data();
      const ts = (data["timestamp"] as Timestamp | undefined)?.toDate();
      if (!ts) continue;
      const kcal = (data["calories"] as number | undefined) ?? 0;
      const label = (data["mealLabel"] as string | undefined) || "Entry";
      items.push({
        type: "entry",
        uid,
        email: emailByUid.get(uid) ?? null,
        timestamp: ts.toISOString(),
        detail: `${label} · ${kcal} kcal`,
      });
    }
  } catch (err) {
    console.warn("getRecentActivity: entries query failed", err);
  }

  // Merge + sort by timestamp desc.
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const payload = { items: items.slice(0, 40) };
  await cacheRef.set({ payload, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  return payload;
});

// ─── getAuditLogs ─────────────────────────────────────────────────

export const getAuditLogs = onCall({ timeoutSeconds: 30 }, async (request) => {
  requireAdmin(request);
  const db = getFirestore();
  const { limit = 50, startAfterTimestamp, actionFilter, dateFrom, dateTo } =
    (request.data || {}) as {
      limit?: number;
      startAfterTimestamp?: string;
      actionFilter?: string;
      dateFrom?: string;
      dateTo?: string;
    };

  let q: FirebaseFirestore.Query = db.collection("auditLogs");
  if (actionFilter) q = q.where("action", "==", actionFilter);
  if (dateFrom) q = q.where("timestamp", ">=", Timestamp.fromDate(new Date(dateFrom)));
  if (dateTo) q = q.where("timestamp", "<=", Timestamp.fromDate(new Date(dateTo)));
  q = q.orderBy("timestamp", "desc");
  if (startAfterTimestamp) {
    q = q.startAfter(Timestamp.fromDate(new Date(startAfterTimestamp)));
  }

  const clamped = Math.min(Math.max(1, limit), 200);
  const snap = await q.limit(clamped + 1).get();
  const logs = snap.docs.slice(0, clamped).map((d) => ({
    id: d.id,
    ...d.data(),
    timestamp: tsToIso(d.data()["timestamp"]),
  }));

  return { logs, hasMore: snap.docs.length > clamped };
});

// ─── User management ──────────────────────────────────────────────

export const adminSuspendUser = onCall(async (request) => {
  requireAdmin(request);
  const { targetUid, disabled } = (request.data || {}) as { targetUid?: string; disabled?: boolean };
  if (!targetUid || typeof disabled !== "boolean") {
    throw new HttpsError("invalid-argument", "targetUid and disabled required.");
  }
  if (targetUid === request.auth!.uid) {
    throw new HttpsError("failed-precondition", "Cannot suspend your own account.");
  }
  const auth = getAuth();
  const target = await auth.getUser(targetUid).catch(() => {
    throw new HttpsError("not-found", "User not found.");
  });
  await auth.updateUser(targetUid, { disabled });
  if (disabled) {
    await auth.revokeRefreshTokens(targetUid);
    // Clear the FCM token so the daily-reminder + day-3 coach schedulers
    // don't keep pushing to a suspended account. Re-registration happens
    // automatically on next sign-in if they're ever unsuspended.
    await getFirestore().doc(`users/${targetUid}`).set(
      { fcmToken: null }, { merge: true },
    ).catch(() => undefined);
  }

  await writeAuditLog({
    action: disabled ? "user_suspend" : "user_unsuspend",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetUid,
    targetEmail: target.email || "",
  });
  return { targetUid, disabled };
});

export const adminDeleteUser = onCall({ timeoutSeconds: 120 }, async (request) => {
  requireAdmin(request);
  const { targetUid } = (request.data || {}) as { targetUid?: string };
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  if (targetUid === request.auth!.uid) {
    throw new HttpsError("failed-precondition", "Cannot delete your own account here.");
  }

  const auth = getAuth();
  const db = getFirestore();
  const target = await auth.getUser(targetUid).catch(() => {
    throw new HttpsError("not-found", "User not found.");
  });
  const targetEmail = target.email || "";

  // Flag active Stripe subscriptions to cancel at period end. Mirrors
  // the owner-initiated deleteAccount flow (index.ts cancelStripeSubscriptions)
  // so admin-deleted paid users don't keep getting billed.
  try {
    const subsSnap = await db.collection(`customers/${targetUid}/subscriptions`).get();
    const ACTIVE = new Set(["trialing", "active", "past_due"]);
    const toCancel = subsSnap.docs.filter((d) => ACTIVE.has((d.data()?.["status"] as string) || ""));
    if (toCancel.length > 0) {
      const batch = db.batch();
      toCancel.forEach((d) => batch.set(d.ref, { cancel_at_period_end: true }, { merge: true }));
      await batch.commit();
    }
  } catch (err) {
    console.warn(`adminDeleteUser: Stripe cancel step failed for uid=${targetUid}`, err);
  }

  // Mirror the user's own deleteAccount flow: cascade subcollections,
  // quotas, profile doc, then the auth record itself.
  const userPath = `users/${targetUid}`;
  const subcollections = [
    "dailyLogs", "presets", "reports", "dailyWeights", "dailyWater", "dailySleep", "measurements",
  ];
  for (const sub of subcollections) {
    const coll = db.collection(`${userPath}/${sub}`);
    while (true) {
      const snap = await coll.limit(500).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      if (snap.size < 500) break;
    }
  }
  await new DailyQuota(db).deleteAll(targetUid);
  await db.doc(userPath).delete().catch(() => undefined);
  await auth.deleteUser(targetUid);

  await writeAuditLog({
    action: "user_delete",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetUid,
    targetEmail,
  });
  return { success: true };
});

export const adminResetPassword = onCall(async (request) => {
  requireAdmin(request);
  const { targetEmail } = (request.data || {}) as { targetEmail?: string };
  if (!targetEmail) {
    throw new HttpsError("invalid-argument", "targetEmail required.");
  }
  const auth = getAuth();
  let target: UserRecord;
  try {
    target = await auth.getUserByEmail(targetEmail);
  } catch {
    throw new HttpsError("not-found", "User not found.");
  }
  const link = await auth.generatePasswordResetLink(targetEmail);

  await writeAuditLog({
    action: "password_reset_link",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetUid: target.uid,
    targetEmail,
  });
  return { link };
});

// ─── Plan override via custom claim ────────────────────────────────
// Flips stripeRole on the target. "paid" unlocks Pro features via the
// existing server-side checks; any other value (including null) drops
// them back to free. Useful for manual comps to users who prefer not
// to appear on the comped-friends list.

export const adminOverridePlan = onCall(async (request) => {
  requireAdmin(request);
  const { targetUid, role } = (request.data || {}) as { targetUid?: string; role?: string | null };
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  const auth = getAuth();
  const target = await auth.getUser(targetUid).catch(() => {
    throw new HttpsError("not-found", "User not found.");
  });
  const existing = (target.customClaims as Record<string, unknown>) || {};
  if (role && typeof role === "string") {
    await auth.setCustomUserClaims(targetUid, { ...existing, stripeRole: role });
  } else {
    const rest = Object.fromEntries(
      Object.entries(existing).filter(([k]) => k !== "stripeRole"),
    );
    await auth.setCustomUserClaims(targetUid, rest);
  }
  await auth.revokeRefreshTokens(targetUid);

  await writeAuditLog({
    action: "plan_override",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetUid,
    targetEmail: target.email || "",
    details: { role: role || null },
  });
  return { targetUid, role: role || null };
});

// ─── Comped-friends list management ────────────────────────────────

export const adminSetCompedEmail = onCall(async (request) => {
  requireAdmin(request);
  const { email, grant } = (request.data || {}) as { email?: string; grant?: boolean };
  if (!email || typeof grant !== "boolean") {
    throw new HttpsError("invalid-argument", "email and grant required.");
  }
  const normalized = email.toLowerCase().trim();
  const db = getFirestore();
  const ref = db.doc("config/accessList");
  const snap = await ref.get();
  const current: string[] = snap.exists ? (snap.data()?.["compedEmails"] as string[] || []) : [];
  const updated = grant
    ? (current.includes(normalized) ? current : [...current, normalized])
    : current.filter((e) => e !== normalized);
  await ref.set({ compedEmails: updated }, { merge: true });

  await writeAuditLog({
    action: grant ? "comped_add" : "comped_remove",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetEmail: normalized,
    details: { total: updated.length },
  });
  return { emails: updated };
});

export const adminListCompedEmails = onCall(async (request) => {
  requireAdmin(request);
  const db = getFirestore();
  const snap = await db.doc("config/accessList").get();
  return { emails: (snap.data()?.["compedEmails"] as string[]) || [] };
});

// ─── Quota reset ───────────────────────────────────────────────────
// Clears today's photo + consultation quota doc for a user. Cheapest
// knob when a paying user hits the cap due to a stuck client retry.

export const adminResetQuotas = onCall(async (request) => {
  requireAdmin(request);
  const { targetUid } = (request.data || {}) as { targetUid?: string };
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  await new DailyQuota(getFirestore()).resetToday(targetUid);

  const auth = getAuth();
  const target = await auth.getUser(targetUid).catch(() => null);
  await writeAuditLog({
    action: "quota_reset",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    targetUid,
    targetEmail: target?.email || "",
  });
  return { success: true };
});

// ─── Data export (CSV) ─────────────────────────────────────────────
// Returns a CSV string inline. Callable response cap is ~10 MB which
// covers tens of thousands of rows — plenty of headroom for this app.

export const adminExportData = onCall({ timeoutSeconds: 120 }, async (request) => {
  requireAdmin(request);
  const { type } = (request.data || {}) as { type?: "users" | "logs" | "metrics" };
  if (type !== "users" && type !== "logs" && type !== "metrics") {
    throw new HttpsError("invalid-argument", "type must be users | logs | metrics.");
  }

  const db = getFirestore();
  const auth = getAuth();

  let csv = "";
  let rowCount = 0;

  if (type === "users") {
    const rows: string[] = ["uid,email,displayName,createdAt,lastSignInAt,emailVerified,disabled,admin,stripeRole,profileCompleted"];
    const profiles = new Map<string, Record<string, unknown>>();
    const pSnap = await db.collection("users").get();
    for (const d of pSnap.docs) profiles.set(d.id, d.data());
    let pageToken: string | undefined;
    do {
      const page = await auth.listUsers(1000, pageToken);
      for (const u of page.users) {
        const claims = (u.customClaims as Record<string, unknown>) || {};
        const p = profiles.get(u.uid) || {};
        rows.push([
          u.uid,
          csvEsc(u.email || ""),
          csvEsc(u.displayName || ""),
          u.metadata.creationTime || "",
          u.metadata.lastSignInTime || "",
          String(u.emailVerified),
          String(u.disabled),
          String(claims["admin"] === true),
          csvEsc((claims["stripeRole"] as string) || ""),
          String(p["profileCompleted"] === true),
        ].join(","));
      }
      pageToken = page.pageToken;
    } while (pageToken);
    rowCount = rows.length - 1;
    csv = rows.join("\n");
  } else if (type === "logs") {
    const rows: string[] = ["uid,timestamp,calories,protein,weight,exerciseCompleted,mealLabel"];
    const snap = await db.collectionGroup("dailyLogs").get();
    for (const d of snap.docs) {
      const uid = d.ref.parent.parent?.id || "";
      const data = d.data();
      rows.push([
        uid,
        tsToIso(data["timestamp"]) || "",
        String(data["calories"] ?? ""),
        String(data["protein"] ?? ""),
        String(data["weight"] ?? ""),
        String(data["exerciseCompleted"] ?? ""),
        csvEsc((data["mealLabel"] as string) || ""),
      ].join(","));
    }
    rowCount = rows.length - 1;
    csv = rows.join("\n");
  } else {
    const rows: string[] = ["metric,value"];
    const stats = await db.doc("config/platformStats").get();
    const s = (stats.data()?.["stats"] as Record<string, unknown>) || {};
    for (const [k, v] of Object.entries(s)) {
      if (typeof v === "object") continue;
      rows.push(`${k},${String(v)}`);
    }
    rowCount = rows.length - 1;
    csv = rows.join("\n");
  }

  // Exports carry every user's email + every daily log — worth auditing
  // even though it's a read-only action. Record the type and row count
  // so the audit tab shows the data footprint of each export.
  await writeAuditLog({
    action: "data_export",
    adminUid: request.auth!.uid,
    adminEmail: (request.auth!.token["email"] as string) || "",
    details: { type, rowCount },
  });

  return { csv };
});

function csvEsc(s: string): string {
  if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// ─── Per-user details (drill-down) ─────────────────────────────────

export const adminGetUserDetails = onCall(async (request) => {
  requireAdmin(request);
  const { targetUid } = (request.data || {}) as { targetUid?: string };
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "targetUid required.");
  }
  const auth = getAuth();
  const db = getFirestore();
  const target = await auth.getUser(targetUid).catch(() => {
    throw new HttpsError("not-found", "User not found.");
  });
  const claims = (target.customClaims as Record<string, unknown>) || {};

  const profileSnap = await db.doc(`users/${targetUid}`).get();
  const profile = profileSnap.exists ? profileSnap.data() : null;

  const [logsCount, presetsCount, reportsCount, measurementsCount] = await Promise.all([
    db.collection(`users/${targetUid}/dailyLogs`).count().get().then((s) => s.data().count),
    db.collection(`users/${targetUid}/presets`).count().get().then((s) => s.data().count),
    db.collection(`users/${targetUid}/reports`).count().get().then((s) => s.data().count),
    db.collection(`users/${targetUid}/measurements`).count().get().then((s) => s.data().count),
  ]);

  const subsSnap = await db.collection(`customers/${targetUid}/subscriptions`).get();
  const subscriptions = subsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      status: data["status"] as string,
      current_period_end: tsToIso(data["current_period_end"]),
      cancel_at_period_end: data["cancel_at_period_end"] === true,
    };
  });

  // Redact webhookApiKey + fcmToken — admin panel shouldn't be the
  // easy leak path for these.
  let safeProfile: Record<string, unknown> | null = null;
  if (profile) {
    const { webhookApiKey: _wk, fcmToken: _ft, ...rest } = profile as Record<string, unknown>;
    safeProfile = rest;
  }

  return {
    user: {
      uid: target.uid,
      email: target.email || "",
      displayName: target.displayName || "",
      emailVerified: target.emailVerified,
      disabled: target.disabled,
      createdAt: target.metadata.creationTime || null,
      lastSignInAt: target.metadata.lastSignInTime || null,
      providers: target.providerData.map((p) => p.providerId),
      admin: claims["admin"] === true,
      stripeRole: (claims["stripeRole"] as string) || null,
    },
    profile: safeProfile,
    counts: {
      dailyLogs: logsCount,
      presets: presetsCount,
      reports: reportsCount,
      measurements: measurementsCount,
    },
    subscriptions,
  };
});
