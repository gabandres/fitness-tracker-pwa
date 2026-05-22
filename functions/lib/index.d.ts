export declare const logWebhook: import("firebase-functions/v2/https").HttpsFunction;
export declare const analyzePhoto: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    calories: number;
    protein: number;
    description: string;
    confidence: string;
    photosRemaining: number;
}>, unknown>;
export declare const reserveConsultation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    capped: boolean;
    remaining: number;
    limit: number;
}>, unknown>;
/**
 * Refund a previously-reserved consultation slot. Called by the client
 * when the streaming Gemini call fails AFTER reservation (network blip,
 * Gemini 5xx, safety block). Without this, a transient failure silently
 * consumes one of the user's daily slots.
 *
 * Decrements the current-day counter but will not go below zero — so
 * a bad client can't build up credit by spam-calling release.
 */
export declare const releaseConsultation: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    released: boolean;
}>, unknown>;
/**
 * Tells the client whether the signed-in user has unlimited access
 * (admin or comped friend). Client uses this on sign-in to adjust the
 * Subscribe card UI — show the friend/admin badge instead of the
 * $3/mo pitch. Server enforcement is still independent in the
 * quota-reserve functions above; this endpoint only shapes UI.
 */
export declare const checkAccessStatus: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    admin: boolean;
    comped: boolean;
    photosRemaining: null;
    consultationsRemaining: null;
    photoLimit: number;
    consultationLimit: number;
} | {
    admin: false;
    comped: false;
    photosRemaining: number;
    consultationsRemaining: number;
    photoLimit: number;
    consultationLimit: number;
}>, unknown>;
export declare const exportUserData: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    exportedAt: string;
    uid: string;
    profile: Record<string, unknown> | null;
    dailyLogs: {
        id: string;
    }[];
    presets: {
        id: string;
    }[];
    reports: {
        id: string;
    }[];
    dailyWeights: {
        id: string;
    }[];
    dailyWater: {
        id: string;
    }[];
    measurements: {
        id: string;
    }[];
    photoQuota: {
        id: string;
    }[];
    consultationQuota: {
        id: string;
    }[];
}>, unknown>;
export declare const deleteAccount: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
}>, unknown>;
export declare const sendDailyReminders: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const sendDayThreeCoachPush: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const generateWeeklyReport: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    id: string;
    markdown: string;
    generatedAt: number;
}>, unknown>;
export declare const statusPulse: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const publishUserCount: import("firebase-functions/v2/scheduler").ScheduleFunction;
export declare const sendWelcomeEmail: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").QueryDocumentSnapshot> | undefined, {
    uid: string;
}>>;
export declare const onDailyLogCreated: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    uid: string;
    logId: string;
}>>;
export declare const onSubscriptionWritten: import("firebase-functions/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").Change<import("firebase-functions/v2/firestore").DocumentSnapshot> | undefined, {
    uid: string;
    subId: string;
}>>;
export { claimPublicSlug, releasePublicSlug, onUserUpdateMirrorPublicProfile, onDailyWeightWriteMirrorPublicProfile, } from "./public-profile";
export { sendWeeklyDigest } from "./weekly-digest";
export { ogImagePublicProfile, servePublicProfilePage } from "./og-image";
export { bootstrapAdmin, setAdminClaims } from "./admin-claims";
export { startImpersonation, stopImpersonation } from "./impersonation";
export { listUsers, getPlatformStats, getRecentActivity, getAuditLogs, adminSuspendUser, adminDeleteUser, adminResetPassword, adminOverridePlan, adminSetCompedEmail, adminListCompedEmails, adminResetQuotas, adminExportData, adminGetUserDetails, } from "./admin-ops";
export declare const weeklyFirestoreBackup: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=index.d.ts.map