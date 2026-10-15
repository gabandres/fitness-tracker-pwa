/**
 * The AI coach's grounding (ADR-0013 / ADR-0012 shared brain). The app turns
 * the user's rolling 14-day log, profile, and computed TDEE into a
 * numbers-only {@link CoachWireContext} and POSTs it with the question to the
 * `consultationStream` Cloud Function, which validates it and renders the
 * system instruction itself (./ai-prompt-wire, mirrored into functions/).
 * Pure and dependency-free; the network call and SSE handling are per-frontend.
 *
 * The prompt does the grounding work: it pins the headline numbers in labeled
 * lines and lays the log out as a table so the model cites the user's real
 * data instead of inventing it.
 */
import type { DailyLog } from './types';
import type { ProfileFields } from './types';
import type { TdeeResult } from './tdee';
import { finalCalorieTarget } from './targets';
import { addDays } from './date';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import {
  AI_PROMPT_WIRE_VERSION,
  COACH_MAX_ROWS,
  COACH_WINDOW_DAYS,
  renderCoachSystemInstruction,
  type CoachLocale,
  type CoachRequest,
  type CoachWireContext,
  type WireProfile,
} from './ai-prompt-wire';

// `CoachLocale` and `COACH_WINDOW_DAYS` are defined in ./ai-prompt-wire (the
// server's copy needs them too) and reach the barrel through it.

/*
 * The coach reasons over COACH_WINDOW_DAYS calendar days of history. The
 * prompt has always SAID "rolling 14-day log"; until 2026-08-12 nothing
 * enforced it, and the two frontends passed windows that were not even the same
 * order of magnitude — web sent `getRecentLogs(14)`, a 14-ROW cache that is ~2
 * days for a heavy logger, while mobile sent 400 rows (~100 days). Trimming
 * here rather than in each caller is what makes the promise true.
 */

export interface CoachPromptInput {
  /** Per-meal rows, any length — trimmed here to the last
   *  {@link COACH_WINDOW_DAYS} calendar days. */
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
  /** The user's day boundary (ADR-0030). Omitted, days are calendar days. */
  boundary?: DayBoundary;
}

/**
 * The rows falling inside the last {@link COACH_WINDOW_DAYS} calendar days,
 * counted back from the newest row present — NOT from "now". Anchoring on the
 * data means a user who last logged three weeks ago still gets their most
 * recent fortnight of eating to ask about, instead of an empty table.
 *
 * Day keys, not millisecond arithmetic: `dayKeyAt` is the same day boundary
 * every other window in this package uses, and date-key strings compare
 * correctly without drifting across a DST change.
 */
function logsInCoachWindow(logs: DailyLog[], boundary: DayBoundary): DailyLog[] {
  if (logs.length === 0) return logs;
  let newest = logs[0].date;
  for (const l of logs) if (l.date > newest) newest = l.date;
  const cutoff = dayKeyAt(addDays(newest, -(COACH_WINDOW_DAYS - 1)), boundary);
  const inWindow = logs.filter((l) => dayKeyAt(l.date, boundary) >= cutoff);
  return capToNewest(inWindow, COACH_MAX_ROWS);
}

/**
 * At most `max` rows — the newest — in their original order. The server
 * rejects a request carrying more than {@link COACH_MAX_ROWS} rows, and
 * nothing in the rules caps how many meals a day may hold, so without this a
 * user who logs ~36+ rows a day would get every coach question refused.
 */
function capToNewest(logs: DailyLog[], max: number): DailyLog[] {
  if (logs.length <= max) return logs;
  const keep = new Set(
    [...logs].sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, max),
  );
  return logs.filter((l) => keep.has(l));
}

/** The profile lines the prompt prints, in wire form (null = not onboarded). */
export function toWireProfile(profile: ProfileFields | null): WireProfile | null {
  if (!profile) return null;
  return {
    heightIn: profile.heightIn,
    age: profile.age,
    sex: profile.sex,
    activityLevel: profile.activityLevel,
    targetPaceLbsPerWeek: profile.targetPaceLbsPerWeek,
    goalWeightLbs: profile.goalWeightLbs ?? null,
  };
}

/**
 * The structured, numbers-only context the coach is grounded on: profile
 * lines, the computed TDEE values, and the per-meal table trimmed to the coach
 * window. This — not prose — is what the app sends; the server renders it with
 * `renderCoachSystemInstruction` (./ai-prompt-wire). Absent per-day weights
 * fall back to any weight on the row.
 */
export function buildCoachPromptContext(input: CoachPromptInput): CoachWireContext {
  const { logs: allLogs, tdee, profile, dailyWeights = {}, boundary = MIDNIGHT } = input;
  const logs = logsInCoachWindow(allLogs, boundary);
  return {
    profile: toWireProfile(profile),
    trueTdee: tdee.trueTdee,
    dailyTarget: finalCalorieTarget(tdee, profile),
    weightChangeTrend: tdee.weightChangeTrend,
    tdeeSource: tdee.source,
    rows: logs.map((log) => {
      const date = dayKeyAt(log.date, boundary);
      // Weight is logged once per day in a separate collection, not per meal
      // entry, so look it up by date key. A meal row's `weight` is normally
      // undefined; the dailyWeights map is the source of truth.
      const weight = dailyWeights[date] ?? log.weight;
      return {
        date,
        weight: weight ?? null,
        calories: log.calories,
        protein: log.protein ?? null,
        exercised: !!(log.exerciseCompleted || log.liftCompleted || log.cardioCompleted),
      };
    }),
  };
}

/**
 * The coach's system instruction, rendered locally from the same context the
 * server renders — kept for tests and previews. The app no longer sends this
 * text; it sends {@link buildCoachRequest}.
 */
export function buildCoachSystemInstruction(input: CoachPromptInput): string {
  return renderCoachSystemInstruction(buildCoachPromptContext(input), input.locale ?? 'en');
}

/** The v2 `consultationStream` body: the question plus numbers-only context. */
export function buildCoachRequest(input: CoachPromptInput & { question: string }): CoachRequest {
  return {
    v: AI_PROMPT_WIRE_VERSION,
    locale: input.locale ?? 'en',
    question: input.question,
    context: buildCoachPromptContext(input),
  };
}
