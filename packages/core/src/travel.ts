/**
 * Travel mode (2026-10-26, owner: Bolivia 2026-10-31 → 2026-11-18).
 *
 * A **travel period** is a dated range the user is away from their scale and
 * their kitchen: intake is eyeballed and there are no weigh-ins worth fitting.
 * It is stored on the profile as `travelPeriods` — a list, kept forever, because
 * a past trip's days must stay out of the maintenance fit for as long as the
 * 42–84-day window can reach them. Rules can only say "a list of ≤ 24"
 * (`firestore.rules`, the `dayBoundary` precedent), so every reader goes
 * through {@link travelPeriodsOf}, which drops malformed entries.
 *
 * What a period changes, each in one place:
 *
 * - **Maintenance** (`calculateTdee`): travel days' intake and weigh-ins never
 *   enter the fit. During the trip the estimate is FROZEN at its value as of
 *   the trip's first day (so the last pre-trip day counts in full); after the
 *   trip it stays frozen — "rebuilding after travel" — until
 *   {@link TRAVEL_REBUILD_DAYS} complete post-travel days exist, then the
 *   normal fit resumes over non-travel days only.
 * - **Weight**: a weigh-in on a travel day is kept and shown, but it is not
 *   part of the trend line or the 7-day average ({@link withoutTravelWeights}).
 *   The app writes it with {@link TRAVEL_SCALE_NOTE}.
 * - **Reminders**: no weigh-in nudge while a trip is active; it resumes on its
 *   own after the trip.
 * - **Train**: a gym session during a trip after ≥ 7 days without lifting, and
 *   the first session of each template after the trip, are re-entry sessions
 *   (`reentry.ts`).
 *
 * Auto-exit is a property of the dates: nothing writes "travel ended".
 *
 * Pure; no I/O, no clock — every function takes the day it is asked about.
 */
import type { DailyLog } from './types';
import { addDays, calendarDateKey, parseYmd, type DateKey } from './date';
import { dayKeyAt, type DayBoundary } from './day-boundary';

/** A high-altitude leg of a trip: shown on Today for its first few days. */
export interface TravelAltitude {
  /** "Cochabamba". */
  place: string;
  /** Metres above sea level. */
  meters: number;
  /** The day the user arrives there (YYYY-MM-DD). */
  arrival: string;
}

export interface TravelPeriod {
  /** First travel day, YYYY-MM-DD, inclusive. */
  start: string;
  /** Last travel day, YYYY-MM-DD, inclusive. The day after is the first day home. */
  end: string;
  /** "Bolivia" — what the Today banner says. */
  label?: string;
  /** The user's usual daily steps, for "steps vs usual" while away. */
  usualSteps?: number;
  altitude?: TravelAltitude;
}

/** Post-travel complete days before the maintenance fit runs again — the
 *  estimator's own minimum (`MEASURED_MIN_DAYS`), restated here so the two
 *  read as one rule; `travel.test.ts` pins them equal. */
export const TRAVEL_REBUILD_DAYS = 14;
/** Days the altitude note shows, counting the arrival day. */
export const ALTITUDE_NOTE_DAYS = 3;
/** When a period names no usual step count. */
export const DEFAULT_USUAL_STEPS = 6000;
/** Stored on a travel-day weigh-in. */
export const TRAVEL_SCALE_NOTE = 'travel scale — not comparable';
/** Rules cap the list at this length; extra entries are dropped on read. */
export const MAX_TRAVEL_PERIODS = 24;
/** Label length, matched by the rules-independent sanitizer. */
export const TRAVEL_LABEL_MAX = 40;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(parseYmd(v).getTime());

/**
 * The profile's travel periods, cleaned: well-formed keys only, `start ≤ end`,
 * sorted by start, at most {@link MAX_TRAVEL_PERIODS}. A malformed entry is
 * dropped, never repaired — a guessed date would silently exclude the wrong
 * days from the fit.
 */
export function travelPeriodsOf(profile: { travelPeriods?: unknown } | null | undefined): TravelPeriod[] {
  const raw = profile?.travelPeriods;
  if (!Array.isArray(raw)) return [];
  const out: TravelPeriod[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    if (!isYmd(r.start) || !isYmd(r.end) || r.start > r.end) continue;
    const period: TravelPeriod = { start: r.start, end: r.end };
    if (typeof r.label === 'string' && r.label.trim()) period.label = r.label.trim().slice(0, TRAVEL_LABEL_MAX);
    if (typeof r.usualSteps === 'number' && Number.isFinite(r.usualSteps) && r.usualSteps > 0 && r.usualSteps <= 100_000) {
      period.usualSteps = Math.round(r.usualSteps);
    }
    const a = r.altitude as Record<string, unknown> | undefined;
    if (
      a && typeof a === 'object' && typeof a.place === 'string' && a.place.trim()
      && typeof a.meters === 'number' && a.meters > 0 && a.meters < 9000 && isYmd(a.arrival)
    ) {
      period.altitude = { place: a.place.trim().slice(0, TRAVEL_LABEL_MAX), meters: Math.round(a.meters), arrival: a.arrival };
    }
    out.push(period);
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0)).slice(0, MAX_TRAVEL_PERIODS);
}

