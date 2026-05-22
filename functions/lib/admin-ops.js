"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminGetUserDetails = exports.adminExportData = exports.adminResetQuotas = exports.adminListCompedEmails = exports.adminSetCompedEmail = exports.adminOverridePlan = exports.adminResetPassword = exports.adminDeleteUser = exports.adminSuspendUser = exports.getAuditLogs = exports.getRecentActivity = exports.getPlatformStats = exports.listUsers = void 0;
const https_1 = require("firebase-functions/v2/https");
const firestore_1 = require("firebase-admin/firestore");
const auth_1 = require("firebase-admin/auth");
const audit_log_1 = require("./audit-log");
const STATS_TTL_MS = 5 * 60 * 1000; // 5-min cache — cheap to refresh, expensive to run
const ACTIVITY_TTL_MS = 30 * 1000; // 30-sec cache — feed barely changes between rapid refreshes
function requireAdmin(request) {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "Must be signed in.");
    }
    if (request.auth.token?.["admin"] !== true) {
        throw new https_1.HttpsError("permission-denied", "Admin only.");
    }
}
// ─── listUsers ─────────────────────────────────────────────────────
// Firebase Auth users joined with their Firestore profile so the admin
// UI can show display name, sign-up date, plan status, email verified,
// and whether they've completed onboarding.
exports.listUsers = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    requireAdmin(request);
    const auth = (0, auth_1.getAuth)();
    const db = (0, firestore_1.getFirestore)();
    // listUsers paginates at 1000 per page. At current scale a single page
    // covers everyone; if we ever exceed that, loop with pageToken.
    const users = [];
    let pageToken;
    do {
        const page = await auth.listUsers(1000, pageToken);
        for (const u of page.users) {
            const claims = u.customClaims || {};
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
                    ? claims["stripeRole"] : null,
                preferredLocale: null,
            });
        }
        pageToken = page.pageToken;
    } while (pageToken);
    // Enrich with Firestore profile data (profileCompleted, preferredLocale).
    // Single collection read — cheaper than N per-user gets.
    const profileSnap = await db.collection("users").get();
    const profileByUid = new Map();
    for (const d of profileSnap.docs) {
        profileByUid.set(d.id, d.data());
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
exports.getPlatformStats = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    requireAdmin(request);
    const db = (0, firestore_1.getFirestore)();
    const cacheRef = db.doc("config/platformStats");
    // Allow bypass via { refresh: true } for manual recomputation.
    const { refresh } = (request.data || {});
    if (!refresh) {
        const cached = await cacheRef.get();
        if (cached.exists) {
            const updatedAt = cached.data()?.["updatedAt"]?.toMillis() ?? 0;
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
    const auth = (0, auth_1.getAuth)();
    let totalUsers = 0, newUsers1d = 0, newUsers7d = 0, newUsers30d = 0;
    let verifiedCount = 0, disabledCount = 0;
    const providersBreakdown = {};
    // Map uid -> auth creation epoch ms; needed to compute first-entry-within-24h/72h
    // since profile docs don't store createdAt.
    const authCreatedByUid = new Map();
    let pageToken;
    do {
        const page = await auth.listUsers(1000, pageToken);
        for (const u of page.users) {
            totalUsers++;
            if (u.emailVerified)
                verifiedCount++;
            if (u.disabled)
                disabledCount++;
            const created = u.metadata.creationTime ? new Date(u.metadata.creationTime) : null;
            if (created)
                authCreatedByUid.set(u.uid, created.getTime());
            if (created && created >= d1)
                newUsers1d++;
            if (created && created >= d7)
                newUsers7d++;
            if (created && created >= d30)
                newUsers30d++;
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
        const profileSnap = await db.collection("users").select("profileCompleted", "onboardingV2CompletedAt", "firstEntryAt", "referredBy", "referralRewardGrantedAt", "compedUntil").get();
        for (const d of profileSnap.docs) {
            const data = d.data();
            if (data["profileCompleted"] === true)
                profileCompletedCount++;
            if (data["onboardingV2CompletedAt"] != null)
                onboardingV2CompletedCount++;
            if (data["firstEntryAt"] != null)
                usersWithFirstEntryCount++;
            if (data["referredBy"] != null)
                signupsViaReferralCount++;
            if (data["referralRewardGrantedAt"] != null)
                referralRewardGrantedCount++;
            const compedUntil = data["compedUntil"];
            if (compedUntil && compedUntil.toMillis() > nowMs)
                currentlyCompedCount++;
            // Activation latency: firstEntryAt - authCreatedAt.
            const firstEntry = data["firstEntryAt"];
            const createdMs = authCreatedByUid.get(d.id);
            if (firstEntry && createdMs != null) {
                const deltaMs = firstEntry.toMillis() - createdMs;
                if (deltaMs <= 24 * 60 * 60 * 1000)
                    firstEntryWithin24hCount++;
                if (deltaMs <= 72 * 60 * 60 * 1000)
                    firstEntryWithin72hCount++;
            }
        }
    }
    catch (err) {
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
            .where("timestamp", ">=", firestore_1.Timestamp.fromDate(d30))
            .select().get();
        active30d = new Set(logs30dSnap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean)).size;
        const logs7dSnap = await db.collectionGroup("dailyLogs")
            .where("timestamp", ">=", firestore_1.Timestamp.fromDate(d7))
            .select().get();
        active7d = new Set(logs7dSnap.docs.map((d) => d.ref.parent.parent?.id).filter(Boolean)).size;
    }
    catch (err) {
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
        activePaidSubs = allSubsSnap.docs.filter((d) => ACTIVE_STATUSES.has(d.data()?.["status"] || "")).length;
    }
    catch (err) {
        console.warn("getPlatformStats: subscriptions query failed", err);
    }
    // MRR estimate: sum recurring price on each active sub. Fallback $3/mo.
    const MACRO_PRICE = 3.00;
    const estimatedMRR = activePaidSubs * MACRO_PRICE;
    // Comped friends count.
    let compedCount = 0;
    try {
        const compedSnap = await db.doc("config/accessList").get();
        compedCount = (compedSnap.data()?.["compedEmails"] || []).length;
    }
    catch (err) {
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
    await cacheRef.set({ stats, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    return stats;
});
// ─── getRecentActivity ────────────────────────────────────────────
// Two-stream feed for the admin dashboard:
//   - last 20 sign-ups (Auth users by creationTime desc)
//   - last 20 daily-log entries (collection-group by timestamp desc)
// Merged + sorted by timestamp so the operator sees one chronological
// stream. Email lookup goes through a single auth.getUsers batch
// instead of N getUser calls.
exports.getRecentActivity = (0, https_1.onCall)({ timeoutSeconds: 60 }, async (request) => {
    requireAdmin(request);
    const db = (0, firestore_1.getFirestore)();
    const auth = (0, auth_1.getAuth)();
    // 30-sec cache — operators clicking refresh repeatedly otherwise
    // re-paginate every auth user on each press. Lifetime kept short so
    // live debugging stays responsive (we want to see new sign-ups
    // within seconds, not 5 min).
    const cacheRef = db.doc("config/activityCache");
    const cached = await cacheRef.get();
    if (cached.exists) {
        const updatedAt = cached.data()?.["updatedAt"]?.toMillis() ?? 0;
        if (Date.now() - updatedAt < ACTIVITY_TTL_MS) {
            return cached.data()?.["payload"];
        }
    }
    const items = [];
    // Recent sign-ups. listUsers doesn't sort, so pull all pages then
    // sort + slice. Wrapped in try/catch so a partial-page failure
    // mid-pagination still lets the entries query run and return data
    // — better degraded UX than aborting the whole feed. At our scale
    // this is tractable; if total ever exceeds 10k this should switch
    // to a Firestore-backed signup audit log indexed by createdAt.
    const allUsers = [];
    try {
        let pageToken;
        do {
            const page = await auth.listUsers(1000, pageToken);
            allUsers.push(...page.users);
            pageToken = page.pageToken;
        } while (pageToken);
    }
    catch (err) {
        console.warn("getRecentActivity: listUsers failed mid-sweep, continuing with partial set", err);
    }
    const sortedSignups = allUsers
        .filter((u) => u.metadata.creationTime)
        .sort((a, b) => new Date(b.metadata.creationTime).getTime() -
        new Date(a.metadata.creationTime).getTime())
        .slice(0, 20);
    for (const u of sortedSignups) {
        items.push({
            type: "signup",
            uid: u.uid,
            email: u.email || null,
            timestamp: new Date(u.metadata.creationTime).toISOString(),
        });
    }
    // Email lookup map for the entry feed (avoid N round-trips).
    const emailByUid = new Map();
    for (const u of allUsers) {
        if (u.email)
            emailByUid.set(u.uid, u.email);
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
            if (!uid)
                continue;
            const data = d.data();
            const ts = data["timestamp"]?.toDate();
            if (!ts)
                continue;
            const kcal = data["calories"] ?? 0;
            const label = data["mealLabel"] || "Entry";
            items.push({
                type: "entry",
                uid,
                email: emailByUid.get(uid) ?? null,
                timestamp: ts.toISOString(),
                detail: `${label} · ${kcal} kcal`,
            });
        }
    }
    catch (err) {
        console.warn("getRecentActivity: entries query failed", err);
    }
    // Merge + sort by timestamp desc.
    items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
    const payload = { items: items.slice(0, 40) };
    await cacheRef.set({ payload, updatedAt: firestore_1.FieldValue.serverTimestamp() }, { merge: true });
    return payload;
});
// ─── getAuditLogs ─────────────────────────────────────────────────
exports.getAuditLogs = (0, https_1.onCall)({ timeoutSeconds: 30 }, async (request) => {
    requireAdmin(request);
    const db = (0, firestore_1.getFirestore)();
    const { limit = 50, startAfterTimestamp, actionFilter, dateFrom, dateTo } = (request.data || {});
    let q = db.collection("auditLogs");
    if (actionFilter)
        q = q.where("action", "==", actionFilter);
    if (dateFrom)
        q = q.where("timestamp", ">=", firestore_1.Timestamp.fromDate(new Date(dateFrom)));
    if (dateTo)
        q = q.where("timestamp", "<=", firestore_1.Timestamp.fromDate(new Date(dateTo)));
    q = q.orderBy("timestamp", "desc");
    if (startAfterTimestamp) {
        q = q.startAfter(firestore_1.Timestamp.fromDate(new Date(startAfterTimestamp)));
    }
    const clamped = Math.min(Math.max(1, limit), 200);
    const snap = await q.limit(clamped + 1).get();
    const logs = snap.docs.slice(0, clamped).map((d) => ({
        id: d.id,
        ...d.data(),
        timestamp: (0, audit_log_1.tsToIso)(d.data()["timestamp"]),
    }));
    return { logs, hasMore: snap.docs.length > clamped };
});
// ─── User management ──────────────────────────────────────────────
exports.adminSuspendUser = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { targetUid, disabled } = (request.data || {});
    if (!targetUid || typeof disabled !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "targetUid and disabled required.");
    }
    if (targetUid === request.auth.uid) {
        throw new https_1.HttpsError("failed-precondition", "Cannot suspend your own account.");
    }
    const auth = (0, auth_1.getAuth)();
    const target = await auth.getUser(targetUid).catch(() => {
        throw new https_1.HttpsError("not-found", "User not found.");
    });
    await auth.updateUser(targetUid, { disabled });
    if (disabled) {
        await auth.revokeRefreshTokens(targetUid);
        // Clear the FCM token so the daily-reminder + day-3 coach schedulers
        // don't keep pushing to a suspended account. Re-registration happens
        // automatically on next sign-in if they're ever unsuspended.
        await (0, firestore_1.getFirestore)().doc(`users/${targetUid}`).set({ fcmToken: null }, { merge: true }).catch(() => undefined);
    }
    await (0, audit_log_1.writeAuditLog)({
        action: disabled ? "user_suspend" : "user_unsuspend",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetUid,
        targetEmail: target.email || "",
    });
    return { targetUid, disabled };
});
exports.adminDeleteUser = (0, https_1.onCall)({ timeoutSeconds: 120 }, async (request) => {
    requireAdmin(request);
    const { targetUid } = (request.data || {});
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid required.");
    }
    if (targetUid === request.auth.uid) {
        throw new https_1.HttpsError("failed-precondition", "Cannot delete your own account here.");
    }
    const auth = (0, auth_1.getAuth)();
    const db = (0, firestore_1.getFirestore)();
    const target = await auth.getUser(targetUid).catch(() => {
        throw new https_1.HttpsError("not-found", "User not found.");
    });
    const targetEmail = target.email || "";
    // Flag active Stripe subscriptions to cancel at period end. Mirrors
    // the owner-initiated deleteAccount flow (index.ts cancelStripeSubscriptions)
    // so admin-deleted paid users don't keep getting billed.
    try {
        const subsSnap = await db.collection(`customers/${targetUid}/subscriptions`).get();
        const ACTIVE = new Set(["trialing", "active", "past_due"]);
        const toCancel = subsSnap.docs.filter((d) => ACTIVE.has(d.data()?.["status"] || ""));
        if (toCancel.length > 0) {
            const batch = db.batch();
            toCancel.forEach((d) => batch.set(d.ref, { cancel_at_period_end: true }, { merge: true }));
            await batch.commit();
        }
    }
    catch (err) {
        console.warn(`adminDeleteUser: Stripe cancel step failed for uid=${targetUid}`, err);
    }
    // Mirror the user's own deleteAccount flow: cascade subcollections,
    // quotas, profile doc, then the auth record itself.
    const userPath = `users/${targetUid}`;
    const subcollections = [
        "dailyLogs", "presets", "reports", "dailyWeights", "dailyWater", "measurements",
    ];
    for (const sub of subcollections) {
        const coll = db.collection(`${userPath}/${sub}`);
        while (true) {
            const snap = await coll.limit(500).get();
            if (snap.empty)
                break;
            const batch = db.batch();
            snap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
            if (snap.size < 500)
                break;
        }
    }
    for (const coll of ["photoQuota", "consultationQuota"]) {
        const qsnap = await db.collection(coll).where("uid", "==", targetUid).get();
        if (!qsnap.empty) {
            const batch = db.batch();
            qsnap.docs.forEach((d) => batch.delete(d.ref));
            await batch.commit();
        }
    }
    await db.doc(userPath).delete().catch(() => undefined);
    await auth.deleteUser(targetUid);
    await (0, audit_log_1.writeAuditLog)({
        action: "user_delete",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetUid,
        targetEmail,
    });
    return { success: true };
});
exports.adminResetPassword = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { targetEmail } = (request.data || {});
    if (!targetEmail) {
        throw new https_1.HttpsError("invalid-argument", "targetEmail required.");
    }
    const auth = (0, auth_1.getAuth)();
    let target;
    try {
        target = await auth.getUserByEmail(targetEmail);
    }
    catch {
        throw new https_1.HttpsError("not-found", "User not found.");
    }
    const link = await auth.generatePasswordResetLink(targetEmail);
    await (0, audit_log_1.writeAuditLog)({
        action: "password_reset_link",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
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
exports.adminOverridePlan = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { targetUid, role } = (request.data || {});
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid required.");
    }
    const auth = (0, auth_1.getAuth)();
    const target = await auth.getUser(targetUid).catch(() => {
        throw new https_1.HttpsError("not-found", "User not found.");
    });
    const existing = target.customClaims || {};
    if (role && typeof role === "string") {
        await auth.setCustomUserClaims(targetUid, { ...existing, stripeRole: role });
    }
    else {
        const rest = Object.fromEntries(Object.entries(existing).filter(([k]) => k !== "stripeRole"));
        await auth.setCustomUserClaims(targetUid, rest);
    }
    await auth.revokeRefreshTokens(targetUid);
    await (0, audit_log_1.writeAuditLog)({
        action: "plan_override",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetUid,
        targetEmail: target.email || "",
        details: { role: role || null },
    });
    return { targetUid, role: role || null };
});
// ─── Comped-friends list management ────────────────────────────────
exports.adminSetCompedEmail = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { email, grant } = (request.data || {});
    if (!email || typeof grant !== "boolean") {
        throw new https_1.HttpsError("invalid-argument", "email and grant required.");
    }
    const normalized = email.toLowerCase().trim();
    const db = (0, firestore_1.getFirestore)();
    const ref = db.doc("config/accessList");
    const snap = await ref.get();
    const current = snap.exists ? (snap.data()?.["compedEmails"] || []) : [];
    const updated = grant
        ? (current.includes(normalized) ? current : [...current, normalized])
        : current.filter((e) => e !== normalized);
    await ref.set({ compedEmails: updated }, { merge: true });
    await (0, audit_log_1.writeAuditLog)({
        action: grant ? "comped_add" : "comped_remove",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetEmail: normalized,
        details: { total: updated.length },
    });
    return { emails: updated };
});
exports.adminListCompedEmails = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const db = (0, firestore_1.getFirestore)();
    const snap = await db.doc("config/accessList").get();
    return { emails: snap.data()?.["compedEmails"] || [] };
});
// ─── Quota reset ───────────────────────────────────────────────────
// Clears today's photo + consultation quota doc for a user. Cheapest
// knob when a paying user hits the cap due to a stuck client retry.
exports.adminResetQuotas = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { targetUid } = (request.data || {});
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid required.");
    }
    const db = (0, firestore_1.getFirestore)();
    const today = new Date().toISOString().split("T")[0];
    const targets = [
        db.doc(`photoQuota/${targetUid}_${today}`),
        db.doc(`consultationQuota/${targetUid}_${today}`),
    ];
    await Promise.all(targets.map((r) => r.delete().catch(() => undefined)));
    const auth = (0, auth_1.getAuth)();
    const target = await auth.getUser(targetUid).catch(() => null);
    await (0, audit_log_1.writeAuditLog)({
        action: "quota_reset",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        targetUid,
        targetEmail: target?.email || "",
    });
    return { success: true };
});
// ─── Data export (CSV) ─────────────────────────────────────────────
// Returns a CSV string inline. Callable response cap is ~10 MB which
// covers tens of thousands of rows — plenty of headroom for this app.
exports.adminExportData = (0, https_1.onCall)({ timeoutSeconds: 120 }, async (request) => {
    requireAdmin(request);
    const { type } = (request.data || {});
    if (type !== "users" && type !== "logs" && type !== "metrics") {
        throw new https_1.HttpsError("invalid-argument", "type must be users | logs | metrics.");
    }
    const db = (0, firestore_1.getFirestore)();
    const auth = (0, auth_1.getAuth)();
    let csv = "";
    let rowCount = 0;
    if (type === "users") {
        const rows = ["uid,email,displayName,createdAt,lastSignInAt,emailVerified,disabled,admin,stripeRole,profileCompleted"];
        const profiles = new Map();
        const pSnap = await db.collection("users").get();
        for (const d of pSnap.docs)
            profiles.set(d.id, d.data());
        let pageToken;
        do {
            const page = await auth.listUsers(1000, pageToken);
            for (const u of page.users) {
                const claims = u.customClaims || {};
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
                    csvEsc(claims["stripeRole"] || ""),
                    String(p["profileCompleted"] === true),
                ].join(","));
            }
            pageToken = page.pageToken;
        } while (pageToken);
        rowCount = rows.length - 1;
        csv = rows.join("\n");
    }
    else if (type === "logs") {
        const rows = ["uid,timestamp,calories,protein,weight,exerciseCompleted,mealLabel"];
        const snap = await db.collectionGroup("dailyLogs").get();
        for (const d of snap.docs) {
            const uid = d.ref.parent.parent?.id || "";
            const data = d.data();
            rows.push([
                uid,
                (0, audit_log_1.tsToIso)(data["timestamp"]) || "",
                String(data["calories"] ?? ""),
                String(data["protein"] ?? ""),
                String(data["weight"] ?? ""),
                String(data["exerciseCompleted"] ?? ""),
                csvEsc(data["mealLabel"] || ""),
            ].join(","));
        }
        rowCount = rows.length - 1;
        csv = rows.join("\n");
    }
    else {
        const rows = ["metric,value"];
        const stats = await db.doc("config/platformStats").get();
        const s = stats.data()?.["stats"] || {};
        for (const [k, v] of Object.entries(s)) {
            if (typeof v === "object")
                continue;
            rows.push(`${k},${String(v)}`);
        }
        rowCount = rows.length - 1;
        csv = rows.join("\n");
    }
    // Exports carry every user's email + every daily log — worth auditing
    // even though it's a read-only action. Record the type and row count
    // so the audit tab shows the data footprint of each export.
    await (0, audit_log_1.writeAuditLog)({
        action: "data_export",
        adminUid: request.auth.uid,
        adminEmail: request.auth.token["email"] || "",
        details: { type, rowCount },
    });
    return { csv };
});
function csvEsc(s) {
    if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}
// ─── Per-user details (drill-down) ─────────────────────────────────
exports.adminGetUserDetails = (0, https_1.onCall)(async (request) => {
    requireAdmin(request);
    const { targetUid } = (request.data || {});
    if (!targetUid) {
        throw new https_1.HttpsError("invalid-argument", "targetUid required.");
    }
    const auth = (0, auth_1.getAuth)();
    const db = (0, firestore_1.getFirestore)();
    const target = await auth.getUser(targetUid).catch(() => {
        throw new https_1.HttpsError("not-found", "User not found.");
    });
    const claims = target.customClaims || {};
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
            status: data["status"],
            current_period_end: (0, audit_log_1.tsToIso)(data["current_period_end"]),
            cancel_at_period_end: data["cancel_at_period_end"] === true,
        };
    });
    // Redact webhookApiKey + fcmToken — admin panel shouldn't be the
    // easy leak path for these.
    let safeProfile = null;
    if (profile) {
        const { webhookApiKey: _wk, fcmToken: _ft, ...rest } = profile;
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
            stripeRole: claims["stripeRole"] || null,
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
//# sourceMappingURL=admin-ops.js.map