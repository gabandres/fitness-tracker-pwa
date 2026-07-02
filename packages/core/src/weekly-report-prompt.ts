/**
 * The Pro weekly-report prompt (ADR-0012 shared brain). Both frontends build
 * the SAME `{ systemInstruction, prompt }` payload and hand it to the
 * `generateWeeklyReport` Cloud Function, which calls Gemini with the
 * server-held key, enforces the Pro gate + 6-day rate limit, and writes the
 * report doc. Pure and dependency-free; the callable + Firestore read are
 * per-frontend.
 *
 * Distinct from the coach prompt: the report window is exactly 14 calendar
 * days aggregated to ONE ROW PER DAY (not per meal) with the headline numbers
 * pre-computed in labeled lines, so the model can't miscount a single snack as
 * a day's total.
 */
import type { DailyLog, ProfileFields } from './types';
import type { TdeeResult } from './tdee';
import type { CoachLocale } from './coach-prompt';
import { localDateKey } from './date';
import { summarizeDays } from './day-summary';
import { weightSlopeLbPerWeek, projectWeight, type WeightPoint } from './weight-projection';

/** Lifetime signals that fuel the report's quiet-milestone line. Deliberately
 *  small — recognises a milestone without shipping the whole history. */
export interface MilestoneContext {
  totalLogs: number;
  earliestLogAt: Date | null;
  currentStreak: number;
}

export interface WeeklyReportInput {
  logs: DailyLog[];
  tdee: TdeeResult;
  profile: ProfileFields | null;
  dailyWeights?: Record<string, number>;
  milestone?: MilestoneContext;
  locale?: CoachLocale;
  /** Injectable "today" for deterministic tests; defaults to real now. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 68 → "5'8\"" */
function formatHeight(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
}

function langSuffix(locale: CoachLocale): string {
  return locale === 'es-PR'
    ? '\n\nRespond in Puerto Rican Spanish. Use informal "tú". Keep numeric formats (calories, grams, pounds) identical to the UI.'
    : '\n\nRespond in English.';
}

/**
 * Derive the milestone context from all-time logs. Uses lifetime logs (not the
 * rolling window) so milestones track the whole journey.
 */
export function buildMilestoneContext(allTimeLogs: DailyLog[], currentStreak: number): MilestoneContext {
  const earliest = allTimeLogs.length > 0
    ? allTimeLogs.reduce((min, l) => (l.date.getTime() < min ? l.date.getTime() : min), Infinity)
    : null;
  return {
    totalLogs: allTimeLogs.length,
    earliestLogAt: earliest != null && isFinite(earliest) ? new Date(earliest) : null,
    currentStreak,
  };
}

/** Build the report system instruction: grounding rules + profile + computed
 *  values + the one-row-per-day 14-day table. */
function buildInstruction(input: WeeklyReportInput, now: Date): string {
  const { logs, tdee, profile, dailyWeights = {} } = input;
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
  lines.push(`- TDEE source: ${tdee.source}`);
  lines.push('');

  // ── 14-day window summary + per-day table ──────────────────
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const windowDays = 14;
  const windowKeys: string[] = [];
  for (let i = windowDays - 1; i >= 0; i--) {
    windowKeys.push(localDateKey(new Date(today.getTime() - i * DAY_MS)));
  }
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
  // Weight trend uses a LONGER 28-day window and a least-squares slope — not
  // the 14-day endpoint delta, which is dominated by day-to-day water swings.
  const TREND_WINDOW_DAYS = 28;
  const trendPoints: WeightPoint[] = [];
  for (let i = TREND_WINDOW_DAYS - 1; i >= 0; i--) {
    const key = localDateKey(new Date(today.getTime() - i * DAY_MS));
    const w = dailyWeights[key];
    if (w != null) trendPoints.push({ dateKey: key, weightLb: w });
  }
  const slopeLbWk = weightSlopeLbPerWeek(trendPoints);
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
    lines.push(`- Most recent weigh-in: ${lastPt.weightLb} lb (${lastPt.dateKey})`);
  }
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

/**
 * Compose the quiet-milestone fragment appended to the report prompt. Returns
 * '' when no milestone is hit. Tone is deliberately calm — a dietician's nod,
 * not a cheerleader's shout.
 */
export function formatMilestoneContext(ctx: MilestoneContext, now: Date = new Date()): string {
  const milestones: string[] = [];
  const daysLogged = ctx.earliestLogAt
    ? Math.floor((now.getTime() - ctx.earliestLogAt.getTime()) / DAY_MS)
    : 0;

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

/**
 * Build the `{ systemInstruction, prompt }` payload the `generateWeeklyReport`
 * Cloud Function expects. Both frontends call this so the report is identical
 * regardless of which app requested it.
 */
export function buildWeeklyReportPayload(
  input: WeeklyReportInput,
): { systemInstruction: string; prompt: string } {
  const now = input.now ?? new Date();
  const systemInstruction = buildInstruction(input, now) + langSuffix(input.locale ?? 'en');
  const milestoneLine = input.milestone ? formatMilestoneContext(input.milestone, now) : '';
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
  return { systemInstruction, prompt };
}
