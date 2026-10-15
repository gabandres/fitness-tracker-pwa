/**
 * The wire format of the two text-generation callables (`consultationStream`,
 * `generateWeeklyReport`) and the renderer that turns it into the prompt.
 *
 * THIS FILE EXISTS TWICE, BYTE-IDENTICAL:
 *   packages/core/src/ai-prompt-wire.ts   (the app builds requests with it)
 *   functions/src/ai-prompt-wire.ts       (the server validates + renders)
 * `functions/` is not a workspace and cannot import core (ADR-0012), so the
 * server carries a copy; `functions/test/ai-prompt-wire-parity.spec.ts` fails
 * on any difference. Edit the core copy, then `cp` it over the functions one.
 * That is also why this file imports NOTHING: it has to compile unchanged
 * under core's Bundler/ESNext config and functions' NodeNext/CommonJS one.
 *
 * ## Why (2026-10-15 audit follow-up)
 *
 * Until v2 the app sent `{ systemInstruction, prompt }` — free text the server
 * handed to Gemini (fenced under server-owned scope rules since the audit, see
 * functions/src/server-prompts.ts). A free-text system prompt makes the
 * endpoint a general Gemini proxy for anyone with an account. In v2 the client
 * sends only NUMBERS, DATES and ENUMS (plus, for the coach, the user's question
 * as the user turn), every field validated by `parse*Request` below, and the
 * server renders every word of the system instruction itself.
 *
 * Why the client still computes the numbers: the coach is grounded on the
 * adaptive TDEE (`dailyTargets` over a 400-row window, weights and profile),
 * which only runs in the app. Reading the raw data server-side would mean a
 * second copy of the whole TDEE engine in functions/. A numeric field lying
 * about the user's own TDEE can only mislead that user's own answer; it cannot
 * carry instructions — no free-text field reaches the system instruction.
 */

// ─── Wire types ─────────────────────────────────────────────────────

export const AI_PROMPT_WIRE_VERSION = 2;

export type CoachLocale = 'en' | 'es-PR' | 'pt-BR';
const LOCALES: readonly CoachLocale[] = ['en', 'es-PR', 'pt-BR'];

export type WireSex = 'male' | 'female';
const SEXES: readonly WireSex[] = ['male', 'female'];

export type WireActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
const ACTIVITY_LEVELS: readonly WireActivityLevel[] = ['sedentary', 'light', 'moderate', 'active', 'very_active'];

export type WireTdeeSource = 'measured' | 'formula' | 'seed';
const TDEE_SOURCES: readonly WireTdeeSource[] = ['measured', 'formula', 'seed'];

/** The profile lines both prompts print. Only what is printed travels. */
export interface WireProfile {
  heightIn: number;
  age: number;
  sex: WireSex;
  activityLevel: WireActivityLevel;
  targetPaceLbsPerWeek: number;
  goalWeightLbs: number | null;
}

/** One meal row of the coach's 14-day table. */
export interface CoachWireRow {
  /** Day key, YYYY-MM-DD (the user's day boundary already applied). */
  date: string;
  weight: number | null;
  calories: number;
  protein: number | null;
  exercised: boolean;
}

export interface CoachWireContext {
  profile: WireProfile | null;
  trueTdee: number;
  dailyTarget: number;
  weightChangeTrend: number;
  tdeeSource: WireTdeeSource;
  /** Already trimmed to the coach window, oldest first. */
  rows: CoachWireRow[];
}

export interface CoachRequest {
  v: typeof AI_PROMPT_WIRE_VERSION;
  locale: CoachLocale;
  /** The user's question — the user turn, never part of the system instruction. */
  question: string;
  context: CoachWireContext;
}

/** One day of the weekly report's 14-row table. */
export interface WeeklyReportWireDay {
  date: string;
  weight: number | null;
  calories: number;
  protein: number;
  meals: number;
  exercised: boolean;
}

export interface WeeklyReportWireTrend {
  /** Weigh-ins in the 28-day regression window. */
  weighIns: number;
  /** 28-day least-squares slope, lb/week; null when there is too little data. */
  slopeLbWk: number | null;
  lastWeighIn: { date: string; weightLb: number } | null;
  /** Fitted current weight, else the last weigh-in, else null. */
  currentWeightLb: number | null;
  /** Projected goal date at the current trend, or null. */
  goalDateKey: string | null;
}

