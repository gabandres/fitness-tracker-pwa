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

  // ── Diagnostics. Measured mode only; never inputs to anything. ──
  /**
   * `trueTdee` BEFORE confidence damping — the raw `avgDailyIntake +
   * dailyDeficitAchieved`. Equal to `trueTdee` whenever {@link confidence} is
   * 1, which is every reliable account.
   *
   * Exported so the two corrections stay separable when reading a regression:
   * if the blend in `weightTrendLbsPerDay` is doing its job, this number is
   * already stable and damping has little left to do. A large gap between this
   * and `trueTdee` is a signal that the blend did NOT flatten the input.
   */
  measuredTdee?: number;
  /** 0..1 weight given to the measured estimate against the formula anchor.
   *  See {@link measuredConfidence}. 1 ⇒ nothing was damped. */
  confidence?: number;
  /** Trimmed mean of intake across the LOGGED days in the window. Unlogged
   *  days are excluded, not imputed — the single largest bias in the estimate,
   *  and the reason `loggingCompletenessPct` is worth showing a user. */
  avgDailyIntake?: number;
  /** The fitted trend actually used, after segment/window blending and the
   *  physical clamp. Negative = losing weight. */
  weightSlopeLbsPerDay?: number;
  /** `−slope × 3500`. The kcal/day the scale says was actually run. */
  dailyDeficitAchieved?: number;
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
 * A post-break segment must also SPAN this many days before it is trusted on
 * its own.
 *
 * ## The bug this fixes, measured on a real account 2026-08-14
 *
 * Counting points was not enough, because four *consecutive daily* weigh-ins
 * span three days, and a three-day span cannot express a weekly rate — it can
 * only express what the scale did overnight.
 *
 * A real account stopped weighing 07-11 → 08-04. Segmenting plus the settle
 * window left a run starting 08-11. With three points it fell back to the
 * 25-point whole-window fit: **−0.0044 lb/day, maintenance 1,889**. Logging one
 * more day pulled in a fourth weigh-in, `MIN_SEGMENT_POINTS` was met exactly,
 * and the fit switched to a line through 159.6 / 158.2 / 158 / 158 —
 * **−0.50 lb/day, an implied deficit of 1,750 kcal/day, maintenance 3,596, and
 * a recommended target of 3,146.**
 *
 * One logged meal moved maintenance by 1,700 kcal. That is not an estimate
 * updating, it is a **discontinuity**: the answer depended on which side of a
 * threshold the point count landed, and the two sides disagreed by more than
 * the quantity being estimated.
 *
 * The 4-point fit was dominated by a single 1.4 lb overnight drop — water, by
 * every argument this file already makes about water. `MIN_SEGMENT_POINTS`'
 * own comment warns that "a line through two or three points dominated by
 * water is a worse answer than the biased one"; four points three days apart is
 * the same object with one more point on it.
 *
 * ## The unit is a full calendar week, so the value is 6
 *
 * `x` is a day offset, so a run covering seven distinct days — Monday through
 * Sunday — has a span of 6. That is the threshold: **the post-settle run must
 * cover at least a full week.** The account above covered 08-11 → 08-14, four
 * days, span 3.
 *
 * Fourteen was tried first and it **broke the design that shipped on
 * 2026-08-11**. The step and rebound scenarios segmentation exists for run 14
 * days past the break, and `POST_BREAK_SETTLE_DAYS` eats the first seven, so
 * what remains spans exactly 6 — one week. A 14-day floor silently reverted
 * both to the whole-window fit they were built to replace (2,500 → 2,392),
 * which is precisely the regression their tests pin. Those tests are the reason
 * this number is 6 and not a rounder-looking one.
 *
 * A week is already this file's unit for "long enough that water is no longer
 * the loudest thing in the data" — it is `TREND_GAP_DAYS` and
 * `POST_BREAK_SETTLE_DAYS` both. This is the same judgement applied to the run
 * that survives them.
 *
 * It is not a generous margin, which is why `MAX_TREND_LBS_PER_DAY` is a second
 * and independent guard rather than belt-and-braces.
 */
const MIN_SEGMENT_SPAN_DAYS = 6;

