/**
 * The home plan (owner, 2026-11-18): what a trip plan (`travel-plan.ts`) is for
 * a trip, for the weeks at home after it — dated notes, the default training
 * week, a program review checkpoint, the deload trigger, a quiet window for
 * weight alerts, a dated tape check-in against a baseline, and days a meal
 * may be logged as an estimate.
 *
 * Lives on the profile (`homePlan`), written by owner-data scripts; the app
 * reads it and writes only `review.dismissedAt`. Says what is coming, never
 * what is owed: nothing here flags a missed session or blocks anything.
 *
 * Pure; no I/O, no clock — `today` (YYYY-MM-DD, the lifter's day) is passed in.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import { dayKeyAt, type DayBoundary } from './day-boundary';
import type { WorkoutSession } from './workout';

export interface HomePlanNote {
  /** First day it shows, YYYY-MM-DD. */
  from: string;
  /** Last day it shows, inclusive. */
  to: string;
  label: string;
  note?: string;
}

/** "v2.4 review — recovery OK?" once N full rotations are done. */
export interface HomePlanReview {
  title: string;
  body: string;
  /** The rotation: one completed, normal session of EACH is one rotation. */
  templateIds: string[];
  /** Sessions before this day do not count, YYYY-MM-DD. */
  since: string;
  afterRotations: number;
  /** Set by the app when the lifter dismisses the card. */
  dismissedAt?: string;
}

/** A dated tape check against a baseline (weight as a 7-day average). */
export interface HomePlanCheckIn {
  /** The day it is due, YYYY-MM-DD. The card shows from then for a week. */
  date: string;
  title: string;
  note?: string;
  baseline: { date: string; weightLb?: number; waistIn?: number; neckIn?: number };
}

/** Days when one meal may be logged as an estimate, without accuracy nags. */
export interface HomePlanEstimatedMeal {
  from: string;
  to: string;
  /** The meal it is for ("lunch"). */
  slot: string;
  note?: string;
}

/**
 * Days the day's numbers read protein first (owner, 2026-11-20: a trip with
 * no kitchen): protein is the headline, calories are a range, and nothing
 * about a deficit is said (`protein-first.ts`).
 */
export interface HomePlanNutrition {
  from: string;
  to: string;
  /** Protein to aim for, g. Absent → the profile's target. */
  proteinTarget?: number;
  /** The least that still counts as a good day, g. */
  proteinFloor?: number;
  kcalMin: number;
  kcalMax: number;
  note?: string;
}

