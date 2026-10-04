/**
 * Composition-adjusted maintenance (ADR-0043) — maintenance from intake minus
 * the energy stored in a change of body COMPOSITION, rather than in a change of
 * scale weight. Display-only: nothing here feeds the calorie target, the pace
 * offset or the progression engine (ADR-0043 §Decision; `targets.ts` does not
 * import this module and `composition-maintenance.test.ts` pins that).
 *
 *   ΔE_stored        = 9,440·ΔFM + 1,816·ΔFFM            (Hall 2008, kcal)
 *   maintenance_comp = mean logged intake − ΔE_stored / days
 *
 * ## The window
 *
 * Composition points (./body-composition) from the last
 * {@link COMP_WINDOW_MAX_DAYS} days. The window runs from the FIRST point to
 * the LAST — never past them, so the body-fat line is interpolated, not
 * extrapolated — and needs ≥ {@link COMP_MIN_POINTS} points spanning
 * ≥ {@link COMP_MIN_SPAN_DAYS} days.
 *
 * It is NOT the measured estimate's 42 logged days. Under the error model
 * below, the 80% half-width falls only as 1/√days and barely with tape count,
 * so a tape-based estimate is always Low confidence — ≈ ±430 kcal at 42 days,
 * flooring at ≈ ±308 at the 84-day cap (ADR-0043 §Consequences). The owner kept
 * the cap at 84 rather than stretch the window to clear 300 by a few kcal.
 *
 * ## DXA-anchored mode
 *
 * When ≥ {@link COMP_DXA_MIN_POINTS} DXA scans in the last
 * {@link COMP_DXA_WINDOW_MAX_DAYS} days span ≥ {@link COMP_MIN_SPAN_DAYS} days,
 * the change comes from those scans ALONE — σ {@link DXA_SD_PCT} each and no
 * method-change term — and tapes are left to the recomp card. A tape in the
 * same window would bring the whole circumference method error back with it,
 * which is why a DXA at each end of a tape series barely helped (±303 vs ±308).
 * The longer lookback is because scans are months apart. If the DXA estimate
 * fails a later gate (no weigh-ins around an old scan, too little intake), the
 * mixed estimate is tried instead.
 *
 * ## Mixed mode reads change WITHIN a method, never across two
 *
 * Methods disagree on LEVEL — the Navy formula reads ~6 %BF points under DXA —
 * so one line through a DXA, a smart-scale reading and tapes turns that gap
 * into a fat change that never happened (one DXA on the last tape day moved a
 * flat-weight 2,000 kcal maintenance to 1,640; on the first day, to 2,365).
 * The fit therefore shares ONE slope across methods but gives each method its
 * OWN intercept, and a method needs ≥ 2 readings in the window to take part: a
 * single reading says where body fat is by that method, not how it moved. The
 * gate counts only those points, and at least one method must itself span
 * {@link COMP_MIN_SPAN_DAYS}. The level the change is priced at is the most
 * accurate method present (DXA > other > Navy).
 *
 * Intake follows the measured-mode logged-day rules: days are bucketed by
 * `aggregateByDay` under the user's boundary, unlogged days are EXCLUDED (never
 * imputed), and the mean is the same `trimmedMean` the measured estimate uses.
 * Intake days are [first point, last point): the energy stored between the
 * morning of the first tape and the morning of the last. Points are never
 * after today, so that half-open window already keeps the day in progress out
 * (the rule `withoutInProgressIntake`, cf0953d4, states for the measured
 * estimate).
 *
 * The app's log cache is ROWS, not days (`LOG_WINDOW_ROWS`, ADR-0004), so a
 * long window can start before the cache does. Days before
 * `logsCompleteFromKey` ({@link logsCompleteFrom}) are unknown rather than
 * unlogged and are left out. That also drops the oldest cached day, which the
 * cap may have cut off partway and which would otherwise read as a low-intake
 * day. The mean then covers the cached part of the window
 * (`intakeFromKey`), on the same assumption the measured estimate already makes
 * about unlogged days: the logged days stand for the rest.
 *
 * ## Uncertainty — Monte Carlo, seeded
 *
 * Each of {@link MC_DRAWS} draws perturbs every reading (tape σ: waist 0.25 in,
 * neck 0.125 in, hip 0.25 in; a DXA %BF σ 1.0; another measured %BF σ 1.0),
 * re-fits the body-fat line (shared slope, per-method intercepts) over every
 * point that passed the gate, and adds the
 * method's error on a CHANGE — {@link NAVY_CHANGE_SD_PER_56_DAYS} %BF points
 * per 8 weeks, scaled by √(days/56) (Frontiers in Physiology 2023: DXA change
 * −3.3 ± 2.8 vs circumference −2.2 ± 3.3 over 8 weeks, n = 926 men) — unless
 * every point is DXA. The seed is fixed so a test, and a user reopening the
 * screen, see the same interval.
 *
 * Not modelled: intake under-reporting and trend-weight error. Both are real;
 * the first is the measured estimate's problem too, and the second is small
 * next to the method error at these window lengths.
 */
