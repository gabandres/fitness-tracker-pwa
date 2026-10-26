/**
 * The travel "maintenance check" (Trends, 2026-10-26): is the trip's training
 * enough to keep what was built? About a third of the usual weekly volume per
 * muscle maintains muscle for a few weeks, so each muscle is compared with a
 * third of its own normal.
 *
 * - **Normal**: hard working sets per muscle (fractional — a primary set 1, a
 *   secondary ½, `volume-credits.ts`) per week over the
 *   {@link BASELINE_DAYS} before the trip.
 * - **This week**: the same count over the last 7 days, never reaching back
 *   before the trip's first day.
 *
 * A muscle with no normal volume is left out — there is nothing to maintain
 * it against. Pure; no clock.
 */
import { dayRange, type DayBoundary } from './day-boundary';
import type { DateKey } from './date';
import type { TravelPeriod } from './travel';
import { hardSetsBetween, type VolumeMuscle } from './volume-credits';

/** A third of normal (owner, 2026-10-26: "~1/3 of his normal"). */
export const MAINTENANCE_FRACTION = 1 / 3;
/** The pre-trip window the normal is read from. */
export const BASELINE_DAYS = 28;

const DAY_MS = 86_400_000;

export interface MaintenanceCheckRow {
  muscle: VolumeMuscle;
  /** Fractional hard sets in the current window. */
  thisWeek: number;
  /** Fractional hard sets per week before the trip. */
  normalWeekly: number;
  /** `normalWeekly × MAINTENANCE_FRACTION`. */
  needed: number;
  ok: boolean;
}

export interface MaintenanceCheck {
  rows: MaintenanceCheckRow[];
  /** The current window's first day — the trip's start until a week in. */
  windowFrom: Date;
  /** Whole days in the current window (≤ 7). */
  windowDays: number;
  /** Muscles at or above a third of normal. */
  okCount: number;
}

type Sessions = Parameters<typeof hardSetsBetween>[0];
type Catalog = Parameters<typeof hardSetsBetween>[1];

export function travelMaintenanceCheck(args: {
  sessions: Sessions;
  catalog: Catalog;
  period: TravelPeriod;
  now: Date;
  boundary: DayBoundary;
}): MaintenanceCheck {
  const { sessions, catalog, period, now, boundary } = args;
  const tripStart = dayRange(period.start as DateKey, boundary).start.getTime();
  const baseline = hardSetsBetween(sessions, catalog, tripStart - BASELINE_DAYS * DAY_MS, tripStart - 1);
  const fromMs = Math.max(tripStart, now.getTime() - 7 * DAY_MS);
  const current = hardSetsBetween(sessions, catalog, fromMs, now.getTime());
  const cur = new Map(current.week.map((m) => [m.muscle, m.fractional]));
  const weeks = BASELINE_DAYS / 7;
  const rows: MaintenanceCheckRow[] = [];
  for (const m of baseline.week) {
    const normalWeekly = Math.round((m.fractional / weeks) * 10) / 10;
    if (normalWeekly <= 0) continue;
    const needed = Math.round(normalWeekly * MAINTENANCE_FRACTION * 10) / 10;
    const thisWeek = cur.get(m.muscle) ?? 0;
    rows.push({ muscle: m.muscle, thisWeek, normalWeekly, needed, ok: thisWeek >= needed });
  }
  // Short first: the muscles furthest from a third of normal lead.
  rows.sort((a, b) => a.thisWeek / a.needed - b.thisWeek / b.needed);
  return {
    rows,
    windowFrom: new Date(fromMs),
    windowDays: Math.max(1, Math.ceil((now.getTime() - fromMs) / DAY_MS)),
    okCount: rows.filter((r) => r.ok).length,
  };
}