export interface WeeklyReportWireMilestone {
  /** Whole days since the first ever log (0 when unknown). */
  daysSinceFirstLog: number;
  currentStreak: number;
  totalLogs: number;
}

export interface WeeklyReportWireContext {
  profile: WireProfile | null;
  trueTdee: number;
  dailyTarget: number;
  tdeeSource: WireTdeeSource;
  /** Exactly {@link WEEKLY_REPORT_WINDOW_DAYS} days, oldest first. */
  days: WeeklyReportWireDay[];
  trend: WeeklyReportWireTrend;
  milestone: WeeklyReportWireMilestone | null;
}

export interface WeeklyReportRequest {
  v: typeof AI_PROMPT_WIRE_VERSION;
  locale: CoachLocale;
  context: WeeklyReportWireContext;
}

export const COACH_WINDOW_DAYS = 14;
export const WEEKLY_REPORT_WINDOW_DAYS = 14;
/** Same cap the server put on the free-text prompt before v2. */
export const COACH_QUESTION_MAX_CHARS = 2_000;
/** 14 days of meal rows. A heavy logger is ~10 a day; 500 is headroom, and
 *  the bound is what keeps the payload (and the prompt) finite. */
export const COACH_MAX_ROWS = 500;

// ─── Rendering ──────────────────────────────────────────────────────

/** 68 → "5'8\"" */
function formatHeight(totalInches: number): string {
  const ft = Math.floor(totalInches / 12);
  const inches = totalInches % 12;
  return `${ft}'${inches}"`;
}

/** One-line language instruction so the model answers in the UI's language.
 *  Kept in code (not translation JSON) so the prompt engineering stays where
 *  reviewers expect it. */
const LANG_SUFFIX: Record<CoachLocale, string> = {
  en: '\n\nRespond in English.',
  'es-PR':
    '\n\nRespond in Puerto Rican Spanish. Use informal "tú". Keep numeric formats (calories, grams, pounds) identical to the UI.',
  'pt-BR':
    '\n\nRespond in Brazilian Portuguese. Use informal "você". Keep numeric formats (calories, grams, pounds) identical to the UI.',
};

export function langSuffix(locale: CoachLocale): string {
  return LANG_SUFFIX[locale] ?? LANG_SUFFIX.en;
}

const PROTEIN_GUIDELINE =
  "Protein guideline: use 0.7–0.8 g per pound of bodyweight as the " +
  "evidence-based target for muscle preservation during a caloric deficit " +
  "(per ISSN position stand and recent meta-analyses). The old '1g/lb' rule " +
  "is the upper safety margin, not the clinical threshold. Only recommend " +
  "above 0.8g/lb for very lean or heavily resistance-trained individuals " +
  "in a steep deficit. " +
  "Never describe protein as 'critically low' if intake falls within 0.7–0.8 g/lb. " +
  "Reserve alarm language only for intake genuinely below 0.65 g/lb.";

const PROVISIONAL_NOTE =
  "If the TDEE source is 'formula' or 'seed', the estimate is PROVISIONAL — " +
  "say so when making strong claims. Measured mode (14+ days of real data) " +
  "is the only source that reflects the user's actual metabolism.";

