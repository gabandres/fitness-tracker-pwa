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
// Photo-scan runs on Claude Haiku 4.5 (analyze-photo.ts); everything else
// still runs on Gemini. Two providers on purpose — see the model note in
// analyze-photo.ts. Secret Manager's free tier is 6 ACTIVE versions across
// the project, so destroy superseded versions after rotating this one.
export const anthropicApiKey: ReturnType<typeof defineSecret> = defineSecret("ANTHROPIC_API_KEY");

// Caller-access preamble (auth + rate limit + tier) and the daily-quota
// ledger. Admin list, comped resolution, doc-key format, limits, and the
// reserve/release transactions all live behind these two modules.
export const callerAccess = new CallerAccess(db);
export const dailyQuota = new DailyQuota(db);
// Org-wide spend guard. Distinct from dailyQuota, which caps ONE user:
// this caps everyone together, because a free tier scales the AI bill with
// users who never pay and every one of those calls is individually legal.
export const spendCeiling = new SpendCeiling(db);
