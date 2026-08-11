import type { ActivityLevel, DailyLog, ProfileFields } from './types';
import { localDateKey } from './date';

/**
 * TDEE (Total Daily Energy Expenditure) estimator — pure port of the
 * Angular `TdeeCalculatorService` algorithm, shared with the Expo app.
 *
 * Modes:
 *   - MEASURED (≥14 logged days): data-driven. Backs TDEE out of the
 *     observed weight trend (OLS slope) + observed average intake.
 *   - FORMULA (<14 days + profile): Mifflin-St Jeor BMR × activity factor.
 *   - SEED (<14 days + no profile): hardcoded fallback.
 *
 * `newDailyTarget` = trueTdee − (pace × 3500 / 7), clamped at the user's
 * configured `calorieFloor` (default MIN_DAILY_TARGET = 1500).
 *
 * Both frontends import THIS module — the Angular app has no TDEE service of
 * its own, whatever older comments claimed — so a change here lands on web and
 * mobile alike.
 */
export interface TdeeResult {
  trueTdee: number;
  newDailyTarget: number;
  weightChangeTrend: number;
  source: 'measured' | 'formula' | 'seed';
  loggingCompletenessPct?: number;
  /** Logged days the measured estimate was built from (≤ 28), and the calendar
   *  span they were spread across. Reported so a UI can say "28 of 49 days"
   *  rather than "57%" — the counts are what tell a user that three weeks of
   *  eating are missing from the number. Measured mode only. */
  windowDays?: number;
  spanDays?: number;
  reliable?: boolean;
  /** Weigh-ins discarded as implausible before fitting the trend. Non-zero
   *  means the user has a bad entry worth surfacing to them. */
  outliersDropped?: number;
}

const KCAL_PER_POUND = 3500;
const MIN_DAILY_TARGET = 1500;
const DEFAULT_PACE_LBS_PER_WEEK = 1.0;
const MEASURED_MIN_DAYS = 14;
const MEASURED_WINDOW_DAYS = 28;
const RELIABLE_MIN_PCT = 70;
const RELIABLE_MIN_INTAKE_DAYS = 10;

const SEED_RESULT: TdeeResult = {
  trueTdee: 2450,
  newDailyTarget: 1800,
  weightChangeTrend: 0,
  source: 'seed',
};

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, v) => a + v, 0) / values.length;
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

/** Mean after removing the single lowest and highest value. */
function trimmedMean(arr: number[]): number {
  if (arr.length < 3) return average(arr);
  const sorted = [...arr].sort((a, b) => a - b);
  return average(sorted.slice(1, sorted.length - 1));
}

/** Aggregate multiple log entries per day into one row per day. */
export function aggregateByDay(logs: DailyLog[]): DailyLog[] {
  const byDate = new Map<string, DailyLog>();
  for (const log of logs) {
    const key = localDateKey(log.date);
    const existing = byDate.get(key);
    if (!existing) {
      byDate.set(key, { ...log });
    } else {
      existing.calories += log.calories;
      existing.protein = (existing.protein ?? 0) + (log.protein ?? 0);
      if (existing.weight == null && log.weight != null) existing.weight = log.weight;
      if (log.exerciseCompleted) existing.exerciseCompleted = true;
      if (log.liftCompleted) existing.liftCompleted = true;
      if (log.cardioCompleted) existing.cardioCompleted = true;
    }
  }
  return [...byDate.values()].sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Ordinary least-squares slope through the given points. */
function regressionSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXX = 0, sumXY = 0;
  for (const { x, y } of points) {
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return null;
  return (n * sumXY - sumX * sumY) / denom;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Theil–Sen slope: the median of the slopes between every pair of points.
 * Unlike least squares it cannot be dragged by a single bad value, which is
 * exactly what we need to *identify* bad values before fitting properly.
 * O(n²), but n is capped at MEASURED_WINDOW_DAYS, so ~380 pairs at worst.
 */
function theilSenSlope(points: { x: number; y: number }[]): number | null {
  const slopes: number[] = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[j].x - points[i].x;
      if (dx !== 0) slopes.push((points[j].y - points[i].y) / dx);
    }
  }
  return slopes.length ? median(slopes) : null;
}