function pushProfile(lines: string[], profile: WireProfile | null): void {
  if (!profile) return;
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

/**
 * The coach's grounded system instruction: grounding rules + profile +
 * computed values + the per-meal log table, then the language instruction.
 * A missing macro renders as "—" rather than a fabricated number.
 */
export function renderCoachSystemInstruction(ctx: CoachWireContext, locale: CoachLocale): string {
  const { rows } = ctx;
  const dayCount = new Set(rows.map((r) => r.date)).size;
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
  lines.push(PROVISIONAL_NOTE);
  lines.push('');
  lines.push(PROTEIN_GUIDELINE);
  lines.push('');

  pushProfile(lines, ctx.profile);

  lines.push('## Current computed values');
  lines.push(`- True TDEE: ${ctx.trueTdee} kcal/day`);
  lines.push(`- Daily target: ${ctx.dailyTarget} kcal/day`);
  lines.push(
    `- Recent weight trend: ${ctx.weightChangeTrend} lbs ` +
    "(positive = lost weight, negative = gained)",
  );
  lines.push(`- TDEE source: ${ctx.tdeeSource}`);
  // Days AND rows, both named: a row is a meal, not a day.
  lines.push(
    `- Logs available: ${dayCount} of the last ${COACH_WINDOW_DAYS} days ` +
    `(${rows.length} logged entries)`,
  );
  lines.push('');

  if (rows.length > 0) {
    lines.push('## Daily log (oldest → newest)');
    lines.push('| Date | Weight (lbs) | Calories | Protein (g) | Exercise |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const r of rows) {
      const pro = r.protein != null ? String(r.protein) : '—';
      const exercised = r.exercised ? '✓' : '—';
      const weightCell = r.weight != null ? String(r.weight) : '—';
      lines.push(`| ${r.date} | ${weightCell} | ${r.calories} | ${pro} | ${exercised} |`);
    }
  } else {
    lines.push('## Daily log');
    lines.push('_(no entries yet)_');
  }

  return lines.join('\n') + langSuffix(locale);
}

/**
 * The quiet-milestone fragment appended to the report prompt; '' when no
 * milestone is hit. Tone is deliberately calm — a dietician's nod, not a
 * cheerleader's shout.
 */
export function renderMilestone(m: WeeklyReportWireMilestone): string {
  const milestones: string[] = [];
  const daysLogged = m.daysSinceFirstLog;

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

  if (m.currentStreak >= 30 && m.currentStreak < 60) {
    milestones.push(`Current consecutive-day streak: ${m.currentStreak} days.`);
  } else if (m.currentStreak >= 100) {
    milestones.push(`Current consecutive-day streak: ${m.currentStreak} days (deep consistency territory).`);
  }

  if (m.totalLogs === 100) {
    milestones.push('100th meal logged this week.');
  } else if (m.totalLogs >= 500 && m.totalLogs < 510) {
    milestones.push(`${m.totalLogs} meals logged — five hundred data points of real intake.`);
  } else if (m.totalLogs >= 1000 && m.totalLogs < 1010) {
    milestones.push(`${m.totalLogs} meals logged — four-figure territory.`);
  }

  if (milestones.length === 0) return '';

  return [
    '',
    'Milestone context (do NOT celebrate loudly — tone must stay calm and dietician-like):',
    ...milestones.map((x) => `- ${x}`),
    '',
    'If any of these feels worth a brief acknowledgment, add ONE concise italicized line at the very end of the report (after the recommendation). Ground it in what the data means for the user\'s progress, not in the milestone itself. Skip the line entirely if the body of the report is already covering the same theme. No emojis. No exclamation points. One sentence, maximum.',
  ].join('\n');
}

function renderWeeklyInstruction(ctx: WeeklyReportWireContext): string {
  const { profile, days, trend } = ctx;
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
  lines.push(PROVISIONAL_NOTE);
  lines.push('');
  lines.push(PROTEIN_GUIDELINE);
  lines.push('');

  pushProfile(lines, profile);

  lines.push('## Current computed values');
  lines.push(`- True TDEE: ${ctx.trueTdee} kcal/day`);
  lines.push(`- Daily target: ${ctx.dailyTarget} kcal/day`);
  lines.push(`- TDEE source: ${ctx.tdeeSource}`);
  lines.push('');

  const loggedDays = days.filter((d) => d.meals > 0);
  const daysLoggedN = loggedDays.length;
  const avgKcal = daysLoggedN > 0
    ? Math.round(loggedDays.reduce((s, d) => s + d.calories, 0) / daysLoggedN)
    : 0;
  const avgProtein = daysLoggedN > 0
    ? Math.round(loggedDays.reduce((s, d) => s + d.protein, 0) / daysLoggedN)
    : 0;
  let minDay: WeeklyReportWireDay | null = null;
  let maxDay: WeeklyReportWireDay | null = null;
  for (const d of loggedDays) {
    if (!minDay || d.calories < minDay.calories) minDay = d;
    if (!maxDay || d.calories > maxDay.calories) maxDay = d;
  }
  const exerciseDays = days.filter((d) => d.exercised).length;
  const slopeLbWk = trend.slopeLbWk;
  const lastPt = trend.lastWeighIn;
  const currentWeightLb = trend.currentWeightLb;

  lines.push(`## 14-day summary (${days[0].date} → ${days[days.length - 1].date})`);
  lines.push(`- Days logged: ${daysLoggedN}/14`);
  lines.push(`- Avg kcal (on logged days): ${avgKcal}`);
  if (minDay && maxDay) {
    lines.push(`- Min daily kcal: ${minDay.calories} on ${minDay.date}`);
    lines.push(`- Max daily kcal: ${maxDay.calories} on ${maxDay.date}`);
  }
  lines.push(`- Avg protein (on logged days): ${avgProtein} g`);
  if (slopeLbWk != null) {
    const dir = slopeLbWk < -0.1 ? 'losing' : slopeLbWk > 0.1 ? 'gaining' : 'flat';
    lines.push(`- Weight trend (28-day regression): ${slopeLbWk >= 0 ? '+' : ''}${Math.round(slopeLbWk * 100) / 100} lb/week (${dir})`);
  } else {
    lines.push('- Weight trend (28-day regression): n/a (need ≥3 weigh-ins spanning ≥5 days)');
  }
  lines.push(`- Weigh-ins in 28-day window: ${trend.weighIns}`);
  if (lastPt) {
    lines.push(`- Most recent weigh-in: ${lastPt.weightLb} lb (${lastPt.date})`);
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
    if (trend.goalDateKey) {
      lines.push(`- Projected goal date at current trend: ${trend.goalDateKey}`);
    } else if (slopeLbWk != null && gap > 1) {
      lines.push('- Current trend is not moving toward the goal (flat or wrong direction).');
    }
  } else if (profile?.goalWeightLbs != null) {
    lines.push(`- Goal weight: ${profile.goalWeightLbs} lb`);
  }
  if (trend.weighIns < 8) {
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
    lines.push(`| ${d.date} | ${weightCell} | ${calCell} | ${proCell} | ${mealsCell} | ${exCell} |`);
  }

  return lines.join('\n');
}

/** The weekly report's `{ systemInstruction, prompt }`, every word server-side. */
export function renderWeeklyReport(
  ctx: WeeklyReportWireContext,
  locale: CoachLocale,
): { systemInstruction: string; prompt: string } {
  const systemInstruction = renderWeeklyInstruction(ctx) + langSuffix(locale);
  const milestoneLine = ctx.milestone ? renderMilestone(ctx.milestone) : '';
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

// ─── Validation (the server's half; the core tests round-trip it) ───

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

class WireError extends Error {}

function fail(path: string, why: string): never {
  throw new WireError(`${path}: ${why}`);
}

type Obj = Record<string, unknown>;

/** A plain object carrying exactly `keys` — an unknown key is rejected, so
 *  nothing rides along that the renderer might one day start printing. */
function obj(v: unknown, path: string, keys: readonly string[]): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'not an object');
  const o = v as Obj;
  for (const k of Object.keys(o)) if (!keys.includes(k)) fail(`${path}.${k}`, 'unknown field');
  return o;
}

