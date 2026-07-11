import type { DailyLog, Profile } from './types';
import { aggregateByDay, calculateTdee } from './tdee';
import { mergeDailyWeights, toProfileFields } from './targets';
import { weightSlopeLbPerWeek, type WeightPoint } from './weight-projection';
import { localDateKey } from './date';

/**
 * Adaptive-TDEE recalibration digest (v1.1 retention loop).
 *
 * Measured-mode TDEE (packages/core/src/tdee.ts) already recomputes a
 * data-driven `trueTdee` from the observed weight trend + intake, and
 * `dailyTargets` already *applies* it silently once it's reliable. What was
 * missing is the **visible** loop: telling the user "your real burn shifted —
 * here's the new number and why." This module turns that silent adaptation
 * into a surfaceable digest without changing any production target math — it
 * is read-only over `calculateTdee` / `dailyTargets`.
 *
 * The "last acknowledged" reference (`ack`) is caller-supplied and persisted
 * per-device (localStorage / AsyncStorage), mirroring the existing
 * `tdee-transition-dismissed` / `refine-targets-dismissed` dismiss keys — so
 * this feature adds NO new Firestore field and needs NO rules deploy.
 */

/** Window (logged days) the displayed weekly weight rate is fit over — mirrors
 *  MEASURED_WINDOW_DAYS in tdee.ts. Only affects the headline rate shown to the
 *  user, never the TDEE itself (that comes from `calculateTdee`). */
const RATE_WINDOW_DAYS = 28;

/** Default kcal drift vs the last acknowledged TDEE before we re-surface. */
const DEFAULT_DRIFT_THRESHOLD_KCAL = 75;
/** Default quiet period (days) after an acknowledgement before re-surfacing. */
const DEFAULT_MIN_DAYS_SINCE_ACK = 14;

const MS_PER_DAY = 86_400_000;

export type RecalibrationTrend = 'metabolism-slowed' | 'metabolism-faster' | 'steady';

/** What the user last dismissed/accepted, so we only re-nudge on real drift. */
export interface RecalibrationAck {
  /** The `trueTdee` value that was on screen when the user acknowledged it. */
  value: number;
  /** Epoch ms of the acknowledgement. */
  at: number;
}

export interface RecalibrationOptions {
  /** The last acknowledged reading, or null/undefined if never acknowledged. */
  ack?: RecalibrationAck | null;
  /** Current time (epoch ms). Injected for purity/testability. */
  now: number;
  /** Min |Δkcal| vs the last ack to re-surface. Default 75. */
  driftThresholdKcal?: number;
  /** Min days since the last ack before re-surfacing. Default 14. */
  minDaysSinceAck?: number;
}

export interface RecalibrationDigest {
  /** Measured mode is active AND reliable — a trustworthy data-driven TDEE. */
  available: boolean;
  /** The data-driven maintenance TDEE (kcal). 0 when unavailable. */
  trueTdee: number;
  /** The daily calorie target that follows (already applied by dailyTargets). */
  calorieTarget: number;
  /** Observed weight change, lb/week, signed (negative = losing). null when
   *  there aren't enough weigh-ins to fit a line. */
  weightTrendLbPerWeek: number | null;
  /** % of window days that carry a log — the confidence signal. */
  loggingCompletenessPct: number;
  /** Δ vs the last acknowledged `trueTdee` (kcal). null if never acknowledged. */
  deltaSinceAck: number | null;
  /** Δ vs what the Mifflin-St Jeor formula would have estimated (kcal). null
   *  when the profile is incomplete. Drives the first-ever "your real burn is
   *  N kcal below the estimate" narrative. */
  deltaVsFormula: number | null;
  /** Human-facing bucket for the shift, for i18n reason strings. */
  trend: RecalibrationTrend;
  /** True when there's a fresh, meaningful recalibration worth showing:
   *  measured+reliable AND (never acknowledged, OR the drift vs the last ack
   *  clears the threshold and the quiet period has elapsed). */
  shouldSurface: boolean;
}

