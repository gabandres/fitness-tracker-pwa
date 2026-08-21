// TYPE-ONLY. The value is required lazily below — see `getGeminiClient`.
import type { GoogleGenAI } from "@google/genai";
import { geminiApiKey } from "./init";

/**
 * The Gemini SDK, loaded on first use and memoized per instance.
 *
 * ## Why this module exists at all
 *
 * Three call sites construct a Gemini client — `analyze-photo`,
 * `consultation`, `weekly-report` — and each used to carry its own static
 * `import { GoogleGenAI } from "@google/genai"`. `index.ts` re-exports every
 * function from one file, so Node evaluated all three on **every** cold start
 * of **every** function: `searchFoods`, `getFoodDetail`, `logWebhook`,
 * `deleteAccount` and the rest all paid to parse a generative-AI SDK they can
 * never call. Measured in an isolated process: **107 ms**, and a cold Cloud Run
 * vCPU is slower than this workstation.
 *
 * **The saving is 18 ms, not 107 — measure the MARGINAL cost, not the isolated
 * one.** Requiring `@google/genai` in a bare process takes 107 ms, and quoting
 * that here would have been wrong: most of it is transitive dependencies that
 * `firebase-admin` has already loaded by the time `index.ts` reaches this
 * module. Measured properly — require `lib/index.js` first, then time the
 * additional `require` — it is **18 ms**. Small, real, and worth keeping, but
 * this module is NOT a cold-start fix on its own; do not cite it as one.
 *
 * The larger reason to keep it is the memoization below. `consultation` and
 * `weekly-report` each built a fresh client per request; now all three share
 * one per instance.
 *
 * ## Why memoized, not just lazy
 *
 * `new GoogleGenAI({...})` builds an HTTP agent. Constructing one per request
 * throws away the keep-alive connection and TLS session the previous request on
 * the same warm instance already paid for, so the second and later calls on an
 * instance would each redo a handshake for nothing.
 *
 * Deliberately NOT constructed at module scope: `geminiApiKey.value()` reads a
 * mounted secret, which is not reliably available during module evaluation on a
 * cold start. Reading it there would trade a real latency win for a boot-order
 * bug that only appears in production.
 */
let client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!client) {
    // `require` rather than `await import` keeps every caller synchronous —
    // making this async would ripple through three unrelated handlers for no
    // gain, and the compiled output is CommonJS, so this is the lazy form.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require("@google/genai") as typeof import("@google/genai");
    client = new sdk.GoogleGenAI({ apiKey: geminiApiKey.value() });
  }
  return client;
}

/** Test seam: drop the memoized client so a new key/secret takes effect. */
export function resetGeminiClient(): void {
  client = null;
}