function num(v: unknown, path: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'not a finite number');
  if (v < min || v > max) fail(path, `out of range [${min}, ${max}]`);
  return v;
}

function int(v: unknown, path: string, min: number, max: number): number {
  const n = num(v, path, min, max);
  if (!Number.isInteger(n)) fail(path, 'not an integer');
  return n;
}

function numOrNull(v: unknown, path: string, min: number, max: number): number | null {
  return v === null ? null : num(v, path, min, max);
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'not a boolean');
  return v;
}

function oneOf<T extends string>(v: unknown, path: string, allowed: readonly T[]): T {
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) fail(path, 'not an allowed value');
  return v as T;
}

const DATE_KEY = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function dateKey(v: unknown, path: string): string {
  if (typeof v !== 'string' || !DATE_KEY.test(v)) fail(path, 'not a YYYY-MM-DD date');
  return v;
}

function arr(v: unknown, path: string, minLen: number, maxLen: number): unknown[] {
  if (!Array.isArray(v)) fail(path, 'not an array');
  if (v.length < minLen || v.length > maxLen) fail(path, `length not in [${minLen}, ${maxLen}]`);
  return v;
}

// Bounds are generous on purpose — they exist to keep every field a plain
// number of bounded width, not to second-guess the user's data. They must
// admit EVERYTHING firestore.rules lets a user store, plus every sum and fit
// derived from it: a rejection here is not "one bad answer", it is every
// answer, for as long as the offending row sits in the window. Concretely
// (2026-10-15 review): rules take any weight in (0, 1000), so a typo'd "15"
// weigh-in is legal and LB_MIN was 20; a day is the SUM of its rows (each
// < 20,000 kcal / < 1,000 g protein, unbounded in count), so a day total can
// pass 50,000; and a least-squares fit of rules-legal weights can land well
// outside [0, 1000] and slope far past 1,500 lb/week.
const KCAL_MAX = 1_000_000;
const PROTEIN_MAX = 1_000_000;
const LB_MIN = 0;
const LB_MAX = 1_500;
/** Bound for derived weight figures (fitted weight, regression slope). */
const LB_DERIVED_MAX = 100_000;

