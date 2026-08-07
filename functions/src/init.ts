import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { defineSecret } from "firebase-functions/params";
import { CallerAccess } from "./caller-access";
import { DailyQuota } from "./daily-quota";
import { SpendCeiling } from "./spend-ceiling";

/**
 * Shared admin-SDK bootstrap + module singletons. Every feature module
 * imports from here, so requiring any of them initializes the app
 * exactly once. index.ts imports this FIRST — some satellites
 * (food-search.ts) call getFirestore() at module scope and must never
 * be evaluated before initializeApp().
 */
initializeApp();

export const db = getFirestore();
// Inferred SecretParam type is unportable under `declaration: true` —
// annotate via ReturnType like resend-client.ts does.
export const geminiApiKey: ReturnType<typeof defineSecret> = defineSecret("GEMINI_API_KEY");
// ANTHROPIC_API_KEY used to be defined here and bound to analyzePhoto. It was
// removed 2026-08-07: `PHOTO_PROVIDER` in analyze-photo.ts is "gemini", so the
// Claude path never executed, and a bound-but-unused secret still consumes one
// of Secret Manager's 6 free ACTIVE versions — which are counted per BILLING
// ACCOUNT, not per project, and this account was at 14. The key had also been
// exposed in plaintext, so deleting beat rotating something nothing called.
//
// To put Claude back: re-create the secret, re-add `defineSecret` here, and
// re-add it to `secrets: []` in analyze-photo.ts. Flipping `PHOTO_PROVIDER`
// alone is no longer sufficient — see the guard in estimateWithAnthropic.

// Caller-access preamble (auth + rate limit + tier) and the daily-quota
// ledger. Admin list, comped resolution, doc-key format, limits, and the
// reserve/release transactions all live behind these two modules.
export const callerAccess = new CallerAccess(db);
export const dailyQuota = new DailyQuota(db);
// Org-wide spend guard. Distinct from dailyQuota, which caps ONE user:
// this caps everyone together, because a free tier scales the AI bill with
// users who never pay and every one of those calls is individually legal.
export const spendCeiling = new SpendCeiling(db);
