/**
 * The AI coach's grounded system instruction (ADR-0013 / ADR-0012 shared
 * brain). Both frontends assemble the SAME prompt from the user's rolling
 * 14-day log, profile, and computed TDEE, then POST it to the
 * `consultationStream` Cloud Function — so the coach reasons over identical
 * context on web and mobile. Pure and dependency-free; the network call and
 * SSE handling are per-frontend.
 *
 * The prompt does the grounding work: it pins the headline numbers in labeled
 * lines and lays the log out as a table so the model cites the user's real
 * data instead of inventing it.
 */
import type { DailyLog } from './types';
import type { ProfileFields } from './types';
import type { TdeeResult } from './tdee';
import { localDateKey } from './date';

export type CoachLocale = 'en' | 'es-PR';

export interface CoachPromptInput {
  /** The rolling ~14-day log (per-meal rows), oldest → newest. */
  logs: DailyLog[];
  /** Current adaptive-TDEE engine output. */
  tdee: TdeeResult;
  /** Completed profile, or null when the user hasn't finished onboarding. */
  profile: ProfileFields | null;
  /** Canonical one-weight-per-day map (dateKey → lb); weights live in their
   *  own collection, not on meal rows. */
  dailyWeights?: Record<string, number>;
  /** UI language — drives the trailing "respond in …" instruction. */
  locale?: CoachLocale;
}

/** 68 → "5'8\"" */
function formatHeight(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
}

/** One-line language instruction so the coach answers in the UI's language.
 *  Kept in code (not translation JSON) so the prompt engineering stays where
 *  reviewers expect it. */
function langSuffix(locale: CoachLocale): string {
  return locale === 'es-PR'
    ? '\n\nRespond in Puerto Rican Spanish. Use informal "tú". Keep numeric formats (calories, grams, pounds) identical to the UI.'
    : '\n\nRespond in English.';
}

/**
 * Build the coach's system instruction: grounding rules + profile + computed
 * values + the per-meal log table, followed by the language instruction.
 * Absent per-day weights fall back to any weight on the row; a missing macro
 * renders as "—" rather than a fabricated number.
 */
export function buildCoachSystemInstruction(input: CoachPromptInput): string {
  const { logs, tdee, profile, dailyWeights = {}, locale = 'en' } = input;
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
    lines.push(`- Height: ${formatHeight(profile.heightIn)}`);
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
      // entry, so look it up by date key. A meal row's `weight` is normally
      // undefined; the dailyWeights map is the source of truth.
      const dayWeight = dailyWeights[iso] ?? log.weight;
      const weightCell = dayWeight != null ? String(dayWeight) : '—';
      lines.push(`| ${iso} | ${weightCell} | ${log.calories} | ${pro} | ${exercised} |`);
    }
  } else {
    lines.push('## Daily log');
    lines.push('_(no entries yet)_');
  }

  return lines.join('\n') + langSuffix(locale);
}