/**
 * The largest weight change this function will attribute to energy balance.
 *
 * A second, independent guard, and deliberately not a tight one: 2 lb/week is
 * far above what anyone sustains as fat, so this never touches a real trend —
 * it exists so that **no** fit, segmented or whole-window, robust or fallback,
 * can hand `calculateTdee` a deficit that is not physically possible. The
 * account above implied 1,750 kcal/day off a three-day span; a 158 lb person
 * does not run that.
 *
 * Clamping the slope is honest about what is being claimed. It does not assert
 * the scale did not move — it asserts that a move that fast is not evidence
 * about maintenance, which is exactly the distinction water/glycogen forces
 * everywhere else in this file.
 */
const MAX_TREND_LBS_PER_DAY = 2 / 7;

/**
 * The floor of the segment-trust ramp: a post-break run this short contributes
 * nothing, and trust climbs from here to {@link MIN_SEGMENT_POINTS} /
 * {@link MIN_SEGMENT_SPAN_DAYS}, where it reaches 1 and stays there.
 *
 * Two points is where a line stops existing, and a zero-day span is where a
 * rate stops existing. Those are the honest bottoms of each ramp.
 */
const SEGMENT_MIN_POINTS_FOR_ANY_TRUST = 2;
const SEGMENT_MIN_SPAN_FOR_ANY_TRUST = 0;

/**
 * How far a thin measured estimate is pulled toward the formula estimate.
 *
 * ## `reliable` was computed and then ignored
 *
 * `calculateTdee` has always known when its own answer was weak — it returns
 * `reliable: false` below {@link RELIABLE_MIN_PCT} logging completeness or
 * {@link RELIABLE_MIN_INTAKE_DAYS} intake days. Nothing consumed it except the
 * UI and `targets.ts`'s measured-vs-manual choice. The target itself was
 * computed from the weak number at full strength and shipped.
 *
 * Measured on a real account 2026-08-19: 28 logged days across a 49-day span —
 * 57% complete, 21 days missing — produced a target the app simultaneously
 * described as "unlogged days pull this down".
 *
 * ## The anchor is the formula estimate, deliberately
 *
 * When confidence is short the measured value is blended toward Mifflin-St
 * Jeor × activity. That is not a new concept: it is the number this same
 * function already returns when there are fewer than {@link MEASURED_MIN_DAYS}
 * logged days. Extending it to "enough days, but full of holes" makes the mode
 * boundary a ramp instead of a second cliff.
 *
 * It is deliberately NOT the user's previous target. That would make the
 * estimator path-dependent — damping toward whatever it last printed, so a bad
 * number persists and the answer depends on when the app was opened — and it
 * would need a stored field, a rules deploy and a write path on both platforms
 * for a value the estimator can already derive.
 *
 * It is also NOT a smoother over the weight series. That was benchmarked and
 * came out ~130 kcal low; this touches the weight series not at all.
 *
 * **`reliable === true` ⟹ `confidence === 1` ⟹ byte-identical output**, because
 * both ratios below are ≥ 1 exactly when `reliable`'s two conditions hold. No
 * account with complete data sees any change from this.
 */