import {
  FAT_KCAL_PER_KG,
  KG_PER_LB,
  LEAN_KCAL_PER_KG,
  compositionPoints,
  dayNumber,
  navyFormulaPct,
  storedEnergyChangeKcal,
  trendWeightAt,
  type BodyProfile,
  type CompositionPoint,
  type CompositionSource,
} from './body-composition';
import { MIDNIGHT, dayKeyAt, type DayBoundary } from './day-boundary';
import { MEASURED_MIN_DAYS, aggregateByDay, trimmedMean } from './tdee';
import type { DailyLog, Measurement } from './types';

/** Lookback for composition points, calendar days (ADR-0043 decision 1). */
export const COMP_WINDOW_MAX_DAYS = 84;
/** Lookback for the DXA-anchored mode — scans are months apart (ADR-0043 §Open 1). */
export const COMP_DXA_WINDOW_MAX_DAYS = 182;
/** DXA scans the DXA-anchored mode needs (they must also span COMP_MIN_SPAN_DAYS). */
export const COMP_DXA_MIN_POINTS = 2;
/** Minimum days between the first and last composition point. */
export const COMP_MIN_SPAN_DAYS = 28;
/** Minimum composition points in the window. */
export const COMP_MIN_POINTS = 3;
/** Logged intake days needed inside the window — the measured estimate's own
 *  floor, so this never opens on less intake evidence than that one does. */
export const COMP_MIN_LOGGED_DAYS = MEASURED_MIN_DAYS;

/** Per-reading tape error, inches (σ). */
export const TAPE_SD_IN = { waist: 0.25, neck: 0.125, hip: 0.25 } as const;
/** Per-reading error of a DXA %BF (σ, %BF points). */
export const DXA_SD_PCT = 1.0;
/** Per-reading error of another measured %BF (scale, calipers…), σ. It also
 *  carries the method's change error — only DXA is exempt. */
export const OTHER_SD_PCT = 1.0;
/**
 * The circumference method's error on a CHANGE in %BF, σ, per 8 weeks.
 * Frontiers in Physiology 2023 (n = 926 men, 8 weeks of basic training): DXA
 * −3.3 ± 2.8 %BF points, circumference −2.2 ± 3.3; ~83% classified correctly
 * for changes ≥ 1 point. Scaled by √(days/56) for other window lengths.
 */
export const NAVY_CHANGE_SD_PER_56_DAYS = 3.0;
export const MC_DRAWS = 2000;
export const MC_SEED = 20261003;
/** Confidence from the 80% half-width, kcal/day. */
export const CONFIDENCE_HIGH_MAX_KCAL = 150;
export const CONFIDENCE_MEDIUM_MAX_KCAL = 300;

export type CompConfidence = 'high' | 'medium' | 'low';
/** `dxa_anchored`: the change is from DXA scans alone. `mixed`: the 84-day
 *  window's points from every method seen ≥ 2 times, fitted per method, with
 *  the method-change error unless all are DXA. */
export type CompMode = 'dxa_anchored' | 'mixed';

export type CompositionMaintenance =
  | {
      status: 'insufficient_tapes';
      points: number;
      spanDays: number;
      /** Sex or height missing from the profile — tapes cannot become points. */
      profileMissing: boolean;
    }
  | { status: 'insufficient_logging'; points: number; spanDays: number; loggedDays: number }
  | { status: 'insufficient_weight'; points: number; spanDays: number }
  | CompositionMaintenanceOk;