export interface HomePlan {
  label?: string;
  notes?: HomePlanNote[];
  /** The default week, ISO weekdays (1 = Mon … 7 = Sun). A suggestion only:
   *  training on another day, or two days running, warns about nothing. */
  trainingDays?: number[];
  review?: HomePlanReview;
  /** Lifts that must be down together before the deload prompt (default 2,
   *  `deload.ts`). */
  deloadTriggerLifts?: number;
  /** Reps an activation must drop by, twice running, to count as down
   *  (default 2, `deload.ts`). */
  deloadRepsDown?: number;
  /** No weight alerts (the day-over-day outlier check) BEFORE this day. */
  weightQuietUntil?: string;
  checkIn?: HomePlanCheckIn;
  estimatedMeals?: HomePlanEstimatedMeal[];
  nutrition?: HomePlanNutrition[];
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(parseYmd(v).getTime());
const str = (v: unknown, max: number): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined;
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;
const span = (r: Record<string, unknown>) => isYmd(r['from']) && isYmd(r['to']) && r['from'] <= r['to'];
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** The profile's home plan, malformed parts dropped (never repaired). */
export function homePlanOf(profile: { homePlan?: unknown } | null | undefined): HomePlan | null {
  const r = obj(profile?.homePlan);
  if (!r) return null;
  const plan: HomePlan = {};
  const label = str(r['label'], 60);
  if (label) plan.label = label;
  if (Array.isArray(r['notes'])) {
    const notes = r['notes'].map(obj).filter((n): n is Record<string, unknown> => n != null && span(n) && str(n['label'], 80) != null)
      .slice(0, 20)
      .map((n) => ({ from: n['from'] as string, to: n['to'] as string, label: str(n['label'], 80)!, ...(str(n['note'], 300) ? { note: str(n['note'], 300)! } : {}) }));
    if (notes.length) plan.notes = notes.sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  }
  if (Array.isArray(r['trainingDays'])) {
    const days = [...new Set(r['trainingDays'].filter((d): d is number => Number.isInteger(d) && d >= 1 && d <= 7))].sort();
    if (days.length) plan.trainingDays = days;
  }
  const rv = obj(r['review']);
  if (rv && str(rv['title'], 80) && str(rv['body'], 300) && isYmd(rv['since']) && Array.isArray(rv['templateIds'])) {
    const ids = rv['templateIds'].filter((x): x is string => typeof x === 'string' && x.length > 0).slice(0, 10);
    const after = num(rv['afterRotations'], 1, 52);
    if (ids.length && after != null) {
      plan.review = {
        title: str(rv['title'], 80)!, body: str(rv['body'], 300)!, templateIds: ids, since: rv['since'], afterRotations: Math.round(after),
        ...(isYmd(rv['dismissedAt']) ? { dismissedAt: rv['dismissedAt'] } : {}),
      };
    }
  }
  const lifts = num(r['deloadTriggerLifts'], 1, 20);
  if (lifts != null) plan.deloadTriggerLifts = Math.round(lifts);
  const down = num(r['deloadRepsDown'], 1, 10);
  if (down != null) plan.deloadRepsDown = Math.round(down);
  if (isYmd(r['weightQuietUntil'])) plan.weightQuietUntil = r['weightQuietUntil'];
  const ci = obj(r['checkIn']);
  const base = obj(ci?.['baseline']);
  if (ci && isYmd(ci['date']) && str(ci['title'], 80) && base && isYmd(base['date'])) {
    const b: HomePlanCheckIn['baseline'] = { date: base['date'] };
    const w = num(base['weightLb'], 50, 700); if (w != null) b.weightLb = w;
    const waist = num(base['waistIn'], 10, 100); if (waist != null) b.waistIn = waist;
    const neck = num(base['neckIn'], 5, 40); if (neck != null) b.neckIn = neck;
    plan.checkIn = { date: ci['date'], title: str(ci['title'], 80)!, baseline: b, ...(str(ci['note'], 300) ? { note: str(ci['note'], 300)! } : {}) };
  }
  if (Array.isArray(r['estimatedMeals'])) {
    const meals = r['estimatedMeals'].map(obj).filter((m): m is Record<string, unknown> => m != null && span(m) && str(m['slot'], 20) != null)
      .slice(0, 10)
      .map((m) => ({ from: m['from'] as string, to: m['to'] as string, slot: str(m['slot'], 20)!, ...(str(m['note'], 200) ? { note: str(m['note'], 200)! } : {}) }));
    if (meals.length) plan.estimatedMeals = meals;
  }
  if (Array.isArray(r['nutrition'])) {
    const windows: HomePlanNutrition[] = [];
    for (const n of r['nutrition'].map(obj).slice(0, 10)) {
      if (!n || !span(n)) continue;
      const lo = num(n['kcalMin'], 800, 10000);
      const hi = num(n['kcalMax'], 800, 10000);
      if (lo == null || hi == null || lo > hi) continue;
      const target = num(n['proteinTarget'], 1, 999);
      const floor = num(n['proteinFloor'], 1, 999);
      windows.push({
        from: n['from'] as string, to: n['to'] as string, kcalMin: Math.round(lo), kcalMax: Math.round(hi),
        ...(target != null ? { proteinTarget: Math.round(target) } : {}),
        // A floor above the target is not a floor.
        ...(floor != null && (target == null || floor <= target) ? { proteinFloor: Math.round(floor) } : {}),
        ...(str(n['note'], 200) ? { note: str(n['note'], 200)! } : {}),
      });
    }
    if (windows.length) plan.nutrition = windows;
  }
  return Object.keys(plan).length ? plan : null;
}

/** The protein-first window covering today, or null. */
export function nutritionWindowToday(plan: HomePlan | null, today: string): HomePlanNutrition | null {
  return (plan?.nutrition ?? []).find((n) => today >= n.from && today <= n.to) ?? null;
}

/** The notes showing today. */
export function activeHomeNotes(plan: HomePlan | null, today: string): HomePlanNote[] {
  return (plan?.notes ?? []).filter((n) => today >= n.from && today <= n.to);
}

/** The estimated-meal window covering today, or null. */
export function estimatedMealToday(plan: HomePlan | null, today: string): HomePlanEstimatedMeal | null {
  return (plan?.estimatedMeals ?? []).find((m) => today >= m.from && today <= m.to) ?? null;
}

/** True while weight alerts are off (today is before `weightQuietUntil`). */
export function weightAlertsQuiet(plan: HomePlan | null, today: string): boolean {
  return plan?.weightQuietUntil != null && today < plan.weightQuietUntil;
}

/** Days the check-in card stays up after it is due. */
export const CHECK_IN_SHOW_DAYS = 7;

/** The check-in to show today: due, and within {@link CHECK_IN_SHOW_DAYS}. */
export function checkInToday(plan: HomePlan | null, today: string): HomePlanCheckIn | null {
  const c = plan?.checkIn;
  if (!c || today < c.date) return null;
  const last = calendarDateKey(addDays(parseYmd(c.date), CHECK_IN_SHOW_DAYS - 1));
  return today <= last ? c : null;
}

export interface CheckInReading {
  /** Mean of the weigh-ins in the 7 days ending on the check-in day (or today,
   *  if earlier), lb, one decimal. Null with no weigh-in in that window. */
  avgWeightLb: number | null;
  weighIns: number;
  /** Change vs the baseline, lb, one decimal. */
  weightDelta: number | null;
  /** The newest tape on or after the check-in day. */
  waistIn: number | null;
  neckIn: number | null;
  waistDelta: number | null;
  neckDelta: number | null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The check-in's numbers: the 7-day weight average vs the baseline, and the
 * newest tape (waist, neck) taken on or after the check-in day vs the
 * baseline's. Pure.
 */
export function checkInReading(
  checkIn: HomePlanCheckIn,
  today: string,
  dailyWeights: Readonly<Record<string, number>>,
  measurements: readonly { date: Date; waist?: number; neck?: number }[],
  boundary: DayBoundary,
): CheckInReading {
  const end = today < checkIn.date ? today : checkIn.date;
  const start = calendarDateKey(addDays(parseYmd(end), -6));
  const ws = Object.entries(dailyWeights).filter(([k, w]) => k >= start && k <= end && w > 0).map(([, w]) => w);
  const avg = ws.length ? r1(ws.reduce((a, b) => a + b, 0) / ws.length) : null;
  const tapes = measurements
    .filter((m) => dayKeyAt(m.date, boundary) >= checkIn.date)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const waist = tapes.find((m) => m.waist != null)?.waist ?? null;
  const neck = tapes.find((m) => m.neck != null)?.neck ?? null;
  const b = checkIn.baseline;
  return {
    avgWeightLb: avg,
    weighIns: ws.length,
    weightDelta: avg != null && b.weightLb != null ? r1(avg - b.weightLb) : null,
    waistIn: waist,
    neckIn: neck,
    waistDelta: waist != null && b.waistIn != null ? r2(waist - b.waistIn) : null,
    neckDelta: neck != null && b.neckIn != null ? r2(neck - b.neckIn) : null,
  };
}

/**
 * Full rotations done for the review: completed, NORMAL sessions (not
 * re-entry, not deload, not empty) of the review's templates on or after
 * `since`; one of each is one rotation, so the count is the least-done
 * template's. Pure.
 */
export function reviewRotations(
  review: HomePlanReview,
  sessions: readonly Pick<WorkoutSession, 'date' | 'templateId' | 'status' | 'exercises' | 'reentry' | 'deload'>[],
  boundary: DayBoundary,
): number {
  const counts = new Map(review.templateIds.map((id) => [id, 0]));
  for (const s of sessions) {
    if (s.status !== 'completed' || s.reentry || s.deload || s.exercises.length === 0) continue;
    if (!s.templateId || !counts.has(s.templateId)) continue;
    if (dayKeyAt(s.date, boundary) < review.since) continue;
    counts.set(s.templateId, counts.get(s.templateId)! + 1);
  }
  return Math.min(...counts.values());
}

/** The review card, when it is due and not dismissed. */
export function reviewDue(
  plan: HomePlan | null,
  sessions: Parameters<typeof reviewRotations>[1],
  boundary: DayBoundary,
): HomePlanReview | null {
  const rv = plan?.review;
  if (!rv || rv.dismissedAt) return null;
  return reviewRotations(rv, sessions, boundary) >= rv.afterRotations ? rv : null;
}
