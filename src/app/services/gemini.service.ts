import { Injectable, inject } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { CallableGateway } from './callable.gateway';
import { environment } from '../../environments/environment';
import { DailyLog, ProfileFields } from './firebase.service';
import { localDateKey } from '../utils/date';
import { summarizeDays } from '../utils/day-summary';
import { TdeeResult } from './tdee-calculator.service';
import { TranslationService } from './translation.service';

/** Quota reservation response from the `reserveConsultation` Cloud
    Function. `remaining < 0` means the user is on a paid plan and
    there is no cap. `capped === true` is reserved for future soft-
    cap scenarios (we currently only throw or return success). */
export interface ConsultationReservation {
  capped: boolean;
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
 * Thin wrapper around the Google GenAI SDK.
 *
 * IMPORTANT: the API key is embedded in the client bundle. It is
 * protected by:
 *   1. HTTP referrer restriction (macrolog.web.app + localhost only)
 *   2. API-target restriction (generativelanguage.googleapis.com only)
 *   3. Free tier with no billing linked to the GCP project
 *
 * This is the correct pragmatic choice for a single-user personal
 * tool with a "no backend" architecture constraint. For any multi-
 * tenant use case the key MUST move behind a Cloud Function proxy.
 */
@Injectable({ providedIn: 'root' })
export class GeminiService {
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);
  private readonly client = new GoogleGenAI({
    apiKey: environment.gemini.apiKey,
  });

  private readonly model = environment.gemini.model;

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
   * Atomically reserve one consultation for the signed-in user.
   * Paid users (stripeRole=paid) always succeed with remaining=-1.
   * Free users get 5/day; over-limit throws a `FirebaseError` with
   * code "functions/resource-exhausted".
   *
   * Callers should wrap this + the streaming call in a try/catch and
   * surface the error message — it's user-facing.
   */
  async reserveConsultation(): Promise<ConsultationReservation> {
    return this.callables.call<void, ConsultationReservation>('reserveConsultation');
  }

  /**
   * Refund a consultation slot after a post-reserve failure (network,
   * Gemini 5xx, safety-block). Fire-and-forget — we log but don't
   * surface failures to the user since the worst case is a single
   * wasted slot on a rare double-failure.
   */
  async releaseConsultation(): Promise<void> {
    try {
      await this.callables.call<void, { released: boolean }>('releaseConsultation');
    } catch (err) {
      console.warn('releaseConsultation failed; slot remains consumed.', err);
    }
  }

  /**
   * Stream a coaching response to the user's question. The 14-day
   * log, profile, and computed TDEE are all injected into the system
   * instruction so every answer is grounded in the user's real data.
   *
   * Yields string chunks as they arrive from the model.
   */
  async *askAboutMyData(
    question: string,
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
    dailyWeights: Record<string, number> = {},
  ): AsyncGenerator<string, void, void> {
    const systemInstruction = this.buildSystemInstruction(logs, tdee, profile, dailyWeights) + this.langSuffix();

    const stream = await this.client.models.generateContentStream({
      model: this.model,
      contents: question,
      config: {
        systemInstruction,
        temperature: 0.4,
      },
    });

    for await (const chunk of stream) {
      const text = chunk.text;
      if (text) yield text;
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
    const weightDays = days.filter((d) => d.weight != null);
    const firstWeight = weightDays[0] ?? null;
    const lastWeight = weightDays[weightDays.length - 1] ?? null;
    const weightDelta = firstWeight && lastWeight
      ? Math.round((lastWeight.weight! - firstWeight.weight!) * 10) / 10
      : null;
    const deltaStr = weightDelta == null
      ? 'n/a (need ≥2 weigh-ins in window)'
      : `${weightDelta >= 0 ? '+' : ''}${weightDelta} lb`;

    lines.push(`## 14-day summary (${days[0].key} → ${days[days.length - 1].key})`);
    lines.push(`- Days logged: ${daysLoggedN}/14`);
    lines.push(`- Avg kcal (on logged days): ${avgKcal}`);
    if (minDay && maxDay) {
      lines.push(`- Min daily kcal: ${minDay.calories} on ${minDay.key}`);
      lines.push(`- Max daily kcal: ${maxDay.calories} on ${maxDay.key}`);
    }
    lines.push(`- Avg protein (on logged days): ${avgProtein} g`);
    if (firstWeight && lastWeight && firstWeight.key !== lastWeight.key) {
      lines.push(`- Weight start → end (14d): ${firstWeight.weight} lb (${firstWeight.key}) → ${lastWeight.weight} lb (${lastWeight.key}) (Δ ${deltaStr})`);
    } else {
      lines.push(`- Weight change (14d): ${deltaStr}`);
    }
    if (lastWeight) {
      // Label as "Most recent weigh-in" not "Current weight" so Gemini
      // doesn't quote a 2-day-old reading as today's value when the
      // user skipped the morning weigh-in.
      lines.push(`- Most recent weigh-in: ${lastWeight.weight} lb (${lastWeight.key})`);
    }
    if (profile?.goalWeightLbs != null) {
      lines.push(`- Goal weight: ${profile.goalWeightLbs} lb`);
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
      `- 14-day weight change: ${tdee.weightChangeTrend} lbs ` +
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