/** Minimum residual, in lb, before a weigh-in can be called an outlier.
 *  Day-to-day water and food weight moves a real person by a pound or two;
 *  without this floor, a very consistent logger's tiny MAD would make normal
 *  fluctuation look anomalous. */
const OUTLIER_FLOOR_LB = 3;
/** Residual cutoff as a multiple of the robust spread (MAD → σ via 1.4826). */
const OUTLIER_SIGMAS = 4;
/** Below this many weigh-ins the spread cannot be estimated, so nothing is
 *  dropped — with 3 points a "majority" is meaningless. */
const OUTLIER_MIN_POINTS = 5;

/** A break in weigh-ins at least this long ends the current trend segment.
 *  Seven days because that is the shortest absence that reliably means a
 *  changed regime rather than a skipped morning — a long weekend fits inside
 *  it, a trip does not. */
const TREND_GAP_DAYS = 7;
/**
 * Days at the start of a post-break segment that do not count toward the
 * trend.
 *
 * Segmenting alone is not enough, and the measurement is unambiguous. Against
 * the research's rebound scenario — flat 180, a break, back at 184, the water
 * off over the following week, true burn 2,500 the whole time — the estimate
 * moves like this:
 *
 *   whole-window fit (before):  2,392   (−108)
 *   segmented, no settle:       3,469   (+969)   ← worse, and in the direction
 *   segmented + settle:         2,500   (exact)     that raises the target
 *
 * The step case is fixed by segmenting alone (2,038 → 2,500). The rebound is
 * not: travel weight is glycogen and sodium, it leaves over about a week, and
 * inside a fresh 14-day segment that fall is the loudest thing in the data —
 * where the old fit at least had the pre-break plateau damping it. Reading it
 * as fat loss inflates maintenance by ~950 kcal/day, which raises the target
 * rather than lowering it.
 *
 * Seven days because that is how long the shift takes to clear, and because
 * the alternative — trusting it — is the more expensive mistake.
 */
const POST_BREAK_SETTLE_DAYS = 7;
/** A post-break segment is only trusted to carry the trend on its own once it
 *  has this many weigh-ins LEFT after the settle window. Below it, the fit
 *  would be a line through two or three points dominated by water, which is a
 *  worse answer than the biased one — so the old whole-window behaviour stands
 *  until the user has weighed in enough times since coming back. */
const MIN_SEGMENT_POINTS = 4;

/**
 * Split weigh-in points wherever the user stopped weighing for a week or more,
 * and return the most recent run.
 *
 * ## Why a break has to be a boundary rather than data
 *
 * A two-week gap does not produce noise, it produces a STEP: flat at 180,
 * absent, then flat at 184. Fitted as one series against a 28-day window that
 * is mostly the old plateau, every post-break reading sits far from the line —
 * so the robust guard classifies all seven of them as outliers and throws away
 * every observation of a real 4 lb change, while the result still reports
 * itself reliable. Measured on this function; see
 * `docs/research/tdee-logging-gaps.md` §1a.
 *
 * The same fit also punishes the user for travel water leaving: a rebound over
 * the following week reads as a fall, a fall reads as a deficit, and
 * maintenance drops 155 kcal (§1b).
 *
 * Widening the outlier guard would fix both and break the thing it exists for
 * — one stray 158 lb entry moving a real account's maintenance from 2,741 to
 * 1,619. Segmenting keeps the guard narrow and simply stops asking it to
 * explain a discontinuity it cannot see.
 */
function lastTrendSegment<T extends { x: number }>(points: T[]): T[] {
  let start = 0;
  let broke = false;
  for (let i = 1; i < points.length; i++) {
    if (points[i].x - points[i - 1].x >= TREND_GAP_DAYS) {
      start = i;
      broke = true;
    }
  }
  const segment = points.slice(start);
  if (!broke || segment.length === 0) return segment;
  // Let the water settle before believing anything the scale says.
  const settledFrom = segment[0].x + POST_BREAK_SETTLE_DAYS;
  return segment.filter((p) => p.x >= settledFrom);
}

