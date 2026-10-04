/**
 * Body composition at a point in time — fat mass (FM) and fat-free mass (FFM)
 * — for the composition-adjusted maintenance view (ADR-0043). Pure; kilograms
 * internally, because every energy density below is per kg.
 *
 * Why it exists: measured maintenance (ADR-0024) converts scale-weight change
 * to energy at one constant (`KCAL_PER_POUND`, 3,500 kcal/lb ≈ 7,716 kcal/kg).
 * During recomposition the scale can sit flat while fat is lost and lean
 * mass/water rises, so the scale reports ~no deficit and maintenance reads low.
 * Splitting the change into FM and FFM lets each be priced at its own density.
 *
 * ## Evidence
 *
 * - **Energy densities** — Hall KD, "What is the required energy deficit per
 *   unit weight loss?", Int J Obes 2008; and Hall KD, "The dynamics of human
 *   body weight change", PLoS Comput Biol 2008: fat mass ρF = 39.5 MJ/kg =
 *   9,440 kcal/kg; lean mass ρL = 7.6 MJ/kg = 1,816 kcal/kg (protein 19.7 MJ/kg
 *   at a hydration of 1.6). A fixed 3,500 kcal/lb misstates energy per unit
 *   weight; it depends on what the weight is made of.
 * - **US Navy circumference method** — men: %BF = 86.010·log10(waist − neck)
 *   − 70.041·log10(height) + 36.76; women: %BF = 163.205·log10(waist + hip −
 *   neck) − 97.684·log10(height) − 78.387. Inches; men's waist at the navel.
 * - **Its accuracy for CHANGE is poor per individual** — Frontiers in
 *   Physiology 2023, n = 926 men over 8 weeks: DXA −3.3 ± 2.8 %BF points vs
 *   circumference −2.2 ± 3.3; ~83% classified correctly for changes ≥ 1 point;
 *   absolute bias ≈ −6 points. Hence: use CHANGES, not levels; use many tapes
 *   and a regression, not two endpoints; always carry the uncertainty
 *   (`composition-maintenance.ts`); prefer a DXA point whenever there is one.
 *
 * The Body tab's `navyBodyFat` (./body-fat) stays as it is — it rounds to 0.1
 * and clamps for display, both of which throw away the resolution a slope fit
 * needs. {@link navyBodyFatPct} is the unrounded, guarded version.
 */
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { parseYmd } from './date';
import type { BodyFatMethod, Measurement, Sex } from './types';

/** Fat mass, kcal per kg (Hall 2008: 39.5 MJ/kg). */
export const FAT_KCAL_PER_KG = 9440;
/** Fat-free ("lean", includes water) mass, kcal per kg (Hall 2008: 7.6 MJ/kg). */
export const LEAN_KCAL_PER_KG = 1816;
export const KG_PER_LB = 0.45359237;
export const CM_PER_IN = 2.54;

/** Plausible-input bands for the Navy estimate, inches. Tighter than the
 *  storage bands (./measurement-bounds): those are typo filters, these are the
 *  range the regression was built on. */
export const NAVY_BOUNDS_IN = {
  height: [48, 90],
  waist: [20, 70],
  neck: [10, 25],
  hip: [20, 80],
} as const;

export type NavyRejectReason =
  | 'missing_input'
  | 'height_out_of_range'
  | 'waist_out_of_range'
  | 'neck_out_of_range'
  | 'hip_out_of_range'
  | 'waist_not_above_neck'
  | 'implausible_result';

export type NavyResult = { ok: true; pct: number } | { ok: false; reason: NavyRejectReason };

export interface NavyInput {
  sex: Sex;
  heightIn?: number;
  waistIn?: number;
  neckIn?: number;
  /** Required for women. */
  hipIn?: number;
  /** Inputs in cm instead — converted to inches before anything else. */
  heightCm?: number;
  waistCm?: number;
  neckCm?: number;
  hipCm?: number;
}

/**
 * The Navy formula with NO guards, rounding or clamping — the Monte Carlo in
 * `composition-maintenance.ts` perturbs readings around values that already
 * passed {@link navyBodyFatPct}. NaN when a log argument is ≤ 0.
 */
export function navyFormulaPct(sex: Sex, heightIn: number, waistIn: number, neckIn: number, hipIn = 0): number {
  return sex === 'female'
    ? 163.205 * Math.log10(waistIn + hipIn - neckIn) - 97.684 * Math.log10(heightIn) - 78.387
    : 86.01 * Math.log10(waistIn - neckIn) - 70.041 * Math.log10(heightIn) + 36.76;
}

