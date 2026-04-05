import { Injectable } from '@angular/core';
import { GoogleGenAI } from '@google/genai';
import { environment } from '../../environments/environment';
import { DailyLog } from './firebase.service';
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
   * log + computed TDEE are injected as the system instruction so
   * every answer is grounded in real data.
   *
   * Yields string chunks as they arrive from the model.
   */
  async *askAboutMyData(
    question: string,
    logs: DailyLog[],
    tdee: TdeeResult,
  ): AsyncGenerator<string, void, void> {
    const systemInstruction = this.buildSystemInstruction(logs, tdee);

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

  private buildSystemInstruction(logs: DailyLog[], tdee: TdeeResult): string {
    const lines: string[] = [];
    lines.push('You are a precise, data-driven personal fitness consultant.');
    lines.push('');
    lines.push(
      "The user is tracking a cut and shares their rolling 14-day fitness log with you below. " +
      "Ground every answer in this data — cite specific numbers, dates, and trends. " +
      "Do not invent values, do not give generic advice that ignores the log, " +
      "and keep responses concise (3–6 short paragraphs at most). Use markdown formatting. " +
      "Tone: a knowledgeable coach who respects the user's time.",
    );
    lines.push('');
    lines.push(
      "If there are fewer than 14 days of data, the TDEE calculation is PROVISIONAL — " +
      "say so and be careful about strong claims.",
    );
    lines.push('');
    lines.push('## Current computed values');
    lines.push(`- True TDEE: ${tdee.trueTdee} kcal/day`);
    lines.push(`- New daily target: ${tdee.newDailyTarget} kcal/day (for a 1.5 lb/week cut)`);
    lines.push(
      `- 14-day weight change: ${tdee.weightChangeTrend} lbs ` +
      "(positive = lost weight, negative = gained)",
    );
    lines.push(`- Logs available: ${logs.length} days`);
    lines.push('');

    if (logs.length > 0) {
      lines.push('## Daily log (oldest → newest)');
      lines.push('| Date | Weight (lbs) | Calories |');
      lines.push('| --- | --- | --- |');
      for (const log of logs) {
        const iso = log.date.toISOString().slice(0, 10);
        lines.push(`| ${iso} | ${log.weight} | ${log.calories} |`);
      }
    } else {
      lines.push('## Daily log');
      lines.push('_(no entries yet)_');
    }

    return lines.join('\n');
  }
}