export interface CompositionMaintenanceOk {
  status: 'ok';
  /** Median of the Monte Carlo, kcal/day — the number to show. */
  median: number;
  /** 80% interval. */
  p10: number;
  p90: number;
  halfWidth80: number;
  confidence: CompConfidence;
  /** The no-noise answer, for diagnostics; ≈ median. */
  pointEstimate: number;
  mode: CompMode;
  points: number;
  sources: Record<CompositionPoint['source'], number>;
  firstKey: string;
  lastKey: string;
  spanDays: number;
  loggedDays: number;
  /** First day intake was read from — later than `firstKey` when the log
   *  cache does not reach back that far. */
  intakeFromKey: string;
  meanIntake: number;
  weightStartKg: number;
  weightEndKg: number;
  bodyFatStartPct: number;
  bodyFatEndPct: number;
  deltaFmKg: number;
  deltaFfmKg: number;
  storedKcal: number;
}

export interface CompositionMaintenanceInput {
  logs: readonly DailyLog[];
  dailyWeights: Readonly<Record<string, number>>;
  measurements: readonly Measurement[];
  profile: BodyProfile;
  boundary?: DayBoundary;
  now?: Date;
  /** First day the `logs` input is complete from ({@link logsCompleteFrom});
   *  absent when the input holds every log. */
  logsCompleteFromKey?: string;
  /** Test seams; production uses the defaults. */
  draws?: number;
  seed?: number;
}

/** mulberry32 — tiny, seedable, good enough for a 2,000-draw interval. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): () => number {
  return () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
}

/** Which method's level a change is priced at — the most accurate present. */
const LEVEL_ORDER: readonly CompositionSource[] = ['dxa', 'other', 'navy'];

/**
 * Least-squares body-fat line with ONE slope shared by every method and an
 * intercept PER method (a fixed-effects fit), so a gap between methods is
 * absorbed by their intercepts instead of reading as change. Returns the line
 * of the most accurate method present ({@link LEVEL_ORDER}) at x = 0 and
 * x = span. With a single method this is the ordinary least-squares line.
 */
function fitEnds(
  xs: readonly number[],
  ys: readonly number[],
  sources: readonly CompositionSource[],
  span: number,
): { start: number; end: number } {
  const means = new Map<CompositionSource, { mx: number; my: number }>();
  for (const src of LEVEL_ORDER) {
    const idx = sources.flatMap((s, i) => (s === src ? [i] : []));
    if (!idx.length) continue;
    means.set(src, {
      mx: idx.reduce((a, i) => a + xs[i], 0) / idx.length,
      my: idx.reduce((a, i) => a + ys[i], 0) / idx.length,
    });
  }
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    const { mx, my } = means.get(sources[i])!;
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const { mx, my } = means.get(LEVEL_ORDER.find((s) => means.has(s))!)!;
  const at = (x: number) => my + slope * (x - mx);
  return { start: at(0), end: at(span) };
}

/** The points of every method read ≥ 2 times — a lone reading has a level and
 *  no change, and {@link fitEnds} reads change within a method only. */
function changePoints(pts: readonly CompositionPoint[]): CompositionPoint[] {
  const n: Record<CompositionSource, number> = { dxa: 0, other: 0, navy: 0 };
  for (const p of pts) n[p.source]++;
  return pts.filter((p) => n[p.source] >= 2);
}

/** The longest first→last span any single method covers, days. */
function longestMethodSpan(pts: readonly CompositionPoint[]): number {
  return Math.max(0, ...LEVEL_ORDER.map((src) => spanOf(pts.filter((p) => p.source === src))));
}