const pick = (inch: number | undefined, cm: number | undefined) =>
  inch != null ? inch : cm != null ? cm / CM_PER_IN : undefined;
const within = (v: number, [lo, hi]: readonly [number, number]) => Number.isFinite(v) && v >= lo && v <= hi;

/**
 * US-Navy body-fat %, unrounded, or the reason there is none. Accepts inches
 * or cm per field (inches win when both are given).
 */
export function navyBodyFatPct(input: NavyInput): NavyResult {
  const heightIn = pick(input.heightIn, input.heightCm);
  const waistIn = pick(input.waistIn, input.waistCm);
  const neckIn = pick(input.neckIn, input.neckCm);
  const hipIn = pick(input.hipIn, input.hipCm);
  if (heightIn == null || waistIn == null || neckIn == null) return { ok: false, reason: 'missing_input' };
  if (input.sex === 'female' && hipIn == null) return { ok: false, reason: 'missing_input' };
  if (!within(heightIn, NAVY_BOUNDS_IN.height)) return { ok: false, reason: 'height_out_of_range' };
  if (!within(waistIn, NAVY_BOUNDS_IN.waist)) return { ok: false, reason: 'waist_out_of_range' };
  if (!within(neckIn, NAVY_BOUNDS_IN.neck)) return { ok: false, reason: 'neck_out_of_range' };
  if (input.sex === 'female' && !within(hipIn!, NAVY_BOUNDS_IN.hip)) return { ok: false, reason: 'hip_out_of_range' };
  if (waistIn <= neckIn) return { ok: false, reason: 'waist_not_above_neck' };
  const pct = navyFormulaPct(input.sex, heightIn, waistIn, neckIn, hipIn);
  // Same 2–60 band as the display estimate: outside it the inputs are wrong.
  if (!(pct >= 2 && pct <= 60)) return { ok: false, reason: 'implausible_result' };
  return { ok: true, pct };
}

// ─── Composition points ─────────────────────────────────────────

/** Where a day's body-fat % came from, in priority order. */
export type CompositionSource = 'dxa' | 'other' | 'navy';
const SOURCE_RANK: Record<CompositionSource, number> = { dxa: 0, other: 1, navy: 2 };

export interface CompositionPoint {
  dateKey: string;
  bodyFatPct: number;
  source: CompositionSource;
  /** The tapes a Navy point was computed from (median per field when the day
   *  has several rows), so the Monte Carlo can perturb the readings. */
  tapes?: { waistIn: number; neckIn: number; hipIn?: number };
}

