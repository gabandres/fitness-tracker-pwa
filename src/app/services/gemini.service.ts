import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { CallableGateway } from './callable.gateway';
import { environment } from '../../environments/environment';
import { DailyLog, ProfileFields } from './firebase.service';
import { TdeeResult } from './tdee-calculator.service';
import { TranslationService } from './translation.service';
import { ErrorCode } from '../models/error-codes';
import { buildCoachSystemInstruction, buildWeeklyReportPayload, parseSseFrames } from '@macrolog/core';

/** Build an error carrying a typed `.details.code` so `extractErrorCode()`
    treats a coach-stream failure exactly like an HttpsError from an onCall
    function — the component's error mapping then localizes it unchanged. */
function consultError(code: string | undefined): Error {
  const err = new Error(code ?? 'consultation failed') as Error & { details?: { code: string } };
  if (code) err.details = { code };
  return err;
}

/** Quota counter delivered by the `consultationStream` endpoint's first
    SSE `meta` event, right after it reserves a slot. `remaining < 0`
    means the caller is admin/comped/paid-unlimited (no visible cap). */
export interface ConsultationMeta {
  remaining: number;
  limit: number;
}

/** Shape returned by the `generateWeeklyReport` callable. The server
    already writes the Firestore doc; the client just caches the result
    in memory and renders the markdown. */
export interface GeneratedWeeklyReport {
  id: string;
  markdown: string;
  generatedAt: number; // epoch ms
}

/**
 * All-time signals the weekly report uses to compose the quiet-
 * acknowledgment line. Deliberately small: just the scalars needed to
 * recognize a meaningful milestone (first week logged, N-day streak,
 * 30/90/180 days in, 100th entry) without shipping the whole log
 * history to the server.
 */
export interface MilestoneContext {
  totalLogs: number;
  earliestLogAt: Date | null;
  currentStreak: number;
}

/**
 * Client seam to the AI coach. The Gemini API key is NOT in the bundle:
 * conversational streaming goes through the `consultationStream` Cloud
 * Function (server-held `GEMINI_API_KEY`, ID-token verified, quota +
 * rate-limit enforced), and the weekly report goes through the
 * `generateWeeklyReport` callable. This service only assembles the
 * grounded prompts and relays the server's token stream.
 */
@Injectable({ providedIn: 'root' })
export class GeminiService {
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);
  private readonly auth = inject(Auth);

  /** Same-region gen2 endpoint for the SSE coach stream. Built from the
      project id so it tracks whatever project the bundle is configured
      for. onRequest (not onCall) so the answer can stream token-by-token. */
  private readonly consultUrl =
    `https://us-central1-${environment.firebase.projectId}.cloudfunctions.net/consultationStream`;

  /**
   * Stream a coaching response to the user's question. The 14-day
   * log, profile, and computed TDEE are injected into the system
   * instruction so every answer is grounded in the user's real data.
   *
   * The prompt is assembled here and POSTed to the `consultationStream`
   * Cloud Function, which reserves a quota slot then relays Gemini's
   * token stream as Server-Sent Events. Yields text chunks as they
   * arrive; `onMeta` fires once with the post-reservation quota counter.
   *
   * Throws an error whose `.details.code` is a typed ErrorCode
   * (CONSULTATION_QUOTA_EXCEEDED, CONSULTATION_RATE_LIMITED,
   * UNAUTHENTICATED, …) so callers can `extractErrorCode()` and localize.
   */
  async *askAboutMyData(
    question: string,
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
    dailyWeights: Record<string, number> = {},
    onMeta?: (meta: ConsultationMeta) => void,
  ): AsyncGenerator<string, void, void> {
    // Shared, pure builder (packages/core) — the mobile coach assembles the
    // identical prompt, so both frontends ground the model on the same data.
    const systemInstruction = buildCoachSystemInstruction({
      logs, tdee, profile, dailyWeights, locale: this.translation.language(),
    });

    const user = this.auth.currentUser;
    if (!user) throw consultError(ErrorCode.UNAUTHENTICATED);
    const idToken = await user.getIdToken();

    const res = await fetch(this.consultUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
      body: JSON.stringify({ systemInstruction, prompt: question }),
    });

    if (!res.ok || !res.body) {
      // Preamble failure (auth / rate-limit / quota / bad payload): the
      // server sent a JSON `{ code }` before any stream bytes.
      let code: string | undefined;
      try { code = (await res.json())?.code; } catch { /* non-JSON body */ }
      throw consultError(code);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    // Accumulate bytes and split off complete SSE frames via the shared core
    // parser (parseSseFrames) — the same one the Expo coach uses.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = parseSseFrames(buf);
      buf = rest;
      for (const { event, data } of events) {
        if (event === 'meta') {
          if (onMeta && data) onMeta(JSON.parse(data) as ConsultationMeta);
        } else if (event === 'error') {
          const code = data ? (JSON.parse(data) as { code?: string }).code : undefined;
          throw consultError(code);
        } else if (event === 'done') {
          return;
        } else if (data) {
          const text = (JSON.parse(data) as { text?: string }).text;
          if (text) yield text;
        }
      }
    }
  }

  /**
   * Request a weekly report from the server. The `generateWeeklyReport`
   * Cloud Function enforces the Pro entitlement + 6-day rate limit,
   * calls Gemini with the server-held API key, and writes the resulting
   * doc to Firestore. Clients never hit Gemini for this flow — that's
   * why the report markdown can be trusted against the paywall.
   */
  async generateWeeklyReport(
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
    dailyWeights: Record<string, number> = {},
    milestoneContext?: MilestoneContext,
  ): Promise<GeneratedWeeklyReport> {
    // Shared, pure builder (packages/core) — the mobile app assembles the
    // identical payload, so the report is the same regardless of which app
    // requested it. The report uses a true 14-day, one-row-per-day window
    // (the coach flow keeps the per-meal table for conversational timing).
    const { systemInstruction, prompt } = buildWeeklyReportPayload({
      logs, tdee, profile, dailyWeights,
      milestone: milestoneContext,
      locale: this.translation.language(),
    });

    return this.callables.call<
      { systemInstruction: string; prompt: string },
      GeneratedWeeklyReport
    >('generateWeeklyReport', { systemInstruction, prompt });
  }

}