const UNAVAILABLE: RecalibrationDigest = {
  available: false,
  trueTdee: 0,
  calorieTarget: 0,
  weightTrendLbPerWeek: null,
  loggingCompletenessPct: 0,
  deltaSinceAck: null,
  deltaVsFormula: null,
  trend: 'steady',
  shouldSurface: false,
};

/** Weigh-in points (last {@link RATE_WINDOW_DAYS} logged days) for the headline
 *  weekly rate — daily weights overlaid onto logs, aggregated per day. */
function windowWeighInPoints(
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
): WeightPoint[] {
  const daily = aggregateByDay(mergeDailyWeights(logs, dailyWeights));
  return daily
    .slice(-RATE_WINDOW_DAYS)
    .filter((l): l is DailyLog & { weight: number } => l.weight != null)
    .map((l) => ({ dateKey: localDateKey(l.date), weightLb: l.weight }));
}

function classifyTrend(delta: number | null, thresholdKcal: number): RecalibrationTrend {
  if (delta == null || Math.abs(delta) < thresholdKcal) return 'steady';
  // A lower measured TDEE than the reference = the body is burning less than
  // we last told the user → metabolic adaptation / slowdown.
  return delta < 0 ? 'metabolism-slowed' : 'metabolism-faster';
}

/**
 * Compute the recalibration digest. Pure: no I/O, no clock, no state. The
 * caller supplies `now` and the persisted `ack`, and persists a new ack when
 * the user acknowledges the surfaced digest.
 */
export function recalibrationDigest(
  profile: Profile | null,
  logs: DailyLog[],
  dailyWeights: Record<string, number>,
  opts: RecalibrationOptions,
): RecalibrationDigest {
  const merged = mergeDailyWeights(logs ?? [], dailyWeights ?? {});
  const fields = toProfileFields(profile);
  const adjusted = fields?.travelMode ? { ...fields, targetPaceLbsPerWeek: 0 } : fields;
  const tdee = calculateTdee(merged, adjusted);

  if (tdee.source !== 'measured' || !tdee.reliable) return { ...UNAVAILABLE };

  const driftThresholdKcal = opts.driftThresholdKcal ?? DEFAULT_DRIFT_THRESHOLD_KCAL;
  const minDaysSinceAck = opts.minDaysSinceAck ?? DEFAULT_MIN_DAYS_SINCE_ACK;

  const trueTdee = tdee.trueTdee;

  // Δ vs the Mifflin-St Jeor estimate (empty logs = formula mode), when the
  // profile is complete enough to produce one.
  let deltaVsFormula: number | null = null;
  if (fields) {
    const formula = calculateTdee([], fields);
    if (formula.source === 'formula') deltaVsFormula = trueTdee - formula.trueTdee;
  }

  const ack = opts.ack ?? null;
  const deltaSinceAck = ack ? trueTdee - ack.value : null;

  // First ever measured+reliable reading always surfaces; afterwards only when
  // the drift clears the threshold AND the quiet period has elapsed.
  let shouldSurface: boolean;
  if (!ack) {
    shouldSurface = true;
  } else {
    const daysSinceAck = (opts.now - ack.at) / MS_PER_DAY;
    shouldSurface =
      Math.abs(deltaSinceAck ?? 0) >= driftThresholdKcal && daysSinceAck >= minDaysSinceAck;
  }

  // Trend narrative references the last ack when present, else the formula
  // estimate (the first-show story), else steady.
  const trendRef = deltaSinceAck ?? deltaVsFormula;
  const trend = classifyTrend(trendRef, driftThresholdKcal);

  return {
    available: true,
    trueTdee,
    calorieTarget: tdee.newDailyTarget,
    weightTrendLbPerWeek: weightSlopeLbPerWeek(windowWeighInPoints(logs ?? [], dailyWeights ?? {})),
    loggingCompletenessPct: tdee.loggingCompletenessPct ?? 0,
    deltaSinceAck,
    deltaVsFormula,
    trend,
    shouldSurface,
  };
}