function measuredConfidence(loggingCompletenessPct: number, intakeDays: number): number {
  const byCompleteness = clamp01(loggingCompletenessPct / RELIABLE_MIN_PCT);
  const byIntakeDays = clamp01(intakeDays / RELIABLE_MIN_INTAKE_DAYS);
  return Math.min(byCompleteness, byIntakeDays);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

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
/**
 * The Theil–Sen → MAD-drop → OLS pipeline over one set of points.
 *
 * Extracted verbatim from `weightTrendLbsPerDay` so the segment fit and the
 * whole-window fit can each be computed independently and then blended. The
 * arithmetic is unchanged; only the clamp moved out, because clamping each
 * input before averaging them is not the same as clamping the result, and it
 * is the RESULT that has to be physically possible.
 */
interface Fit {
  slope: number;
  dropped: number;
}

function robustSlopeOf(points: { x: number; y: number }[]): Fit | null {
  const plain = (): Fit | null => {
    const s = regressionSlope(points);
    return s == null ? null : { slope: s, dropped: 0 };
  };

  if (points.length < OUTLIER_MIN_POINTS) return plain();

  const robustSlope = theilSenSlope(points);
  if (robustSlope == null) return plain();

  // Intercept that puts the robust line through the middle of the data.
  const robustIntercept = median(points.map((p) => p.y - robustSlope * p.x));

  const residuals = points.map((p) => p.y - (robustIntercept + robustSlope * p.x));
  const mad = median(residuals.map((r) => Math.abs(r)));
  const cutoff = Math.max(OUTLIER_SIGMAS * 1.4826 * mad, OUTLIER_FLOOR_LB);

  const kept = points.filter((_, i) => Math.abs(residuals[i]) <= cutoff);
  const dropped = points.length - kept.length;

  // Refuse to discard most of the data: if that many points are "outliers",
  // the trend is the anomaly, not the points.
  if (kept.length < 2 || dropped > points.length / 3) return plain();

  const s = regressionSlope(kept);
  return s == null ? null : { slope: s, dropped };
}

/**
 * The most recent weigh-in may CONFIRM a trend. It may not create one.
 *
 * ## The measurement this exists for
 *
 * Measured 2026-08-19 on a live account. Its post-break segment was 9 weigh-ins
 * over 8 days, comfortably past every trust threshold, and the segment was
 * selected at every step — nothing switched. Removing only the most recent
 * reading moved the fitted slope like this:
 *
 *   weigh-ins        OLS slope   implied deficit
 *   9 (all)          −0.2100     735 kcal/day
 *   8 (drop newest)  −0.0714     250 kcal/day
 *
 * One reading — 156.0 lb the morning after 158.0, a 2 lb overnight drop, which
 * is water by every argument in this file — was worth **485 kcal/day of
 * maintenance and 287 kcal of daily target**. It sits at the far end of the
 * baseline, which is exactly where a least-squares fit gives a point the most
 * leverage it will ever have.
 *
 * Theil–Sen on the same segment cuts that to 234 kcal, measured. Better, and
 * still far too much to hand a user as their day's food.
 *
 * ## The rule
 *
 * Fit twice — with the newest point and without it — and report whichever
 * implies the SMALLER rate of change.
 *
 * It is deliberately asymmetric. A new reading is adopted immediately when it
 * flattens the trend, and has to wait for corroboration when it steepens one.
 * That asymmetry is this file's existing bias, made explicit: an inflated
 * maintenance raises the target, and `POST_BREAK_SETTLE_DAYS` already records
 * that "the +969 version is the dangerous one — it raises the target".
 *
 * It does not blunt real change, which is the property `weightTrendLbsPerDay`
 * promises. A genuine 4 lb week is present in the fit with or without its last
 * morning, so both fits agree and the rule is inert. Only a rate that exists
 * *because* of the newest point is held back, and only until the next weigh-in
 * seconds it — at which point it is no longer the newest point.
 *
 * Below three points there is nothing to corroborate against, so the fit
 * stands as-is.
 */
function corroboratedSlope(points: { x: number; y: number }[]): Fit | null {
  const full = robustSlopeOf(points);
  if (full == null || points.length < 3) return full;

  const withoutNewest = robustSlopeOf(points.slice(0, -1));
  if (withoutNewest == null) return full;

  return Math.abs(withoutNewest.slope) < Math.abs(full.slope)
    ? { slope: withoutNewest.slope, dropped: full.dropped }
    : full;
}

/**
 * How much the post-break segment is trusted, 0..1.
 *
 * The ramp climbs UP TO the existing thresholds and is 1 at and above them.
 * That direction is the whole design, and getting it backwards was a real
 * mistake made while writing this: a ramp that starts climbing AT
 * {@link MIN_SEGMENT_SPAN_DAYS} gives zero weight to a segment spanning exactly
 * that, and the step and rebound scenarios in `tdee.test.ts` span exactly that
 * — {@link POST_BREAK_SETTLE_DAYS} eats the first seven of their fourteen days.
 * It silently reverted both to the whole-window fit they exist to replace
 * (2,500 → 2,073 and 2,409), which is the precise regression their tests pin.
 *
 * Ramping up to the thresholds instead means:
 *   - at or above them, `w = 1` — byte-identical to the old `if` branch, so
 *     every scenario the thresholds were tuned against is untouched;
 *   - below them, partial credit instead of a hard zero, which is what removes
 *     the cliff. The 2026-08-14 incident in `MIN_SEGMENT_SPAN_DAYS` went from
 *     `w = 0` to `w = 1` on one logged meal; it now moves 0.33 → 0.5.
 *
 * `min` of the two ramps, not an average: span and count must both be earned.
 * Four weigh-ins spread over a month is as weak a line as twelve crammed into
 * three days, and averaging would let a high count buy a short span — which is
 * the exact substitution `MIN_SEGMENT_SPAN_DAYS` was added to forbid.
 */
function segmentTrust(pointCount: number, spanDays: number): number {
  const bySpan = clamp01(
    (spanDays - SEGMENT_MIN_SPAN_FOR_ANY_TRUST) /
      (MIN_SEGMENT_SPAN_DAYS - SEGMENT_MIN_SPAN_FOR_ANY_TRUST),
  );
  const byCount = clamp01(
    (pointCount - SEGMENT_MIN_POINTS_FOR_ANY_TRUST) /
      (MIN_SEGMENT_POINTS - SEGMENT_MIN_POINTS_FOR_ANY_TRUST),
  );
  return Math.min(bySpan, byCount);
}

function weightTrendLbsPerDay(daily: DailyLog[]): { slope: number; dropped: number } | null {
  const weighed = daily.filter((l): l is DailyLog & { weight: number } => l.weight != null);
  if (weighed.length < 2) return null;
  const t0 = weighed[0].date.getTime();
  const allPoints = weighed.map((l) => ({
    x: (l.date.getTime() - t0) / 86_400_000,
    y: l.weight,
  }));

  /** Every return goes through here, so the clamp cannot be forgotten on one of
   *  the fallback paths below — which is exactly how a guard like this normally
   *  rots. It is applied to the BLENDED slope, so no combination of fits can
   *  produce a rate that is not physically possible. */
  const finish = (slope: number | null, dropped: number) =>
    slope == null
      ? null
      : {
          slope: Math.max(-MAX_TREND_LBS_PER_DAY, Math.min(MAX_TREND_LBS_PER_DAY, slope)),
          dropped,
        };

  /*
   * Weigh what has happened since the last break in weighing — but WEIGH it,
   * rather than switching to it.
   *
   * ## What the old code did, and the two separate defects in it
   *
   * `MIN_SEGMENT_POINTS` and `MIN_SEGMENT_SPAN_DAYS` selected between two
   * fits: below them the whole window, at or above them the segment alone.
   *
   * **Defect one is the switch itself.** Two estimates that disagree by more
   * than the quantity being estimated, chosen between by a threshold, give an
   * answer that depends on which side of the threshold the data landed.
   * `MIN_SEGMENT_SPAN_DAYS`' comment records exactly that: one logged meal
   * pulled in a fourth weigh-in and maintenance moved 1,700 kcal. Raising the
   * thresholds relocates that cliff; it does not lower it.
   *
   * **Defect two is endpoint leverage INSIDE the segment, and it is the one
   * that was actually costing a real user 287 kcal.** Measured 2026-08-19 on a
   * live account, at each count of most-recent weigh-ins removed:
   *
   *   dropped  segment      segment slope   window slope   old rule
   *   0        9pts / 8d    −0.2100         −0.0129        trusted segment
   *   1        8pts / 7d    −0.0714         −0.0050        trusted segment
   *   2        7pts / 6d    −0.0500         −0.0018        trusted segment
   *
   * The segment was selected in all three. Nothing switched. The segment's own
   * slope moved 3× because one 2 lb overnight reading left the end of an 8-day
   * line — water, by every argument in this file — and that alone moved
   * maintenance 484 kcal and the target 287.
   *
   * A span/count ramp cannot fix that. It would have to discard the segment to
   * damp it, and discarding the segment is precisely what the step and rebound
   * scenarios above exist to prevent.
   *
   * ## Inverse-variance weighting fixes both, and removes every threshold
   *
   * Each fit is weighted by the precision of its own slope, `Sxx / σ²`:
   *
   *   w = precision(segment) / (precision(segment) + precision(window))
   *
   * A settled post-break run is a tight line and keeps its weight, so the step
   * and rebound scenarios still land on the truth. A run whose slope exists
   * only because of one endpoint has a large residual, loses weight, and the
   * longer baseline takes over. Nobody has to name a span or a point count:
   * both are already inside `Sxx`, which grows with baseline length AND with
   * having points spread along it.
   *
   * `MIN_SEGMENT_POINTS` and `MIN_SEGMENT_SPAN_DAYS` are consequently no longer
   * consulted here. They are kept as documentation of the incidents that
   * produced them — the numbers are gone, the evidence is not.
   *
   * **Honest caveat:** the segment is a subset of the window, so the two
   * estimates are not independent and this is not textbook inverse-variance
   * pooling. It is a "trust the tighter line" heuristic that happens to have
   * the right limiting behaviour in both directions. The clamp below remains
   * the hard guarantee; this only decides how much of each fit to believe.
   */
  const segment = lastTrendSegment(allPoints);

  // No break, or nothing removed by the settle window: the two fits would be
  // the same computation on the same points. Take the fast path so an
  // unbroken history is byte-identical to what it has always been, and so
  // floating-point blending cannot perturb it by a fraction of a kcal.
  if (segment.length === allPoints.length) {
    const only = corroboratedSlope(allPoints);
    return finish(only?.slope ?? null, only?.dropped ?? 0);
  }

  const windowFit = corroboratedSlope(allPoints);
  const segmentFit = segment.length >= 2 ? corroboratedSlope(segment) : null;

  // Either fit missing ⇒ the other one is the whole answer. Falling back to the
  // window rather than to `null` is deliberate and predates the blend:
  // returning null sends `calculateTdee` to the hardcoded 2,450 seed, replacing
  // a biased estimate built from the user's own data with one built from
  // nobody's.
  if (segmentFit == null) return finish(windowFit?.slope ?? null, windowFit?.dropped ?? 0);
  if (windowFit == null) return finish(segmentFit.slope, segmentFit.dropped);

  // Points AND span. Four consecutive daily weigh-ins clear the count and span
  // three days, which is an overnight reading, not a rate — see
  // `MIN_SEGMENT_SPAN_DAYS` for the account that cost 1,700 kcal.
  const segmentSpan = segment[segment.length - 1].x - segment[0].x;
  const trustSegment =
    segment.length >= MIN_SEGMENT_POINTS && segmentSpan >= MIN_SEGMENT_SPAN_DAYS;
  const chosen = trustSegment ? segmentFit : windowFit;
  return finish(chosen.slope, chosen.dropped);
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
    const measuredTdee = Math.round(avgDailyIntake + dailyDeficitAchieved);

    const spanDays = calendarSpanDays(window);
    const loggingCompletenessPct = Math.min(100, Math.round((window.length / spanDays) * 100));
    const reliable =
      loggingCompletenessPct >= RELIABLE_MIN_PCT && intakeCals.length >= RELIABLE_MIN_INTAKE_DAYS;

    // ── Confidence damping. See `measuredConfidence`. ──
    // `reliable` used to be computed here and then never consulted, so a
    // 57%-complete window shipped its estimate at full strength. Now a thin
    // estimate is pulled toward the formula anchor — the same number this
    // function returns below when there are too few days to measure at all.
    //
    // The anchor needs a profile. Without one there is nothing to anchor TO,
    // so the measured value stands: a biased estimate from the user's own data
    // still beats the 2,450 seed built from nobody's.
    const confidence = measuredConfidence(loggingCompletenessPct, intakeCals.length);
    let anchorWeight: number | null = null;
    for (let i = window.length - 1; i >= 0; i--) {
      if (window[i].weight != null) { anchorWeight = window[i].weight!; break; }
    }
    // `ProfileFields` types height/age/sex/activity as required, but real
    // callers pass partials — mid-onboarding Firestore docs, and this repo's
    // own tests (`{ calorieFloor, targetPaceLbsPerWeek } as never`). Mifflin on
    // a partial yields NaN, and NaN would propagate silently through the blend
    // into the target. Validate the anchor rather than trusting the type.
    const rawAnchor =
      profile && anchorWeight != null ? mifflinStJeor(profile, anchorWeight) : Number.NaN;
    const anchor = Number.isFinite(rawAnchor) && rawAnchor > 0 ? Math.round(rawAnchor) : null;
    const trueTdee =
      anchor != null && confidence < 1
        ? Math.round(confidence * measuredTdee + (1 - confidence) * anchor)
        : measuredTdee;

    const pace = profile?.targetPaceLbsPerWeek ?? DEFAULT_PACE_LBS_PER_WEEK;
    const targetDeficit = (pace * KCAL_PER_POUND) / 7;
    const floor = calorieFloor(profile);
    const newDailyTarget = Math.max(floor, Math.round(trueTdee - targetDeficit));

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
      measuredTdee,
      confidence: round(confidence, 4),
      avgDailyIntake: Math.round(avgDailyIntake),
      weightSlopeLbsPerDay: round(slope, 5),
      dailyDeficitAchieved: Math.round(dailyDeficitAchieved),
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