/**
 * Weight trend in lbs/day, robust to a bad weigh-in.
 *
 * Plain least squares treats every point as equally trustworthy, so ONE
 * mistyped or mis-synced entry rewrites the trend — and because measured TDEE
 * is `intake + slope × 3500`, a 20 lb error moves maintenance by roughly 1,100
 * kcal/day and can invert the sign of the deficit. That is not hypothetical:
 * a stray 158 lb reading against a 178–182 lb history took a real account's
 * maintenance from 2,741 to 1,619 kcal and pinned the target to the floor.
 *
 * So: fit a Theil–Sen line first (immune to the outlier that is skewing
 * things), measure each point's distance from it, drop anything absurdly far
 * out, then run the original least-squares fit on what survives. Clean data
 * loses no points and gets the exact slope it always did — this only
 * intervenes when something is genuinely wrong.
 *
 * Deliberately NOT a smoother: the goal is to ignore bad data, not to blunt
 * real change. Someone who truly drops 4 lb in a week still reads as dropping
 * 4 lb in a week.
 */
function weightTrendLbsPerDay(daily: DailyLog[]): { slope: number; dropped: number } | null {
  const weighed = daily.filter((l): l is DailyLog & { weight: number } => l.weight != null);
  if (weighed.length < 2) return null;
  const t0 = weighed[0].date.getTime();
  const allPoints = weighed.map((l) => ({
    x: (l.date.getTime() - t0) / 86_400_000,
    y: l.weight,
  }));

  // Fit only what has happened since the last break in weighing — but only
  // once that run can carry a fit on its own. The fallback is deliberately the
  // old behaviour rather than `null`: returning null here would send
  // `calculateTdee` to the hardcoded 2,450 seed, replacing a biased estimate
  // built from the user's own data with one built from nobody's.
  const segment = lastTrendSegment(allPoints);
  const points = segment.length >= MIN_SEGMENT_POINTS ? segment : allPoints;

  if (points.length < OUTLIER_MIN_POINTS) {
    const slope = regressionSlope(points);
    return slope == null ? null : { slope, dropped: 0 };
  }

  const robustSlope = theilSenSlope(points);
  if (robustSlope == null) {
    const slope = regressionSlope(points);
    return slope == null ? null : { slope, dropped: 0 };
  }
  // Intercept that puts the robust line through the middle of the data.
  const robustIntercept = median(points.map((p) => p.y - robustSlope * p.x));

  const residuals = points.map((p) => p.y - (robustIntercept + robustSlope * p.x));
  const mad = median(residuals.map((r) => Math.abs(r)));
  const cutoff = Math.max(OUTLIER_SIGMAS * 1.4826 * mad, OUTLIER_FLOOR_LB);

  const kept = points.filter((_, i) => Math.abs(residuals[i]) <= cutoff);
  const dropped = points.length - kept.length;

  // Refuse to discard most of the data: if that many points are "outliers",
  // the trend is the anomaly, not the points.
  if (kept.length < 2 || dropped > points.length / 3) {
    const slope = regressionSlope(points);
    return slope == null ? null : { slope, dropped: 0 };
  }

  const slope = regressionSlope(kept);
  return slope == null ? null : { slope, dropped };
}

function calendarSpanDays(daily: DailyLog[]): number {
  if (daily.length === 0) return 1;
  const first = daily[0].date.getTime();
  const last = daily[daily.length - 1].date.getTime();
  return Math.round((last - first) / 86_400_000) + 1;
}

/** The daily-target safety floor: the user's configured `calorieFloor` when
 *  set to a sane positive value, else the hardcoded MIN_DAILY_TARGET. Keeps a
 *  water-suppressed measured TDEE from silently pushing the target below a
 *  level the user has deemed too aggressive.
 *
 *  Exported because the floor has to hold on branches that never reach this
 *  module's arithmetic — the manual heuristic and the seed fallback both
 *  produce targets in `targets.ts`, and duplicating this rule there is how the
 *  two drift. Takes a structural type, not `ProfileFields`, so the full
 *  `Profile` can be passed on paths where onboarding is incomplete and
 *  `toProfileFields` has already returned null. */
