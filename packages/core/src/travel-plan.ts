/**
 * A trip's planned sessions (owner, 2026-11-02: Bolivia, Haven Gym + hotel days).
 *
 * The plan lives on the travel period (`TravelPeriod.plan`), so it needs no rules
 * change and is gone when the trip is. It says what is coming, nothing more: the
 * streak counts logged days and nothing counts planned sessions, so a session
 * that did not happen is "skipped", never "missed", and costs nothing (ADR-0048).
 *
 * Pure; no I/O, no clock — `today` is passed in.
 */
import { addDays, calendarDateKey, parseYmd } from './date';
import { dayKeyAt, type DayBoundary } from './day-boundary';
import type { WorkoutSession } from './workout';

export interface TravelPlanEntry {
  /** First day it can happen, YYYY-MM-DD. */
  from: string;
  /** Last day it can happen, inclusive. `from` for a fixed day; later for "any
   *  day this week" or "Wed or Thu". */
  to: string;
  kind: 'session' | 'rest' | 'note';
  /** What the card says ("Travel C"). */
  label: string;
  /** The template a `session` entry runs: what marks it done. */
  templateId?: string;
  note?: string;
}

export type TravelPlanStatus = 'done' | 'due' | 'upcoming' | 'skipped' | 'rest' | 'note';

export interface TravelWeekRow extends TravelPlanEntry {
  status: TravelPlanStatus;
}

export interface TravelWeek {
  /** The Monday of `today`'s week. */
  start: string;
  /** Its Sunday. */
  end: string;
  /** The entries that touch the week, soonest first. */
  rows: TravelWeekRow[];
  /** The first session still open at or after `today`, this week or later. */
  next: TravelPlanEntry | null;
}

/** Rules cap the trip list, not what is inside it; extra entries are dropped. */
export const MAX_TRAVEL_PLAN_ENTRIES = 40;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const isYmd = (v: unknown): v is string => typeof v === 'string' && YMD.test(v) && !Number.isNaN(parseYmd(v).getTime());

/** Well-formed entries only, soonest first. A malformed entry is dropped, never
 *  repaired (the `travelPeriodsOf` rule). */
export function sanitizeTravelPlan(raw: unknown): TravelPlanEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: TravelPlanEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    if (!isYmd(r['from']) || !isYmd(r['to']) || r['from'] > r['to']) continue;
    if (r['kind'] !== 'session' && r['kind'] !== 'rest' && r['kind'] !== 'note') continue;
    if (typeof r['label'] !== 'string' || !r['label'].trim()) continue;
    out.push({
      from: r['from'],
      to: r['to'],
      kind: r['kind'],
      label: r['label'].trim(),
      ...(typeof r['templateId'] === 'string' && r['templateId'] ? { templateId: r['templateId'] } : {}),
      ...(typeof r['note'] === 'string' && r['note'].trim() ? { note: r['note'].trim() } : {}),
    });
  }
  return out.sort(byDate).slice(0, MAX_TRAVEL_PLAN_ENTRIES);
}

const byDate = (a: TravelPlanEntry, b: TravelPlanEntry) => (a.from < b.from ? -1 : a.from > b.from ? 1 : a.to < b.to ? -1 : a.to > b.to ? 1 : 0);

/** The Monday and Sunday around `key`. */
function weekOf(key: string): { start: string; end: string } {
  const day = parseYmd(key);
  const monday = addDays(day, -((day.getDay() + 6) % 7));
  return { start: calendarDateKey(monday), end: calendarDateKey(addDays(monday, 6)) };
}

/**
 * The week around `today` and the next planned session. An entry is done by a
 * completed session of its template from its first day to the end of its last
 * day's week: Travel C trained Tuesday instead of Monday is Travel C done.
 */
export function travelWeek(
  plan: readonly TravelPlanEntry[],
  today: string,
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'templateId'>[],
  boundary: DayBoundary,
): TravelWeek {
  const { start, end } = weekOf(today);
  const trained = sessions.filter((s) => s.status === 'completed' && s.templateId);
  const isDone = (e: TravelPlanEntry) => {
    const until = weekOf(e.to).end;
    return trained.some((s) => {
      if (s.templateId !== e.templateId) return false;
      const k = dayKeyAt(s.date, boundary);
      return k >= e.from && k <= until;
    });
  };
  const statusOf = (e: TravelPlanEntry): TravelPlanStatus => {
    if (e.kind !== 'session') return e.kind;
    if (isDone(e)) return 'done';
    if (e.to < today) return 'skipped';
    return e.from <= today ? 'due' : 'upcoming';
  };
  const ordered = [...plan].sort(byDate);
  return {
    start,
    end,
    rows: ordered.filter((e) => e.from <= end && e.to >= start).map((e) => ({ ...e, status: statusOf(e) })),
    next: ordered.find((e) => e.kind === 'session' && e.to >= today && !isDone(e)) ?? null,
  };
}

/**
 * Back-to-back gym days: the lift's gym was also trained the day before, so
 * isolations go to RIR 1 today (owner, non-blocking). Read from the session rows
 * because a session carries no template.
 */
export function isBackToBackGymDay(
  session: { date: Date; exercises: readonly { awayGym?: string }[] },
  sessions: readonly Pick<WorkoutSession, 'status' | 'date' | 'exercises'>[],
  boundary: DayBoundary,
): boolean {
  const gym = session.exercises.find((e) => e.awayGym)?.awayGym;
  if (!gym) return false;
  const yesterday = calendarDateKey(addDays(parseYmd(dayKeyAt(session.date, boundary)), -1));
  return sessions.some((s) => s.status === 'completed' && dayKeyAt(s.date, boundary) === yesterday && s.exercises.some((e) => e.awayGym === gym));
}

/**
 * The last session at this gym ran its calibration past the target: every
 * logged calibration activation at RIR 0 where RIR 2 was asked (owner,
 * 2026-11-04 — the first Haven session). The next session at the gym shows a
 * non-blocking note: compounds at RIR 1–2 at altitude. It reads only the
 * LATEST completed session at the gym, so it lapses on its own once a session
 * there is logged to target. The data is never changed.
 */
export function calibrationRanHot(
  session: { id?: string; date: Date; exercises: readonly { awayGym?: string }[] },
  sessions: readonly Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises'>[],
): boolean {
  return calibrationRanHotOn(session, sessions) != null;
}

/** {@link calibrationRanHot}, answered with the day it happened (the date of
 *  that last session at the gym) — "you logged RIR 0 on 11/4". Null when not. */
export function calibrationRanHotOn(
  session: { id?: string; date: Date; exercises: readonly { awayGym?: string }[] },
  sessions: readonly Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises'>[],
): Date | null {
  const gym = session.exercises.find((e) => e.awayGym)?.awayGym;
  if (!gym) return null;
  const last = sessions
    .filter((s) => s.status === 'completed' && s.id !== session.id && s.date.getTime() < session.date.getTime() && s.exercises.some((e) => e.awayGym === gym))
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0];
  if (!last) return null;
  const reads = last.exercises
    .filter((e) => e.calibration)
    .flatMap((e) => e.sets.filter((x) => x.kind === 'activation' && x.reps != null && x.rir != null));
  return reads.length > 0 && reads.every((x) => x.rir === 0) ? last.date : null;
}