function parseProfile(v: unknown, path: string): WireProfile | null {
  if (v === null) return null;
  const o = obj(v, path, ['heightIn', 'age', 'sex', 'activityLevel', 'targetPaceLbsPerWeek', 'goalWeightLbs']);
  return {
    heightIn: num(o['heightIn'], `${path}.heightIn`, 20, 120),
    age: num(o['age'], `${path}.age`, 1, 150),
    sex: oneOf(o['sex'], `${path}.sex`, SEXES),
    activityLevel: oneOf(o['activityLevel'], `${path}.activityLevel`, ACTIVITY_LEVELS),
    targetPaceLbsPerWeek: num(o['targetPaceLbsPerWeek'], `${path}.targetPaceLbsPerWeek`, -10, 10),
    goalWeightLbs: numOrNull(o['goalWeightLbs'], `${path}.goalWeightLbs`, LB_MIN, LB_MAX),
  };
}

function parseCoachContext(v: unknown): CoachWireContext {
  const o = obj(v, 'context', ['profile', 'trueTdee', 'dailyTarget', 'weightChangeTrend', 'tdeeSource', 'rows']);
  const rows = arr(o['rows'], 'context.rows', 0, COACH_MAX_ROWS).map((r, i) => {
    const p = `context.rows[${i}]`;
    const row = obj(r, p, ['date', 'weight', 'calories', 'protein', 'exercised']);
    return {
      date: dateKey(row['date'], `${p}.date`),
      weight: numOrNull(row['weight'], `${p}.weight`, LB_MIN, LB_MAX),
      calories: num(row['calories'], `${p}.calories`, -KCAL_MAX, KCAL_MAX),
      protein: numOrNull(row['protein'], `${p}.protein`, -PROTEIN_MAX, PROTEIN_MAX),
      exercised: bool(row['exercised'], `${p}.exercised`),
    };
  });
  return {
    profile: parseProfile(o['profile'], 'context.profile'),
    trueTdee: num(o['trueTdee'], 'context.trueTdee', -KCAL_MAX, KCAL_MAX),
    dailyTarget: num(o['dailyTarget'], 'context.dailyTarget', -KCAL_MAX, KCAL_MAX),
    weightChangeTrend: num(o['weightChangeTrend'], 'context.weightChangeTrend', -LB_DERIVED_MAX, LB_DERIVED_MAX),
    tdeeSource: oneOf(o['tdeeSource'], 'context.tdeeSource', TDEE_SOURCES),
    rows,
  };
}