export function calorieFloor(profile?: { calorieFloor?: number } | null): number {
  const f = profile?.calorieFloor;
  return f != null && f > 0 ? f : MIN_DAILY_TARGET;
}

/**
 * Bare Mifflin-St Jeor BMR — NO activity factor. Deliberately takes only
 * height/age/sex/weight so callers that have no activity bucket yet (Refine
 * Targets pre-fill, the activity-level correction's basal) can use it.
 * `mifflinStJeor` = this × ACTIVITY_MULTIPLIERS[bucket].
 */
export function basalMifflinStJeor(
  profile: { heightIn: number; age: number; sex: 'male' | 'female' },
  weightLbs: number,
): number {
  const weightKg = weightLbs * 0.453592;
  const heightCm = profile.heightIn * 2.54;
  return profile.sex === 'male'
    ? 10 * weightKg + 6.25 * heightCm - 5 * profile.age + 5
    : 10 * weightKg + 6.25 * heightCm - 5 * profile.age - 161;
}

function mifflinStJeor(profile: ProfileFields, weightLbs: number): number {
  return basalMifflinStJeor(profile, weightLbs) * ACTIVITY_MULTIPLIERS[profile.activityLevel];
}

export function calculateTdee(logs: DailyLog[], profile?: ProfileFields | null): TdeeResult {
  const daily = aggregateByDay(logs ?? []);

  // ── Measured mode: ≥14 logged days ──
  if (daily.length >= MEASURED_MIN_DAYS) {
    const window = daily.slice(-MEASURED_WINDOW_DAYS);
    const trend = weightTrendLbsPerDay(window);
    if (trend == null) return { ...SEED_RESULT };
    const { slope, dropped: outliersDropped } = trend;

    const intakeCals = window.map((l) => l.calories).filter((c) => c > 0);
    if (intakeCals.length === 0) return { ...SEED_RESULT };
    const avgDailyIntake = trimmedMean(intakeCals);

    const dailyDeficitAchieved = -slope * KCAL_PER_POUND;
    const trueTdee = Math.round(avgDailyIntake + dailyDeficitAchieved);

    const pace = profile?.targetPaceLbsPerWeek ?? DEFAULT_PACE_LBS_PER_WEEK;
    const targetDeficit = (pace * KCAL_PER_POUND) / 7;
    const floor = calorieFloor(profile);
    const newDailyTarget = Math.max(floor, Math.round(trueTdee - targetDeficit));

    const spanDays = calendarSpanDays(window);
    const loggingCompletenessPct = Math.min(100, Math.round((window.length / spanDays) * 100));
    const reliable =
      loggingCompletenessPct >= RELIABLE_MIN_PCT && intakeCals.length >= RELIABLE_MIN_INTAKE_DAYS;

    return {
      trueTdee,
      newDailyTarget,
      weightChangeTrend: round(-slope * (spanDays - 1), 2),
      source: 'measured',
      loggingCompletenessPct,
      windowDays: window.length,
      spanDays,
      reliable,
      outliersDropped,
    };
  }

  // ── Formula mode: profile present, <14 days ──
  if (profile) {
    let latestWeight = profile.goalWeightLbs ?? 180;
    for (let i = daily.length - 1; i >= 0; i--) {
      if (daily[i].weight != null) { latestWeight = daily[i].weight!; break; }
    }
    const trueTdee = Math.round(mifflinStJeor(profile, latestWeight));
    const pace = profile.targetPaceLbsPerWeek;
    const targetDeficit = (pace * KCAL_PER_POUND) / 7;
    const floor = calorieFloor(profile);
    const newDailyTarget = Math.max(floor, Math.round(trueTdee - targetDeficit));
    return { trueTdee, newDailyTarget, weightChangeTrend: 0, source: 'formula' };
  }

  // ── Seed fallback ──
  return { ...SEED_RESULT };
}
