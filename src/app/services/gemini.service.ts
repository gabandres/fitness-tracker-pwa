import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { environment } from '../../environments/environment';
import { DailyLog, ProfileFields } from './firebase.service';
import { localDateKey } from '../utils/date';
import { TdeeResult } from './tdee-calculator.service';

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
  private readonly client = new GoogleGenAI({
    apiKey: environment.gemini.apiKey,
  });

  private readonly model = environment.gemini.model;

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
  ): AsyncGenerator<string, void, void> {
    const systemInstruction = this.buildSystemInstruction(logs, tdee, profile);

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
   * One-shot weekly report. Returns the full markdown string (non-streaming).
   */
  async generateWeeklyReport(
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
  ): Promise<string> {
    const systemInstruction = this.buildSystemInstruction(logs, tdee, profile);
    const prompt = [
      'Generate a concise weekly review covering:',
      '1. Progress toward goal (weight trend, pace vs target)',
      '2. Calorie adherence (consistency, average vs target)',
      '3. Protein adequacy (vs 0.7–0.8g/lb bodyweight — the evidence-based threshold for muscle preservation during a deficit, per meta-analyses and the ISSN position stand)',
      '4. Training consistency (lift and cardio frequency)',
      '5. One specific, actionable recommendation for next week',
      '',
      'Format as markdown. Keep it under 300 words. Be direct and data-driven.',
    ].join('\n');

    const result = await this.client.models.generateContent({
      model: this.model,
      contents: prompt,
      config: { systemInstruction, temperature: 0.3 },
    });
    return result.text ?? '';
  }

  private buildSystemInstruction(
    logs: DailyLog[],
    tdee: TdeeResult,
    profile: ProfileFields | null,
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
      lines.push('| Date | Weight (lbs) | Calories | Protein (g) | Lift | Cardio |');
      lines.push('| --- | --- | --- | --- | --- | --- |');
      for (const log of logs) {
        const iso = localDateKey(log.date);
        const pro = log.protein != null ? String(log.protein) : '—';
        const lift = log.liftCompleted ? '✓' : '—';
        const cardio = log.cardioCompleted ? '✓' : '—';
        lines.push(`| ${iso} | ${log.weight} | ${log.calories} | ${pro} | ${lift} | ${cardio} |`);
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
}