/** Whether `key` (YYYY-MM-DD) falls inside any period. */
export function isTravelDay(key: string, periods: readonly TravelPeriod[]): boolean {
  for (const p of periods) if (key >= p.start && key <= p.end) return true;
  return false;
}

/** The period `today` is inside, or null. */
export function activeTravel(today: string, periods: readonly TravelPeriod[]): TravelPeriod | null {
  for (const p of periods) if (today >= p.start && today <= p.end) return p;
  return null;
}

/** The trip that governs `today`: the latest one that has started. Null
 *  before the first trip. */
export function governingTravel(today: string, periods: readonly TravelPeriod[]): TravelPeriod | null {
  let found: TravelPeriod | null = null;
  for (const p of periods) if (p.start <= today) found = p;
  return found;
}

/** The latest trip that ended before `today`, or null. */
export function lastEndedTravel(today: string, periods: readonly TravelPeriod[]): TravelPeriod | null {
  let found: TravelPeriod | null = null;
  for (const p of periods) if (p.end < today && (!found || p.end > found.end)) found = p;
  return found;
}

/** The day before `key`, as a key. */
export function dayBefore(key: string): DateKey {
  return calendarDateKey(addDays(parseYmd(key), -1));
}

/** Day `n` of a trip leg starting at `from` (0 = `from` itself). */
function dayIndex(from: string, key: string): number {
  return Math.round((parseYmd(key).getTime() - parseYmd(from).getTime()) / 86_400_000);
}

/**
 * The altitude note for `today`, or null: shown on the arrival day and the
 * {@link ALTITUDE_NOTE_DAYS} − 1 days after it, and only inside the trip.
 */
export function altitudeNote(
  today: string,
  period: TravelPeriod | null,
): { place: string; meters: number; day: number } | null {
  const a = period?.altitude;
  if (!period || !a) return null;
  if (today < period.start || today > period.end) return null;
  const day = dayIndex(a.arrival, today);
  if (day < 0 || day >= ALTITUDE_NOTE_DAYS) return null;
  return { place: a.place, meters: a.meters, day: day + 1 };
}

/** Today's steps against the trip's usual count. */
export function stepsVsUsual(steps: number | null | undefined, period: TravelPeriod): {
  steps: number | null;
  usual: number;
  /** steps / usual, or null without a step count. */
  ratio: number | null;
} {
  const usual = period.usualSteps ?? DEFAULT_USUAL_STEPS;
  const s = typeof steps === 'number' && Number.isFinite(steps) ? Math.round(steps) : null;
  return { steps: s, usual, ratio: s == null ? null : s / usual };
}

/** The weigh-ins outside every period — what the trend line and the 7-day
 *  average read. Returns the input untouched when there are no periods. */
export function withoutTravelWeights<T>(
  weights: Readonly<Record<string, T>>,
  periods: readonly TravelPeriod[],
): Record<string, T> {
  if (periods.length === 0) return weights as Record<string, T>;
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(weights)) if (!isTravelDay(k, periods)) out[k] = v;
  return out;
}

/** The log rows outside every period, bucketed by the user's day. */
export function withoutTravelLogs<L extends Pick<DailyLog, 'date'>>(
  logs: readonly L[],
  periods: readonly TravelPeriod[],
  boundary: DayBoundary,
): L[] {
  if (periods.length === 0) return [...logs];
  return logs.filter((l) => !isTravelDay(dayKeyAt(l.date, boundary), periods));
}

/**
 * Why the maintenance estimate is not the live fit, when a trip is the reason.
 *
 * - `frozen`: inside the trip; the value is the estimate as of `start`
 *   (`frozenAsOf` = the last day before the trip, which counts in full).
 * - `rebuilding`: home, with fewer than `needed` complete post-travel days;
 *   the frozen value holds until then.
 */
export type TravelHold =
  | { state: 'frozen'; start: string; end: string; frozenAsOf: string; label?: string }
  | { state: 'rebuilding'; start: string; end: string; frozenAsOf: string; valid: number; needed: number; label?: string };
