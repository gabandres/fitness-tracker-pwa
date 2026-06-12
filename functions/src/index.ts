// Entry point — a pure export hub. Each feature lives in its own
// module; shared admin-SDK bootstrap + the CallerAccess / DailyQuota
// singletons live in ./init.
//
// ORDERING: ./init must be imported FIRST. It calls initializeApp(),
// and some satellites (food-search.ts) call getFirestore() at module
// scope — evaluating one of those before init would throw at deploy.
import "./init";

// ─── Feature modules (formerly inline here) ────────────────────────
export { logWebhook } from "./log-webhook";
export { analyzePhoto } from "./analyze-photo";
export { reserveConsultation, releaseConsultation, checkAccessStatus } from "./consultation";
export { exportUserData, deleteAccount } from "./gdpr";
export { sendDailyReminders, sendDayThreeCoachPush } from "./push-reminders";
export { generateWeeklyReport } from "./weekly-report";
export { statusPulse, publishUserCount, weeklyFirestoreBackup } from "./ops";
export { sendWelcomeEmail, onDailyLogCreated, onSubscriptionWritten } from "./user-lifecycle";

// ─── Satellite modules ──────────────────────────────────────────────
export {
  claimPublicSlug,
  releasePublicSlug,
  onUserUpdateMirrorPublicProfile,
  onDailyWeightWriteMirrorPublicProfile,
} from "./public-profile";
export { sendWeeklyDigest } from "./weekly-digest";
export { searchFoods, getFoodDetail } from "./food-search";
export { ogImagePublicProfile, servePublicProfilePage } from "./og-image";
export { bootstrapAdmin, setAdminClaims } from "./admin-claims";
export { startImpersonation, stopImpersonation } from "./impersonation";
export {
  listUsers,
  getPlatformStats,
  getRecentActivity,
  getAuditLogs,
  adminSuspendUser,
  adminDeleteUser,
  adminResetPassword,
  adminOverridePlan,
  adminSetCompedEmail,
  adminListCompedEmails,
  adminResetQuotas,
  adminExportData,
  adminGetUserDetails,
} from "./admin-ops";
