/**
 * Mobile transport for the AI coach. The Gemini key lives only on the server
 * (ADR-0013 security fix); the app POSTs the grounded prompt to the
 * `consultationStream` Cloud Function and reads its Server-Sent Events stream.
 *
 * React Native's `fetch` cannot expose a streaming response body, so we drive
 * an `XMLHttpRequest` and read `responseText` incrementally in `onprogress`
 * for the typewriter effect — degrading gracefully to "arrives at the end" if
 * a platform doesn't deliver partial text. SSE frames are split by the shared
 * `parseSseFrames` (packages/core), the same parser the web reader uses.
 */
import { parseSseFrames } from '@macrolog/core';

// Same-region gen2 endpoint as the web client builds; the project is fixed
// (single Firebase backend for web + mobile).
const CONSULT_URL =
  'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/consultationStream';

/** Typed error codes the server returns (mirror of functions/src/error-codes
 *  + models/error-codes). The screen maps these to localized copy. */
export const CoachErrorCode = {
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  CONSULTATION_QUOTA_EXCEEDED: 'CONSULTATION_QUOTA_EXCEEDED',
  CONSULTATION_RATE_LIMITED: 'CONSULTATION_RATE_LIMITED',
  RATE_LIMITED: 'RATE_LIMITED',
  REPORT_PAYLOAD_INVALID: 'REPORT_PAYLOAD_INVALID',
  GENERATE_FAILED: 'REPORT_GENERATE_FAILED',
} as const;

export interface CoachError extends Error {
  code?: string;
}

function coachError(code: string | undefined): CoachError {
  const err = new Error(code ?? 'coach failed') as CoachError;
  err.code = code;
  return err;
}

export interface CoachMeta {
  remaining: number;
  limit: number;
}

export interface StreamCoachArgs {
  systemInstruction: string;
  prompt: string;
  idToken: string;
  /** Fired once with the quota counter (server's first `meta` frame). */
  onMeta?: (meta: CoachMeta) => void;
  /** Fired for each text chunk as it streams in. */
  onChunk: (text: string) => void;
}

/**
 * Stream a coach answer. Resolves when the server sends `done`; rejects with a
 * {@link CoachError} carrying `.code` on a preamble failure (non-200 JSON
 * `{ code }`) or a mid-stream `error` frame. The slot is reserved and refunded
 * server-side, so the caller never has to release.
 */
export function streamCoach(args: StreamCoachArgs): Promise<void> {
  const { systemInstruction, prompt, idToken, onMeta, onChunk } = args;
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', CONSULT_URL);
    xhr.setRequestHeader('Content-Type', 'application/json');
    xhr.setRequestHeader('Authorization', `Bearer ${idToken}`);

    let processed = 0; // chars of responseText already consumed
    let buf = '';
    let failCode: string | undefined;

    const drain = () => {
      const full = xhr.responseText ?? '';
      if (full.length <= processed) return;
      buf += full.slice(processed);
      processed = full.length;
      const { events, rest } = parseSseFrames(buf);
      buf = rest;
      for (const { event, data } of events) {
        if (event === 'meta') {
          if (onMeta && data) {
            try { onMeta(JSON.parse(data) as CoachMeta); } catch { /* ignore */ }
          }
        } else if (event === 'error') {
          try { failCode = (JSON.parse(data) as { code?: string }).code; } catch { failCode = CoachErrorCode.GENERATE_FAILED; }
        } else if (event === 'done') {
          // resolution is driven by readyState 4 + failCode below
        } else if (data) {
          try {
            const text = (JSON.parse(data) as { text?: string }).text;
            if (text) onChunk(text);
          } catch { /* skip a malformed frame */ }
        }
      }
    };

    xhr.onprogress = () => drain();

    xhr.onreadystatechange = () => {
      if (xhr.readyState !== 4) return;
      // Non-200 → preamble failure, body is JSON { code }.
      if (xhr.status !== 200) {
        let code: string | undefined;
        try { code = JSON.parse(xhr.responseText)?.code; } catch { /* non-JSON */ }
        reject(coachError(code));
        return;
      }
      drain(); // catch any frames not yet delivered via onprogress
      if (failCode) reject(coachError(failCode));
      else resolve();
    };

    xhr.onerror = () => reject(coachError(undefined));
    xhr.send(JSON.stringify({ systemInstruction, prompt }));
  });
}