function quantile(sorted: readonly number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function confidenceFromHalfWidth(halfWidth80: number): CompConfidence {
  if (halfWidth80 <= CONFIDENCE_HIGH_MAX_KCAL) return 'high';
  if (halfWidth80 <= CONFIDENCE_MEDIUM_MAX_KCAL) return 'medium';
  return 'low';
}

function shiftKey(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Maintenance from one composition change. Exported for the arithmetic tests. */
export function maintenanceFromComposition(a: {
  meanIntake: number;
  spanDays: number;
  weightStartKg: number;
  weightEndKg: number;
  bodyFatStartPct: number;
  bodyFatEndPct: number;
}): { deltaFmKg: number; deltaFfmKg: number; storedKcal: number; maintenance: number } {
  const fmS = (a.weightStartKg * a.bodyFatStartPct) / 100;
  const fmE = (a.weightEndKg * a.bodyFatEndPct) / 100;
  const deltaFmKg = fmE - fmS;
  const deltaFfmKg = a.weightEndKg - a.weightStartKg - deltaFmKg;
  const storedKcal = storedEnergyChangeKcal(deltaFmKg, deltaFfmKg);
  return { deltaFmKg, deltaFfmKg, storedKcal, maintenance: a.meanIntake - storedKcal / a.spanDays };
}

/**
 * The first day a row-capped log cache is complete from: undefined while the
 * cache holds fewer rows than its cap (it has everything), else the day AFTER
 * its oldest row, because the cap may have cut that day off partway.
 */
export function logsCompleteFrom(
  logs: readonly DailyLog[],
  rowCap: number,
  boundary: DayBoundary = MIDNIGHT,
): string | undefined {
  if (logs.length < rowCap) return undefined;
  let oldest: Date | undefined;
  for (const l of logs) if (!oldest || l.date < oldest) oldest = l.date;
  return oldest ? shiftKey(dayKeyAt(oldest, boundary), 1) : undefined;
}

const spanOf = (pts: readonly CompositionPoint[]) =>
  pts.length ? dayNumber(pts[pts.length - 1].dateKey) - dayNumber(pts[0].dateKey) : 0;

export function compositionMaintenance(input: CompositionMaintenanceInput): CompositionMaintenance {
  const boundary = input.boundary ?? MIDNIGHT;
  const now = input.now ?? new Date();
  const todayKey = dayKeyAt(now, boundary);
  const all = compositionPoints(input.measurements, input.profile, boundary).filter((p) => p.dateKey <= todayKey);

  const dxaOldestKey = shiftKey(todayKey, -COMP_DXA_WINDOW_MAX_DAYS);
  const dxa = all.filter((p) => p.source === 'dxa' && p.dateKey >= dxaOldestKey);
  let dxaMiss: CompositionMaintenance | undefined;
  if (dxa.length >= COMP_DXA_MIN_POINTS && spanOf(dxa) >= COMP_MIN_SPAN_DAYS) {
    const r = estimate(input, dxa, 'dxa_anchored', boundary);
    if (r.status === 'ok') return r;
    dxaMiss = r;
  }

  const oldestKey = shiftKey(todayKey, -COMP_WINDOW_MAX_DAYS);
  const pts = changePoints(all.filter((p) => p.dateKey >= oldestKey));
  const spanDays = spanOf(pts);
  if (pts.length < COMP_MIN_POINTS || longestMethodSpan(pts) < COMP_MIN_SPAN_DAYS) {
    // A DXA pair that missed on logging or weight names THAT gap — telling
    // someone with two scans to "log a tape" points at the wrong fix.
    if (dxaMiss) return dxaMiss;
    const { sex, heightIn } = input.profile;
    const profileMissing = !sex || !(heightIn != null && heightIn > 0);
    return { status: 'insufficient_tapes', points: pts.length, spanDays, profileMissing };
  }
  return estimate(input, pts, 'mixed', boundary);
}

/** The estimate over points that already passed their mode's count/span gate. */
function estimate(
  input: CompositionMaintenanceInput,
  pts: readonly CompositionPoint[],
  mode: CompMode,
  boundary: DayBoundary,
): Exclude<CompositionMaintenance, { status: 'insufficient_tapes' }> {
  const { sex, heightIn } = input.profile;
  const spanDays = spanOf(pts);
  const first = pts[0];
  const last = pts[pts.length - 1];

  // Intake: the measured-mode logged-day rules, over [first, last), from where
  // the log cache is complete. `last` is never after today, so the half-open
  // window already leaves the day in progress out.
  const intakeFromKey =
    input.logsCompleteFromKey && input.logsCompleteFromKey > first.dateKey ? input.logsCompleteFromKey : first.dateKey;
  const intake = aggregateByDay([...input.logs], boundary)
    .filter((d) => {
      const k = dayKeyAt(d.date, boundary);
      return k >= intakeFromKey && k < last.dateKey;
    })
    .map((d) => d.calories)
    .filter((c) => c > 0);
  if (intake.length < COMP_MIN_LOGGED_DAYS) {
    return { status: 'insufficient_logging', points: pts.length, spanDays, loggedDays: intake.length };
  }
  const meanIntake = trimmedMean(intake);

  const wS = trendWeightAt(first.dateKey, input.dailyWeights);
  const wE = trendWeightAt(last.dateKey, input.dailyWeights);
  if (wS == null || wE == null) return { status: 'insufficient_weight', points: pts.length, spanDays };
  const weightStartKg = wS * KG_PER_LB;
  const weightEndKg = wE * KG_PER_LB;

  const x0 = dayNumber(first.dateKey);
  const xs = pts.map((p) => dayNumber(p.dateKey) - x0);
  const srcs = pts.map((p) => p.source);
  const nominal = fitEnds(xs, pts.map((p) => p.bodyFatPct), srcs, spanDays);
  const point = maintenanceFromComposition({
    meanIntake,
    spanDays,
    weightStartKg,
    weightEndKg,
    bodyFatStartPct: nominal.start,
    bodyFatEndPct: nominal.end,
  });

  // ── Monte Carlo ──
  const normal = gaussian(seededRandom(input.seed ?? MC_SEED));
  const allDxa = pts.every((p) => p.source === 'dxa');
  const methodSd = allDxa ? 0 : NAVY_CHANGE_SD_PER_56_DAYS * Math.sqrt(spanDays / 56);
  const draws = input.draws ?? MC_DRAWS;
  const out: number[] = [];
  for (let d = 0; d < draws; d++) {
    const ys = pts.map((p) => {
      if (p.source === 'navy' && p.tapes && sex) {
        const v = navyFormulaPct(
          sex,
          heightIn!,
          p.tapes.waistIn + normal() * TAPE_SD_IN.waist,
          p.tapes.neckIn + normal() * TAPE_SD_IN.neck,
          p.tapes.hipIn != null ? p.tapes.hipIn + normal() * TAPE_SD_IN.hip : undefined,
        );
        return Number.isFinite(v) ? v : p.bodyFatPct;
      }
      return p.bodyFatPct + normal() * (p.source === 'dxa' ? DXA_SD_PCT : OTHER_SD_PCT);
    });
    const ends = fitEnds(xs, ys, srcs, spanDays);
    const m = maintenanceFromComposition({
      meanIntake,
      spanDays,
      weightStartKg,
      weightEndKg,
      bodyFatStartPct: ends.start,
      bodyFatEndPct: ends.end + normal() * methodSd,
    });
    out.push(m.maintenance);
  }
  out.sort((a, b) => a - b);
  const p10 = quantile(out, 0.1);
  const p90 = quantile(out, 0.9);
  const halfWidth80 = (p90 - p10) / 2;

  const sources = { dxa: 0, other: 0, navy: 0 };
  for (const p of pts) sources[p.source]++;

  return {
    status: 'ok',
    median: Math.round(quantile(out, 0.5)),
    p10: Math.round(p10),
    p90: Math.round(p90),
    halfWidth80: Math.round(halfWidth80),
    confidence: confidenceFromHalfWidth(halfWidth80),
    pointEstimate: Math.round(point.maintenance),
    mode,
    points: pts.length,
    sources,
    firstKey: first.dateKey,
    lastKey: last.dateKey,
    spanDays,
    loggedDays: intake.length,
    intakeFromKey,
    meanIntake: Math.round(meanIntake),
    weightStartKg,
    weightEndKg,
    bodyFatStartPct: nominal.start,
    bodyFatEndPct: nominal.end,
    deltaFmKg: point.deltaFmKg,
    deltaFfmKg: point.deltaFfmKg,
    storedKcal: Math.round(point.storedKcal),
  };
}

// ─── Phase 5: the Forbes prior (flag OFF — ADR-0043 §Forbes) ────

/**
 * Forbes: the share of a weight change that is fat-free mass when composition
 * is NOT measured — dFFM/dBW = 10.4 / (10.4 + FM_kg) (Forbes; revisited by
 * Hall, Br J Nutr 2007). A POPULATION prior from non-training cohorts:
 * resistance training plus high protein shifts loss toward fat, so for a
 * lifter `p` overstates the lean share. Computed, never shipped on.
 */
export function forbesLeanFraction(fmKg: number): number {
  return 10.4 / (10.4 + fmKg);
}

/** kcal per kg of weight change under the Forbes split. */
export function forbesEnergyDensityKcalPerKg(fmKg: number): number {
  const p = forbesLeanFraction(fmKg);
  return p * LEAN_KCAL_PER_KG + (1 - p) * FAT_KCAL_PER_KG;
}

/**
 * Maintenance from intake and a weight slope priced at the Forbes density
 * instead of 3,500 kcal/lb — the alternative for a window with no composition
 * data. `fmKg` from the latest composition point.
 */
export function forbesMaintenance(a: { avgDailyIntake: number; weightSlopeLbsPerDay: number; fmKg: number }): number {
  return a.avgDailyIntake - a.weightSlopeLbsPerDay * KG_PER_LB * forbesEnergyDensityKcalPerKg(a.fmKg);
}
