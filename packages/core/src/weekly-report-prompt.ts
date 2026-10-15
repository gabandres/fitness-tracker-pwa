/**
 * The Pro weekly-report grounding (ADR-0012 shared brain). The app turns the
 * user's logs, weights, profile and TDEE into a numbers-only
 * {@link WeeklyReportWireContext} and hands it to the `generateWeeklyReport`
 * Cloud Function, which validates it, renders the prompt itself
 * (./ai-prompt-wire, mirrored into functions/), calls Gemini with the
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
import { finalCalorieTarget } from './targets';
import { calendarDateKey, parseYmd } from './date';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { summarizeDays } from './day-summary';
import { weightSlopeLbPerWeek, projectWeight, type WeightPoint } from './weight-projection';
import {
  AI_PROMPT_WIRE_VERSION,
  WEEKLY_REPORT_WINDOW_DAYS,
  renderMilestone,
  renderWeeklyReport,
  type CoachLocale,
  type WeeklyReportRequest,
  type WeeklyReportWireContext,
  type WeeklyReportWireMilestone,
} from './ai-prompt-wire';
import { toWireProfile } from './coach-prompt';

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
  /** The user's day boundary (ADR-0030). Omitted, days are calendar days. */
  boundary?: DayBoundary;
}

const DAY_MS = 24 * 60 * 60 * 1000;

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

/** The milestone in wire form: whole days since the first log, never negative. */
export function toWireMilestone(ctx: MilestoneContext, now: Date = new Date()): WeeklyReportWireMilestone {
  // Every field a finite whole number, whatever came in: an Invalid Date or a
  // NaN count would otherwise reach the wire as NaN, which the callable SDK
  // refuses to encode and the server would reject — losing the whole report
  // over a milestone line the legacy text path simply skipped.
  const whole = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0);
  const daysSinceFirstLog = ctx.earliestLogAt
    ? whole((now.getTime() - ctx.earliestLogAt.getTime()) / DAY_MS)
    : 0;
  return {
    daysSinceFirstLog,
    currentStreak: whole(ctx.currentStreak),
    totalLogs: whole(ctx.totalLogs),
  };
}

/**
 * The structured, numbers-only context the report is grounded on: the
 * one-row-per-day 14-day table, the 28-day weight trend, the computed values
 * and the milestone signals. This is what the app sends.
 */
/** Local calendar arithmetic: `i * DAY_MS` skips or repeats a day across a DST change. */
function daysBefore(day: Date, i: number): Date {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() - i);
}

export function buildWeeklyReportContext(input: WeeklyReportInput): WeeklyReportWireContext {
  const now = input.now ?? new Date();
  const { logs, tdee, profile, dailyWeights = {} } = input;
  // The ANCHOR is the user's day, not the calendar date (ADR-0030) — at a
  // non-midnight boundary a report built at 01:00 otherwise starts its window
  // one day late. Every date derived BELOW is synthesized from this settled
  // key, which is the one case `calendarDateKey` is the right answer.
  const boundary = input.boundary ?? MIDNIGHT;
  const today = parseYmd(dayKeyAt(now, boundary));
  const windowKeys: string[] = [];
  for (let i = WEEKLY_REPORT_WINDOW_DAYS - 1; i >= 0; i--) {
    windowKeys.push(calendarDateKey(daysBefore(today, i)));
  }
  const days = summarizeDays(windowKeys, logs, dailyWeights, boundary).map((s) => ({
    date: s.dateKey,
    weight: s.weightLb ?? null,
    calories: s.totalCalories,
    protein: s.totalProtein,
    meals: s.mealCount,
    exercised: s.exercised,
  }));

  // Weight trend uses a LONGER 28-day window and a least-squares slope — not
  // the 14-day endpoint delta, which is dominated by day-to-day water swings.
  const TREND_WINDOW_DAYS = 28;
  const trendPoints: WeightPoint[] = [];
  for (let i = TREND_WINDOW_DAYS - 1; i >= 0; i--) {
    const key = calendarDateKey(daysBefore(today, i));
    const w = dailyWeights[key];
    if (w != null) trendPoints.push({ dateKey: key, weightLb: w });
  }
  const slopeLbWk = weightSlopeLbPerWeek(trendPoints);
  const projection = projectWeight(trendPoints, profile?.goalWeightLbs ?? null);
  const lastPt = trendPoints[trendPoints.length - 1] ?? null;

  return {
    profile: toWireProfile(profile),
    trueTdee: tdee.trueTdee,
    dailyTarget: finalCalorieTarget(tdee, profile),
    tdeeSource: tdee.source,
    days,
    trend: {
      weighIns: trendPoints.length,
      slopeLbWk: slopeLbWk ?? null,
      lastWeighIn: lastPt ? { date: lastPt.dateKey, weightLb: lastPt.weightLb } : null,
      currentWeightLb: projection?.currentFittedLb ?? lastPt?.weightLb ?? null,
      goalDateKey: projection?.goalDateKey ?? null,
    },
    milestone: input.milestone ? toWireMilestone(input.milestone, now) : null,
  };
}

/**
 * Compose the quiet-milestone fragment appended to the report prompt. Returns
 * '' when no milestone is hit. Rendering lives in ./ai-prompt-wire (the server
 * renders it too); this is the Date-shaped convenience over it.
 */
export function formatMilestoneContext(ctx: MilestoneContext, now: Date = new Date()): string {
  return renderMilestone(toWireMilestone(ctx, now));
}

/**
 * The `{ systemInstruction, prompt }` the server will render for this input —
 * rendered locally from the same context, for tests and previews. The app
 * sends {@link buildWeeklyReportRequest}, not this text.
 */
export function buildWeeklyReportPayload(
  input: WeeklyReportInput,
): { systemInstruction: string; prompt: string } {
  return renderWeeklyReport(buildWeeklyReportContext(input), input.locale ?? 'en');
}

/** The v2 `generateWeeklyReport` request body: numbers-only context + locale. */
export function buildWeeklyReportRequest(input: WeeklyReportInput): WeeklyReportRequest {
  return {
    v: AI_PROMPT_WIRE_VERSION,
    locale: input.locale ?? 'en',
    context: buildWeeklyReportContext(input),
  };
}
