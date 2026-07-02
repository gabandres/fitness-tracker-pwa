/**
 * Mobile client for the Pro weekly report. The prompt is assembled by the
 * shared `buildWeeklyReportPayload` (packages/core) and sent to the
 * `generateWeeklyReport` Cloud Function, which enforces the Pro gate + 6-day
 * rate limit, calls Gemini with the server-held key, and writes the report
 * doc. The client only triggers generation and reads the doc back via
 * `subscribeLatestReport` — it never touches Gemini.
 */
import { httpsCallable } from 'firebase/functions';
import { functions } from './firebase';

/** Result of the generateWeeklyReport callable (the server also persists it). */
export interface GeneratedWeeklyReport {
  id: string;
  markdown: string;
  generatedAt: number; // epoch ms
}

/** Typed error codes the callable returns via HttpsError details (mirror of
 *  functions/src/error-codes). Drives localized copy on the card. */
export const ReportErrorCode = {
  NOT_ENTITLED: 'REPORT_NOT_ENTITLED',
  TOO_SOON: 'REPORT_TOO_SOON',
  GENERATE_FAILED: 'REPORT_GENERATE_FAILED',
} as const;

/** Extract our typed code from an HttpsError-shaped failure (details.code). */
export function reportErrorCode(err: unknown): string | undefined {
  const details = (err as { details?: unknown })?.details;
  if (details && typeof details === 'object' && 'code' in details) {
    const code = (details as { code: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  }
  return undefined;
}

export async function requestWeeklyReport(
  payload: { systemInstruction: string; prompt: string },
): Promise<GeneratedWeeklyReport> {
  const fn = httpsCallable<typeof payload, GeneratedWeeklyReport>(functions, 'generateWeeklyReport');
  const res = await fn(payload);
  return res.data;
}
