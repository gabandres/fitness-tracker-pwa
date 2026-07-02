import { Injectable, inject } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { CallableGateway } from './callable.gateway';
import { environment } from '../../environments/environment';
import { DailyLog, ProfileFields } from './firebase.service';
import { localDateKey } from '../utils/date';
import { summarizeDays } from '../utils/day-summary';
import { weightSlopeLbPerWeek, projectWeight, type WeightPoint } from '../utils/weekly-insights';
import { TdeeResult } from './tdee-calculator.service';
import { TranslationService } from './translation.service';
import { ErrorCode } from '../models/error-codes';

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

  /** One-line language instruction appended to every prompt so the coach
      answers in the UI's active language. Keeping this in code (not in
      translation JSON) avoids bloating the JSON with prompt engineering
      and keeps diffs where reviewers expect them. */
  private langSuffix(): string {
    return this.translation.language() === 'es-PR'
      ? '\n\nRespond in Puerto Rican Spanish. Use informal "tú". Keep numeric formats (calories, grams, pounds) identical to the UI.'
      : '\n\nRespond in English.';
  }

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
    const systemInstruction = this.buildSystemInstruction(logs, tdee, profile, dailyWeights) + this.langSuffix();

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
    // Parse the SSE frame stream. Frames are separated by a blank line;
    // each frame is an optional `event:` line + a `data:` line.
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        let event = 'message';
        let data = '';
        for (const line of frame.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
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
    // The weekly report uses a true 14-day window with per-day
    // aggregates (see `buildWeeklyReportInstruction`). The askAboutMyData
    // flow still uses the per-meal table because the model needs the
    // raw timing for conversational follow-ups.
    const systemInstruction = this.buildWeeklyReportInstruction(logs, tdee, profile, dailyWeights) + this.langSuffix();
    const milestoneLine = milestoneContext ? this.formatMilestoneContext(milestoneContext) : '';
    const prompt = [
      'Generate a concise weekly review covering:',
      '1. Progress toward goal (weight trend, pace vs target)',
      '2. Calorie adherence (consistency, average vs target)',
      '3. Protein adequacy (vs 0.7–0.8g/lb bodyweight — the evidence-based threshold for muscle preservation during a deficit, per meta-analyses and the ISSN position stand)',
      '4. Training consistency (lift and cardio frequency)',
      '5. One specific, actionable recommendation for next week',
      '',
      'Format as markdown. Keep it under 300 words. Be direct and data-driven.',
      milestoneLine,
    ].filter((s) => s.length > 0).join('\n');

    return this.callables.call<
      { systemInstruction: string; prompt: string },
      GeneratedWeeklyReport
    >('generateWeeklyReport', { systemInstruction, prompt });
  }

  /**
   * Build the system instruction for the weekly report.
   *
   * Crucial difference from `buildSystemInstruction`: the weekly report
   * window is exactly 14 calendar days ending today, and the daily log
   * is aggregated to ONE ROW PER DAY (total kcal/protein, meal count,
   * exercise flag, weight). Previously we fed the model the raw per-
   * meal rows, and it confidently reported a single meal's kcal as if
   * it were the full day total (e.g. "min 200 kcal on May 12" when
   * that was just one snack of a 5-meal 2650-kcal day).
   *
   * We also pre-compute the headline numbers (days logged, avg/min/max
   * kcal, weight delta) and put them in labeled summary lines so the
   * model has no opportunity to miscount.
   */
  private buildWeeklyReportInstruction(
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
    dailyWeights: Record<string, number> = {},
  ): string {
    const lines: string[] = [];
    lines.push('You are a precise, data-driven personal fitness consultant.');
    lines.push('');
    lines.push(
      "The user shares their profile, a 14-day fitness summary (with one " +
      "row per day, not per meal), and current computed TDEE values below. " +
      "Ground every answer in this data — cite specific numbers, dates, " +
      "and trends. Do not invent values, do not give generic advice that " +
      "ignores the log, and keep responses concise (3–6 short paragraphs " +
      "at most). Use markdown formatting. Tone: a knowledgeable coach who " +
      "respects the user's time.",
    );
    lines.push('');
    lines.push(
      "If the TDEE source is 'formula' or 'seed', the estimate is PROVISIONAL — " +
      "say so when making strong claims. Measured mode (14+ days of real data) " +
      "is the only source that reflects the user's actual metabolism.",
    );
    lines.push('');
    lines.push(
      "Protein guideline: use 0.7–0.8 g per pound of bodyweight as the " +
      "evidence-based target for muscle preservation during a caloric deficit " +
      "(per ISSN position stand and recent meta-analyses). The old '1g/lb' rule " +
      "is the upper safety margin, not the clinical threshold. Only recommend " +
      "above 0.8g/lb for very lean or heavily resistance-trained individuals " +
      "in a steep deficit. " +
      "Never describe protein as 'critically low' if intake falls within 0.7–0.8 g/lb. " +
      "Reserve alarm language only for intake genuinely below 0.65 g/lb.",
    );
    lines.push('');

    // ── Profile ─────────────────────────────────────────────────
    if (profile) {
      lines.push('## User profile');
      lines.push(`- Height: ${this.formatHeight(profile.heightIn)}`);
      lines.push(`- Age: ${profile.age}`);
      lines.push(`- Sex: ${profile.sex}`);
      lines.push(`- Activity level: ${profile.activityLevel.replace('_', ' ')}`);
      lines.push(`- Target cut pace: ${profile.targetPaceLbsPerWeek} lb/week`);
      if (profile.goalWeightLbs != null) {
        lines.push(`- Goal weight: ${profile.goalWeightLbs} lbs`);
      }
      lines.push('');
    }

    // ── Computed values ────────────────────────────────────────
    lines.push('## Current computed values');
    lines.push(`- True TDEE: ${tdee.trueTdee} kcal/day`);
    lines.push(`- Daily target: ${tdee.newDailyTarget} kcal/day`);
    lines.push(`- TDEE source: ${tdee.source}`);
    lines.push('');

    // ── 14-day window summary + per-day table ──────────────────
    // Window: exactly 14 calendar days ending today (inclusive of
    // today), keyed in the user's local timezone via `localDateKey`.
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const windowDays = 14;
    const windowKeys: string[] = [];
    for (let i = windowDays - 1; i >= 0; i--) {
      const d = new Date(today.getTime() - i * DAY_MS);
      windowKeys.push(localDateKey(d));
    }
    // Delegate the per-day rollup to the shared utility so this prompt
    // builder and `FitnessStore.summaryFor()` agree on totals byte-for-byte.
    // The local `days` shape (key/calories/protein/meals/...) is kept so the
    // summary-line emission below stays unchanged.
    const days = summarizeDays(windowKeys, logs, dailyWeights).map((s) => ({
      key: s.dateKey,
      calories: s.totalCalories,
      protein: s.totalProtein,
      meals: s.mealCount,
      exercised: s.exercised,
      weight: s.weightLb,
    }));

    const loggedDays = days.filter((d) => d.meals > 0);
    const daysLoggedN = loggedDays.length;
    const avgKcal = daysLoggedN > 0
      ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / daysLoggedN)
      : 0;
    const avgProtein = daysLoggedN > 0
      ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / daysLoggedN)
      : 0;
    let minDay: typeof loggedDays[number] | null = null;
    let maxDay: typeof loggedDays[number] | null = null;
    for (const d of loggedDays) {
      if (!minDay || d.calories < minDay.calories) minDay = d;
      if (!maxDay || d.calories > maxDay.calories) maxDay = d;
    }
    const exerciseDays = days.filter((d) => d.exercised).length;
    // Weight trend uses a LONGER 28-day window and a least-squares slope
    // — not the 14-day endpoint delta, which is dominated by day-to-day
    // water swings and made the report call genuine progress "stable".
    // Built from the canonical dailyWeights map.
    const TREND_WINDOW_DAYS = 28;
    const trendPoints: WeightPoint[] = [];
    for (let i = TREND_WINDOW_DAYS - 1; i >= 0; i--) {
      const key = localDateKey(new Date(today.getTime() - i * DAY_MS));
      const w = dailyWeights[key];
      if (w != null) trendPoints.push({ dateKey: key, weightLb: w });
    }
    const slopeLbWk = weightSlopeLbPerWeek(trendPoints); // null if too few/clustered
    const projection = projectWeight(trendPoints, profile?.goalWeightLbs ?? null);
    const lastPt = trendPoints[trendPoints.length - 1] ?? null;
    const currentWeightLb = projection?.currentFittedLb ?? lastPt?.weightLb ?? null;

    lines.push(`## 14-day summary (${days[0].key} → ${days[days.length - 1].key})`);
    lines.push(`- Days logged: ${daysLoggedN}/14`);
    lines.push(`- Avg kcal (on logged days): ${avgKcal}`);
    if (minDay && maxDay) {
      lines.push(`- Min daily kcal: ${minDay.calories} on ${minDay.key}`);
      lines.push(`- Max daily kcal: ${maxDay.calories} on ${maxDay.key}`);
    }
    lines.push(`- Avg protein (on logged days): ${avgProtein} g`);
    if (slopeLbWk != null) {
      const dir = slopeLbWk < -0.1 ? 'losing' : slopeLbWk > 0.1 ? 'gaining' : 'flat';
      lines.push(`- Weight trend (28-day regression): ${slopeLbWk >= 0 ? '+' : ''}${Math.round(slopeLbWk * 100) / 100} lb/week (${dir})`);
    } else {
      lines.push('- Weight trend (28-day regression): n/a (need ≥3 weigh-ins spanning ≥5 days)');
    }
    lines.push(`- Weigh-ins in 28-day window: ${trendPoints.length}`);
    if (lastPt) {
      // "Most recent weigh-in" (not "current weight") so the model doesn't
      // quote a stale reading as today's value.
      lines.push(`- Most recent weigh-in: ${lastPt.weightLb} lb (${lastPt.dateKey})`);
    }
    // Direction + goal interpretation computed in CODE so the model never has
    // to infer "progress" from raw distance to the goal — that broke when a
    // stale goal sat on the wrong side of the user's current weight.
    if (profile?.goalWeightLbs != null && currentWeightLb != null) {
      const goal = profile.goalWeightLbs;
      const gap = Math.round((currentWeightLb - goal) * 10) / 10;
      lines.push(`- Goal weight: ${goal} lb`);
      if (Math.abs(gap) <= 1) {
        lines.push(`- Goal status: at goal (current ≈ ${Math.round(currentWeightLb)} lb) — maintenance, not "no progress".`);
      } else if (gap < 0) {
        lines.push(`- Goal status: current weight (${Math.round(currentWeightLb)} lb) is BELOW the goal (${goal} lb). If the user is cutting they have already PASSED this goal — it is likely STALE. Do NOT say "not progressing toward goal"; suggest updating the goal weight.`);
      } else {
        lines.push(`- Goal status: cutting toward goal — ${gap} lb to go. PROGRESS = weight DECREASING (negative 28-day slope). Judge by the slope's sign, not week-to-week noise.`);
      }
      if (projection?.goalDateKey) {
        lines.push(`- Projected goal date at current trend: ${projection.goalDateKey}`);
      } else if (slopeLbWk != null && gap > 1) {
        lines.push('- Current trend is not moving toward the goal (flat or wrong direction).');
      }
    } else if (profile?.goalWeightLbs != null) {
      lines.push(`- Goal weight: ${profile.goalWeightLbs} lb`);
    }
    if (trendPoints.length < 8) {
      lines.push('- NOTE: few weigh-ins / short trend — treat the weight verdict as PROVISIONAL; avoid strong "stable / no progress" claims (2-week scale moves are mostly water).');
    }
    lines.push(`- Exercise days: ${exerciseDays}/14`);
    lines.push('');

    lines.push('## Daily log (one row per day, oldest → newest)');
    lines.push('| Date | Weight (lbs) | Calories | Protein (g) | Meals | Exercise |');
    lines.push('| --- | --- | --- | --- | --- | --- |');
    for (const d of days) {
      const weightCell = d.weight != null ? String(d.weight) : '—';
      const calCell = d.meals > 0 ? String(d.calories) : '—';
      const proCell = d.meals > 0 ? String(d.protein) : '—';
      const mealsCell = d.meals > 0 ? String(d.meals) : '—';
      const exCell = d.exercised ? '✓' : '—';
      lines.push(`| ${d.key} | ${weightCell} | ${calCell} | ${proCell} | ${mealsCell} | ${exCell} |`);
    }

    return lines.join('\n');
  }

  private buildSystemInstruction(
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
    dailyWeights: Record<string, number> = {},
  ): string {
    const lines: string[] = [];
    lines.push('You are a precise, data-driven personal fitness consultant.');
    lines.push('');
    lines.push(
      "The user shares their profile, rolling 14-day fitness log, and current " +
      "computed TDEE values below. Ground every answer in this data — cite " +
      "specific numbers, dates, and trends. Do not invent values, do not give " +
      "generic advice that ignores the log, and keep responses concise (3–6 " +
      "short paragraphs at most). Use markdown formatting. Tone: a knowledgeable " +
      "coach who respects the user's time.",
    );
    lines.push('');
    lines.push(
      "If the TDEE source is 'formula' or 'seed', the estimate is PROVISIONAL — " +
      "say so when making strong claims. Measured mode (14+ days of real data) " +
      "is the only source that reflects the user's actual metabolism.",
    );
    lines.push('');
    lines.push(
      "Protein guideline: use 0.7–0.8 g per pound of bodyweight as the " +
      "evidence-based target for muscle preservation during a caloric deficit " +
      "(per ISSN position stand and recent meta-analyses). The old '1g/lb' rule " +
      "is the upper safety margin, not the clinical threshold. Only recommend " +
      "above 0.8g/lb for very lean or heavily resistance-trained individuals " +
      "in a steep deficit. " +
      "Never describe protein as 'critically low' if intake falls within 0.7–0.8 g/lb. " +
      "Reserve alarm language only for intake genuinely below 0.65 g/lb.",
    );
    lines.push('');

    // ── Profile ─────────────────────────────────────────────────
    if (profile) {
      lines.push('## User profile');
      lines.push(`- Height: ${this.formatHeight(profile.heightIn)}`);
      lines.push(`- Age: ${profile.age}`);
      lines.push(`- Sex: ${profile.sex}`);
      lines.push(`- Activity level: ${profile.activityLevel.replace('_', ' ')}`);
      lines.push(`- Target cut pace: ${profile.targetPaceLbsPerWeek} lb/week`);
      if (profile.goalWeightLbs != null) {
        lines.push(`- Goal weight: ${profile.goalWeightLbs} lbs`);
      }
      lines.push('');
    }

    // ── Computed values ────────────────────────────────────────
    lines.push('## Current computed values');
    lines.push(`- True TDEE: ${tdee.trueTdee} kcal/day`);
    lines.push(`- Daily target: ${tdee.newDailyTarget} kcal/day`);
    lines.push(
      `- Recent weight trend: ${tdee.weightChangeTrend} lbs ` +
      "(positive = lost weight, negative = gained)",
    );
    lines.push(`- TDEE source: ${tdee.source}`);
    lines.push(`- Logs available: ${logs.length} days`);
    lines.push('');

    // ── Log table ──────────────────────────────────────────────
    if (logs.length > 0) {
      lines.push('## Daily log (oldest → newest)');
      lines.push('| Date | Weight (lbs) | Calories | Protein (g) | Exercise |');
      lines.push('| --- | --- | --- | --- | --- |');
      for (const log of logs) {
        const iso = localDateKey(log.date);
        const pro = log.protein != null ? String(log.protein) : '—';
        const exercised = (log.exerciseCompleted || log.liftCompleted || log.cardioCompleted) ? '✓' : '—';
        // Weight is logged once per day in a separate collection, not per meal
        // entry, so look it up by date key. Older code printed `log.weight`
        // which is always undefined for meal rows and leaked the literal
        // string "undefined" into the prompt table.
        const dayWeight = dailyWeights[iso] ?? log.weight;
        const weightCell = dayWeight != null ? String(dayWeight) : '—';
        lines.push(`| ${iso} | ${weightCell} | ${log.calories} | ${pro} | ${exercised} |`);
      }
    } else {
      lines.push('## Daily log');
      lines.push('_(no entries yet)_');
    }

    return lines.join('\n');
  }

  /** 68 -> "5'8\"" */
  private formatHeight(totalInches: number): string {
    const ft = Math.floor(totalInches / 12);
    const inches = totalInches % 12;
    return `${ft}'${inches}"`;
  }

  /**
   * Compose a "quiet milestone" instruction fragment that's appended to
   * the weekly-report prompt. Returns the empty string when no milestone
   * has been hit — in which case the prompt stays unchanged and the
   * report renders exactly as before.
   *
   * The tone rules are deliberately prescriptive: Macro Log's brand is
   * calm, not celebratory. No "🎉" or "amazing!" — a dietician's nod,
   * not a cheerleader's shout.
   */
  private formatMilestoneContext(ctx: MilestoneContext): string {
    const milestones: string[] = [];
    const DAY_MS = 24 * 60 * 60 * 1000;
    const daysLogged = ctx.earliestLogAt
      ? Math.floor((Date.now() - ctx.earliestLogAt.getTime()) / DAY_MS)
      : 0;

    // "First week completed" — gentler than "first log"; the adaptive
    // TDEE engine actually starts producing signal after a week of data.
    if (daysLogged >= 7 && daysLogged < 14) {
      milestones.push('First week of logging completed — the app is starting to see the user\'s patterns.');
    } else if (daysLogged >= 14 && daysLogged < 21) {
      milestones.push('Two weeks of logging — the measured-TDEE engine now has enough data to refine the target.');
    } else if (daysLogged >= 30 && daysLogged < 60) {
      milestones.push('One month of logging — the adaptive TDEE is noticeably tighter than the formula estimate by now.');
    } else if (daysLogged >= 90 && daysLogged < 120) {
      milestones.push('Three months of logging — long enough that weekly weight trends smooth out day-to-day water-weight noise.');
    } else if (daysLogged >= 180 && daysLogged < 210) {
      milestones.push('Six months of logging — a rare signal in the behavior-change literature; the user is in the 5% who stay consistent.');
    } else if (daysLogged >= 365 && daysLogged < 395) {
      milestones.push('One full year of logging.');
    }

    if (ctx.currentStreak >= 30 && ctx.currentStreak < 60) {
      milestones.push(`Current consecutive-day streak: ${ctx.currentStreak} days.`);
    } else if (ctx.currentStreak >= 100) {
      milestones.push(`Current consecutive-day streak: ${ctx.currentStreak} days (deep consistency territory).`);
    }

    if (ctx.totalLogs === 100) {
      milestones.push('100th meal logged this week.');
    } else if (ctx.totalLogs >= 500 && ctx.totalLogs < 510) {
      milestones.push(`${ctx.totalLogs} meals logged — five hundred data points of real intake.`);
    } else if (ctx.totalLogs >= 1000 && ctx.totalLogs < 1010) {
      milestones.push(`${ctx.totalLogs} meals logged — four-figure territory.`);
    }

    if (milestones.length === 0) return '';

    return [
      '',
      'Milestone context (do NOT celebrate loudly — tone must stay calm and dietician-like):',
      ...milestones.map((m) => `- ${m}`),
      '',
      'If any of these feels worth a brief acknowledgment, add ONE concise italicized line at the very end of the report (after the recommendation). Ground it in what the data means for the user\'s progress, not in the milestone itself. Skip the line entirely if the body of the report is already covering the same theme. No emojis. No exclamation points. One sentence, maximum.',
    ].join('\n');
  }
}
