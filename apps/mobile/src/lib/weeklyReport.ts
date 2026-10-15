/**
 * Mobile client for the Pro weekly report. The shared
 * `buildWeeklyReportRequest` (packages/core) turns the user's data into a v2
 * numbers-only request; the `generateWeeklyReport` Cloud Function validates
 * it, renders the prompt itself, enforces the Pro gate + 6-day rate limit,
 * calls Gemini with the server-held key, and writes the report doc. The client only triggers generation and reads the doc back via
 * `subscribeLatestReport` — it never touches Gemini.
 */
import type { WeeklyReportRequest } from '@macrolog/core';
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
  /** Per-user daily cap (1/day) — the server-side cost guard behind TOO_SOON. */
  QUOTA_EXCEEDED: 'REPORT_QUOTA_EXCEEDED',
  GENERATE_FAILED: 'REPORT_GENERATE_FAILED',
  /** The server no longer serves this request shape — only an app update helps. */
  CLIENT_UPDATE_REQUIRED: 'CLIENT_UPDATE_REQUIRED',
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
  request: WeeklyReportRequest,
): Promise<GeneratedWeeklyReport> {
  const fn = httpsCallable<WeeklyReportRequest, GeneratedWeeklyReport>(functions, 'generateWeeklyReport');
  const res = await fn(request);
  return res.data;
}
