import { Timestamp } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { GoogleGenAI } from "@google/genai";
import { ErrorCode } from "./error-codes";
import { callerAccess, db, geminiApiKey } from "./init";

// ─── Weekly AI report generation ────────────────────────────────────
//
// Generates the markdown weekly report via Gemini and writes it to
// Firestore. Previously the client called Gemini directly and wrote
// the doc itself — which meant:
//   1. Free users could bypass the Pro gate by calling the client code.
//   2. Token cost was uncapped; a malicious user could spam generations.
//
// This callable fixes both: firestore.rules blocks client writes to
// `users/{uid}/reports`, so the only path to a new report is through
// this function. Gate is paid OR admin OR comped. Rate limit: at most
// one new report every 6 days (the UI only surfaces a fresh report
// weekly anyway, so this is the real usage pattern).

const REPORT_MIN_INTERVAL_MS = 6 * 24 * 60 * 60 * 1000;
const REPORT_SYSTEM_MAX_CHARS = 20_000;
const REPORT_PROMPT_MAX_CHARS = 2_000;
const REPORT_OUTPUT_MAX_CHARS = 10_000; // matches firestore.rules size cap

interface GenerateReportInput {
  systemInstruction?: unknown;
  prompt?: unknown;
}

export const generateWeeklyReport = onCall(
  { secrets: [geminiApiKey], maxInstances: 5 },
  async (request) => {
    const caller = await callerAccess.resolveCaller(request);
    const uid = caller.uid;
    // Gate is paid OR admin OR comped — i.e. anything above free.
    if (caller.tier === "free") {
      throw new HttpsError(
        "permission-denied",
        "Weekly report is a Pro feature.",
        { code: ErrorCode.REPORT_NOT_ENTITLED },
      );
    }

    const { systemInstruction, prompt } = (request.data ?? {}) as GenerateReportInput;
    if (typeof systemInstruction !== "string" || systemInstruction.length === 0 ||
        systemInstruction.length > REPORT_SYSTEM_MAX_CHARS) {
      throw new HttpsError("invalid-argument", "systemInstruction missing or too large.", { code: ErrorCode.REPORT_PAYLOAD_INVALID });
    }
    if (typeof prompt !== "string" || prompt.length === 0 ||
        prompt.length > REPORT_PROMPT_MAX_CHARS) {
      throw new HttpsError("invalid-argument", "prompt missing or too large.", { code: ErrorCode.REPORT_PAYLOAD_INVALID });
    }

    // Rate limit: reject if the latest existing report is < 6 days old.
    // Read the newest report doc and compare generatedAt.
    const reportsRef = db.collection("users").doc(uid).collection("reports");
    const latestSnap = await reportsRef.orderBy("generatedAt", "desc").limit(1).get();
    if (!latestSnap.empty) {
      const generatedAt = latestSnap.docs[0].data().generatedAt as Timestamp | undefined;
      if (generatedAt && Date.now() - generatedAt.toMillis() < REPORT_MIN_INTERVAL_MS) {
        throw new HttpsError(
          "resource-exhausted",
          "A weekly report was generated recently. Try again later.",
          { code: ErrorCode.REPORT_TOO_SOON },
        );
      }
    }

    try {
      const client = new GoogleGenAI({ apiKey: geminiApiKey.value() });
      const result = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: { systemInstruction, temperature: 0.3 },
      });
      const markdown = (result.text ?? "").slice(0, REPORT_OUTPUT_MAX_CHARS);
      if (!markdown) {
        throw new HttpsError("internal", "Empty response from Gemini.", { code: ErrorCode.REPORT_GENERATE_FAILED });
      }

      const generatedAt = Timestamp.now();
      const docRef = await reportsRef.add({ markdown, generatedAt });

      return {
        id: docRef.id,
        markdown,
        generatedAt: generatedAt.toMillis(),
      };
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error("generateWeeklyReport error:", err);
      throw new HttpsError("internal", "Report generation failed.", { code: ErrorCode.REPORT_GENERATE_FAILED });
    }
  },
);
