/**
 * The recomposition signal (ADR-0043 Phase 4): is the scale and the waist
 * telling the same story? Two slopes and a fixed classification — no energy
 * model, no densities.
 *
 * - Weight: least squares over the RAW weigh-ins of the last
 *   {@link RECOMP_WEIGHT_DAYS} days (`weightSlopeLbPerWeek`, the line the Body
 *   tab's trend weight already comes from). The brief asked for "OLS on the
 *   7-day average"; no such series exists in this app, and OLS on raw daily
 *   points has the same expected slope without the moving average's
 *   end-effects (ADR-0043).
 * - Waist: least squares over the tapes of the last {@link RECOMP_WAIST_DAYS}
 *   days, one value per day (median of that day's readings), as in/4 weeks.
 *   Needs ≥ {@link RECOMP_MIN_TAPES} tapes.
 *
 * The waist slope also carries its standard error from the tape reading error
 * (σ 0.25 in). Its thresholds (±0.125 in / 4 weeks) sit BELOW one reading's
 * σ, so with three tapes a single quarter-inch reading decides the class.
 * `waistWithinNoise` says so, and the card says it in words; the class itself
 * follows the brief's table unchanged.
 */
import { TAPE_SD_IN } from './composition-maintenance';
import { dayNumber } from './body-composition';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import type { Measurement } from './types';
import { weightSlopeLbPerWeek } from './weight-projection';

export const RECOMP_WEIGHT_DAYS = 28;
export const RECOMP_WAIST_DAYS = 42;
export const RECOMP_MIN_TAPES = 3;
/** |weight slope| at or under this is "stable", lb/week. */
export const RECOMP_WEIGHT_STABLE_LB_PER_WEEK = 0.25;
/** Waist slope magnitude that counts as a move, inches per 4 weeks. */
export const RECOMP_WAIST_IN_PER_4WK = 0.125;

export type RecompClass =
  | 'recomp'
  | 'fat_loss'
  | 'scale_loss_waist_flat'
  | 'gaining_fat'
  | 'gaining_waist_stable'
  | 'no_signal';

export type RecompSignal =
  | { status: 'insufficient'; reason: 'weight' | 'tapes'; tapes: number }
  | {
      status: 'ok';
      cls: RecompClass;
      weightLbPerWeek: number;
      waistInPer4Wk: number;
      /** 1σ of the waist slope from reading error alone, in/4 weeks. */
      waistSeInPer4Wk: number;
      /** The waist slope is smaller than its own standard error. */
      waistWithinNoise: boolean;
      tapes: number;
    };

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The brief's table, in its order — the first matching row wins. */
export function classifyRecomp(weightLbPerWeek: number, waistInPer4Wk: number): RecompClass {
  const W = RECOMP_WEIGHT_STABLE_LB_PER_WEEK;
  const T = RECOMP_WAIST_IN_PER_4WK;
  const waistFlat = Math.abs(waistInPer4Wk) <= T;
  if (Math.abs(weightLbPerWeek) <= W && waistInPer4Wk <= -T) return 'recomp';
  if (weightLbPerWeek <= -W && waistInPer4Wk <= -T) return 'fat_loss';
  if (weightLbPerWeek <= -W && waistFlat) return 'scale_loss_waist_flat';
  if (weightLbPerWeek >= W && waistInPer4Wk >= T) return 'gaining_fat';
  if (weightLbPerWeek >= W && waistFlat) return 'gaining_waist_stable';
  return 'no_signal';
}

export function recompSignal(input: {
  dailyWeights: Readonly<Record<string, number>>;
  measurements: readonly Measurement[];
  boundary?: DayBoundary;
  now?: Date;
}): RecompSignal {
  const boundary = input.boundary ?? MIDNIGHT;
  const todayKey = dayKeyAt(input.now ?? new Date(), boundary);

  const waistFrom = shiftKey(todayKey, -RECOMP_WAIST_DAYS);
  const byDay = new Map<string, number[]>();
  for (const m of input.measurements) {
    if (m.waist == null) continue;
    const k = dayKeyAt(m.date, boundary);
    if (k < waistFrom || k > todayKey) continue;
    const list = byDay.get(k);
    if (list) list.push(m.waist);
    else byDay.set(k, [m.waist]);
  }
  const tapes = [...byDay.entries()].map(([k, vs]) => {
    const s = [...vs].sort((a, b) => a - b);
    const mid = s.length >> 1;
    return { x: dayNumber(k), y: s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2 };
  });
  if (tapes.length < RECOMP_MIN_TAPES) return { status: 'insufficient', reason: 'tapes', tapes: tapes.length };

  const weightFrom = shiftKey(todayKey, -RECOMP_WEIGHT_DAYS);
  const weighIns = Object.entries(input.dailyWeights)
    .filter(([k, w]) => k >= weightFrom && k <= todayKey && w > 0)
    .map(([dateKey, weightLb]) => ({ dateKey, weightLb }));
  const weightLbPerWeek = weightSlopeLbPerWeek(weighIns);
  if (weightLbPerWeek == null) return { status: 'insufficient', reason: 'weight', tapes: tapes.length };

  const mx = tapes.reduce((a, p) => a + p.x, 0) / tapes.length;
  const my = tapes.reduce((a, p) => a + p.y, 0) / tapes.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of tapes) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (sxx === 0) return { status: 'insufficient', reason: 'tapes', tapes: tapes.length };
  const waistInPer4Wk = (sxy / sxx) * 28;
  const waistSeInPer4Wk = (TAPE_SD_IN.waist / Math.sqrt(sxx)) * 28;

  return {
    status: 'ok',
    cls: classifyRecomp(weightLbPerWeek, waistInPer4Wk),
    weightLbPerWeek,
    waistInPer4Wk,
    waistSeInPer4Wk,
    waistWithinNoise: Math.abs(waistInPer4Wk) < waistSeInPer4Wk,
    tapes: tapes.length,
  };
}