export interface BodyProfile {
  sex?: Sex | null;
  heightIn?: number | null;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * One composition point per day, oldest first. Priority per day: a DXA %BF >
 * another measured %BF > the Navy estimate from that day's tapes > nothing.
 * Several rows of the same source on one day are combined by median (the
 * reminder asks for three readings and their median, so a user who enters all
 * three is not penalised). Tape rows that fail the Navy guards are skipped.
 */
export function compositionPoints(
  measurements: readonly Measurement[],
  body: BodyProfile,
  boundary: DayBoundary = MIDNIGHT,
): CompositionPoint[] {
  const byDay = new Map<string, Measurement[]>();
  for (const m of measurements) {
    const key = dayKeyAt(m.date, boundary);
    const list = byDay.get(key);
    if (list) list.push(m);
    else byDay.set(key, [m]);
  }
  const out: CompositionPoint[] = [];
  for (const [dateKey, rows] of byDay) {
    const candidates: CompositionPoint[] = [];
    for (const method of ['dxa', 'other'] as BodyFatMethod[]) {
      const vals = rows.filter((r) => r.bodyFatMethod === method && r.bodyFatPct != null).map((r) => r.bodyFatPct!);
      if (vals.length) candidates.push({ dateKey, bodyFatPct: median(vals), source: method });
    }
    if (body.sex && body.heightIn) {
      const female = body.sex === 'female';
      const tapeRows = rows.filter((r) => r.waist != null && r.neck != null && (!female || r.hip != null));
      if (tapeRows.length) {
        const tapes = {
          waistIn: median(tapeRows.map((r) => r.waist!)),
          neckIn: median(tapeRows.map((r) => r.neck!)),
          ...(female ? { hipIn: median(tapeRows.map((r) => r.hip!)) } : {}),
        };
        const res = navyBodyFatPct({ sex: body.sex, heightIn: body.heightIn, ...tapes });
        if (res.ok) candidates.push({ dateKey, bodyFatPct: res.pct, source: 'navy', tapes });
      }
    }
    if (candidates.length) {
      candidates.sort((a, b) => SOURCE_RANK[a.source] - SOURCE_RANK[b.source]);
      out.push(candidates[0]);
    }
  }
  return out.sort((a, b) => (a.dateKey < b.dateKey ? -1 : a.dateKey > b.dateKey ? 1 : 0));
}

// ─── Trend weight on a date ─────────────────────────────────────

/** Whole days since the epoch for a date key — DST-proof (rounded). */
export function dayNumber(dateKey: string): number {
  const d = parseYmd(dateKey);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

/** Half-width of the local fit behind {@link trendWeightAt}, days. */
export const TREND_HALF_WINDOW_DAYS = 14;
/** Weigh-ins the local fit needs. */
export const TREND_MIN_POINTS = 4;
/** How far past its nearest weigh-in a ONE-SIDED fit may be read, days. A
 *  line through four weigh-ins at +11…+14 days, read at 0, multiplies their
 *  noise ~5× — and nothing downstream models trend-weight error. */
export const TREND_MAX_EDGE_DAYS = 3;

/**
 * The smoothed weight on `dateKey`, lb — never a single weigh-in. A local
 * least-squares line through the weigh-ins within ±{@link TREND_HALF_WINDOW_DAYS}
 * days, evaluated at the date; at the edge of the data it is one-sided by
 * construction (there are no future weigh-ins to include). Null with fewer
 * than {@link TREND_MIN_POINTS} weigh-ins, when they all sit on one day, or
 * when they all sit on one side of the date and the nearest is more than
 * {@link TREND_MAX_EDGE_DAYS} days from it.
 *
 * A local line and not the 42-day measured fit (`tdee.ts`), because that fit
 * returns only a slope, never a level, and the composition window can be
 * longer than it.
 */
export function trendWeightAt(
  dateKey: string,
  dailyWeights: Readonly<Record<string, number>>,
  halfWindowDays = TREND_HALF_WINDOW_DAYS,
): number | null {
  const at = dayNumber(dateKey);
  const pts: { x: number; y: number }[] = [];
  for (const [k, w] of Object.entries(dailyWeights)) {
    if (!(w > 0)) continue;
    const x = dayNumber(k) - at;
    if (Math.abs(x) <= halfWindowDays) pts.push({ x, y: w });
  }
  if (pts.length < TREND_MIN_POINTS) return null;
  const oneSided = pts.every((p) => p.x > 0) || pts.every((p) => p.x < 0);
  if (oneSided && Math.min(...pts.map((p) => Math.abs(p.x))) > TREND_MAX_EDGE_DAYS) return null;
  const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
  const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
  let sxy = 0;
  let sxx = 0;
  for (const p of pts) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
  }
  if (sxx === 0) return null;
  return my - (sxy / sxx) * mx; // the line at x = 0, i.e. at `dateKey`
}

export interface Composition {
  dateKey: string;
  weightKg: number;
  bodyFatPct: number;
  fmKg: number;
  ffmKg: number;
  source: CompositionSource;
}

/**
 * FM and FFM on a composition point's date: trend weight × body-fat fraction.
 * Null when there is no trend weight there.
 */
export function compositionAt(
  point: CompositionPoint,
  dailyWeights: Readonly<Record<string, number>>,
): Composition | null {
  const lb = trendWeightAt(point.dateKey, dailyWeights);
  if (lb == null) return null;
  const weightKg = lb * KG_PER_LB;
  const fmKg = (weightKg * point.bodyFatPct) / 100;
  return { dateKey: point.dateKey, weightKg, bodyFatPct: point.bodyFatPct, fmKg, ffmKg: weightKg - fmKg, source: point.source };
}

/**
 * Energy stored in a change of composition: ΔE = 9,440·ΔFM + 1,816·ΔFFM (kcal).
 * Negative = energy released (fat burned, lean lost, or both).
 */
export function storedEnergyChangeKcal(deltaFmKg: number, deltaFfmKg: number): number {
  return FAT_KCAL_PER_KG * deltaFmKg + LEAN_KCAL_PER_KG * deltaFfmKg;
}
