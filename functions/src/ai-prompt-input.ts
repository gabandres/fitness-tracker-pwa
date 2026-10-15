import { ErrorCode } from "./error-codes";
import {
  isLegacyPromptShape,
  parseCoachRequest,
  parseWeeklyReportRequest,
  renderCoachSystemInstruction,
  renderWeeklyReport,
} from "./ai-prompt-wire";
import {
  coachSystemInstruction,
  coachSystemInstructionV2,
  weeklyReportSystemInstruction,
  weeklyReportSystemInstructionV2,
} from "./server-prompts";

// ─── What a text-generation request turns into ──────────────────────
//
// `consultationStream` and `generateWeeklyReport` both hand their raw body to
// a resolver here and get back either the exact `{ systemInstruction,
// contents }` Gemini will see, or a typed rejection. Pure — no Firestore, no
// Gemini, no auth — so both wire shapes and both settings of the flag below
// are unit-tested without an emulator (test/ai-prompt-input.spec.ts).
//
// v2 (current app): `{ v: 2, locale, context[, question] }`, numbers-only,
// validated field by field (ai-prompt-wire.ts); the server renders every word
// of the system instruction.
//
// LEGACY (binaries before the v2 OTA): `{ systemInstruction, prompt }`, free
// text, fenced under server-owned scope rules (server-prompts.ts).

/**
 * THE FLIP. While true, legacy bodies are still served (fenced, as before
 * v2). Set it to `false` and redeploy ONLY after the v2 OTA is live on every
 * runtime users are on: from then on a legacy body is rejected with
 * `CLIENT_UPDATE_REQUIRED` before any quota or spend is touched.
 *
 * Each legacy request served logs `legacyPromptShape` — when that line stops
 * appearing in the functions logs, nobody is left on the old shape.
 */
export const ACCEPT_LEGACY_PROMPT_SHAPE = true;

// Legacy caps, unchanged from before v2.
const LEGACY_SYSTEM_MAX_CHARS = 20_000;
const LEGACY_PROMPT_MAX_CHARS = 2_000;

export type PromptKind = "consultation" | "weeklyReport";

export type ResolvedPrompt =
  | { ok: true; legacy: boolean; systemInstruction: string; contents: string }
  | { ok: false; code: ErrorCode; message: string };

function resolveLegacy(body: unknown, kind: PromptKind, acceptLegacy: boolean): ResolvedPrompt {
  if (!acceptLegacy) {
    return {
      ok: false,
      code: ErrorCode.CLIENT_UPDATE_REQUIRED,
      message: "This version of the app is no longer supported. Update the app.",
    };
  }
  const { systemInstruction, prompt } = body as { systemInstruction?: unknown; prompt?: unknown };
  if (typeof systemInstruction !== "string" || systemInstruction.length === 0 ||
      systemInstruction.length > LEGACY_SYSTEM_MAX_CHARS) {
    return { ok: false, code: ErrorCode.REPORT_PAYLOAD_INVALID, message: "systemInstruction missing or too large." };
  }
  if (typeof prompt !== "string" || prompt.length === 0 || prompt.length > LEGACY_PROMPT_MAX_CHARS) {
    return { ok: false, code: ErrorCode.REPORT_PAYLOAD_INVALID, message: "prompt missing or too large." };
  }
  console.info("legacyPromptShape", { kind });
  const wrap = kind === "consultation" ? coachSystemInstruction : weeklyReportSystemInstruction;
  return { ok: true, legacy: true, systemInstruction: wrap(systemInstruction), contents: prompt };
}

/** The coach: the question is the user turn; the system instruction is server-rendered. */
export function resolveCoachPrompt(
  body: unknown,
  acceptLegacy: boolean = ACCEPT_LEGACY_PROMPT_SHAPE,
): ResolvedPrompt {
  if (isLegacyPromptShape(body)) return resolveLegacy(body, "consultation", acceptLegacy);
  const parsed = parseCoachRequest(body);
  if (!parsed.ok) return { ok: false, code: ErrorCode.REPORT_PAYLOAD_INVALID, message: parsed.error };
  const { context, locale, question } = parsed.value;
  return {
    ok: true,
    legacy: false,
    systemInstruction: coachSystemInstructionV2(renderCoachSystemInstruction(context, locale)),
    contents: question,
  };
}

/** The weekly report: both the system instruction and the user turn are server-rendered. */
export function resolveWeeklyReportPrompt(
  body: unknown,
  acceptLegacy: boolean = ACCEPT_LEGACY_PROMPT_SHAPE,
): ResolvedPrompt {
  if (isLegacyPromptShape(body)) return resolveLegacy(body, "weeklyReport", acceptLegacy);
  const parsed = parseWeeklyReportRequest(body);
  if (!parsed.ok) return { ok: false, code: ErrorCode.REPORT_PAYLOAD_INVALID, message: parsed.error };
  const { systemInstruction, prompt } = renderWeeklyReport(parsed.value.context, parsed.value.locale);
  return {
    ok: true,
    legacy: false,
    systemInstruction: weeklyReportSystemInstructionV2(systemInstruction),
    contents: prompt,
  };
}