function parseWeeklyContext(v: unknown): WeeklyReportWireContext {
  const o = obj(v, 'context', ['profile', 'trueTdee', 'dailyTarget', 'tdeeSource', 'days', 'trend', 'milestone']);
  const days = arr(o['days'], 'context.days', WEEKLY_REPORT_WINDOW_DAYS, WEEKLY_REPORT_WINDOW_DAYS).map((d, i) => {
    const p = `context.days[${i}]`;
    const day = obj(d, p, ['date', 'weight', 'calories', 'protein', 'meals', 'exercised']);
    return {
      date: dateKey(day['date'], `${p}.date`),
      weight: numOrNull(day['weight'], `${p}.weight`, LB_MIN, LB_MAX),
      calories: num(day['calories'], `${p}.calories`, -KCAL_MAX, KCAL_MAX),
      protein: num(day['protein'], `${p}.protein`, -PROTEIN_MAX, PROTEIN_MAX),
      meals: int(day['meals'], `${p}.meals`, 0, 100_000),
      exercised: bool(day['exercised'], `${p}.exercised`),
    };
  });
  const t = obj(o['trend'], 'context.trend', ['weighIns', 'slopeLbWk', 'lastWeighIn', 'currentWeightLb', 'goalDateKey']);
  let lastWeighIn: WeeklyReportWireTrend['lastWeighIn'] = null;
  if (t['lastWeighIn'] !== null) {
    const lw = obj(t['lastWeighIn'], 'context.trend.lastWeighIn', ['date', 'weightLb']);
    lastWeighIn = {
      date: dateKey(lw['date'], 'context.trend.lastWeighIn.date'),
      weightLb: num(lw['weightLb'], 'context.trend.lastWeighIn.weightLb', LB_MIN, LB_MAX),
    };
  }
  const trend: WeeklyReportWireTrend = {
    weighIns: int(t['weighIns'], 'context.trend.weighIns', 0, 28),
    slopeLbWk: numOrNull(t['slopeLbWk'], 'context.trend.slopeLbWk', -LB_DERIVED_MAX, LB_DERIVED_MAX),
    lastWeighIn,
    currentWeightLb: numOrNull(t['currentWeightLb'], 'context.trend.currentWeightLb', -LB_DERIVED_MAX, LB_DERIVED_MAX),
    goalDateKey: t['goalDateKey'] === null ? null : dateKey(t['goalDateKey'], 'context.trend.goalDateKey'),
  };
  let milestone: WeeklyReportWireMilestone | null = null;
  if (o['milestone'] !== null) {
    const m = obj(o['milestone'], 'context.milestone', ['daysSinceFirstLog', 'currentStreak', 'totalLogs']);
    milestone = {
      daysSinceFirstLog: int(m['daysSinceFirstLog'], 'context.milestone.daysSinceFirstLog', 0, 100_000),
      currentStreak: int(m['currentStreak'], 'context.milestone.currentStreak', 0, 100_000),
      totalLogs: int(m['totalLogs'], 'context.milestone.totalLogs', 0, 100_000_000),
    };
  }
  return {
    profile: parseProfile(o['profile'], 'context.profile'),
    trueTdee: num(o['trueTdee'], 'context.trueTdee', -KCAL_MAX, KCAL_MAX),
    dailyTarget: num(o['dailyTarget'], 'context.dailyTarget', -KCAL_MAX, KCAL_MAX),
    tdeeSource: oneOf(o['tdeeSource'], 'context.tdeeSource', TDEE_SOURCES),
    days,
    trend,
    milestone,
  };
}

function guard<T>(run: () => T): ParseResult<T> {
  try {
    return { ok: true, value: run() };
  } catch (err) {
    if (err instanceof WireError) return { ok: false, error: err.message };
    throw err;
  }
}

/** Validate a v2 coach request field by field. Rejects unknown fields. */
export function parseCoachRequest(raw: unknown): ParseResult<CoachRequest> {
  return guard(() => {
    const o = obj(raw, 'body', ['v', 'locale', 'question', 'context']);
    if (o['v'] !== AI_PROMPT_WIRE_VERSION) fail('body.v', `must be ${AI_PROMPT_WIRE_VERSION}`);
    const q = o['question'];
    if (typeof q !== 'string' || q.trim().length === 0) fail('body.question', 'missing');
    if (q.length > COACH_QUESTION_MAX_CHARS) fail('body.question', 'too long');
    return {
      v: AI_PROMPT_WIRE_VERSION,
      locale: oneOf(o['locale'], 'body.locale', LOCALES),
      question: q,
      context: parseCoachContext(o['context']),
    };
  });
}

/** Validate a v2 weekly-report request field by field. Rejects unknown fields. */
export function parseWeeklyReportRequest(raw: unknown): ParseResult<WeeklyReportRequest> {
  return guard(() => {
    const o = obj(raw, 'body', ['v', 'locale', 'context']);
    if (o['v'] !== AI_PROMPT_WIRE_VERSION) fail('body.v', `must be ${AI_PROMPT_WIRE_VERSION}`);
    return {
      v: AI_PROMPT_WIRE_VERSION,
      locale: oneOf(o['locale'], 'body.locale', LOCALES),
      context: parseWeeklyContext(o['context']),
    };
  });
}

/** The pre-v2 `{ systemInstruction, prompt }` shape, recognised by either
 *  key so a half-legacy body is not mistaken for a malformed v2 one. */
export function isLegacyPromptShape(raw: unknown): boolean {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false;
  return 'systemInstruction' in raw || 'prompt' in raw;
}
