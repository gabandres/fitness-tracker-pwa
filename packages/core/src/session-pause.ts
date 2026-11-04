/**
 * Pause / resume one workout (owner, 2026-11-04): a session stopped partway is
 * finished later the same day in the SAME record — same date, same template,
 * same order and superset grouping — instead of a second session that would
 * split one workout's volume and confuse the engine.
 *
 * ## The model
 *
 * - `status: 'paused'` is stored. Every reader that means "a workout that
 *   happened" filters `status === 'completed'`, so a paused session is out of
 *   history, volume, PRs and the engine until it is finished or closed. Its
 *   unlogged scaffold sets are KEPT (a finish drops them), because they are
 *   what the resume continues from.
 * - `segments` is the active time: one `{ start, end }` per part. The first
 *   part starts at the session's `date`. `durationMin` is their sum, so the gap
 *   between parts is never counted as training.
 * - A set is stamped with the 1-based `segment` it was logged in when its part
 *   closes (pause or finish). A set without one is part 1.
 * - **Partial is a COMPLETED session with `partial` on it**, not a fourth
 *   status. That is what makes "count only completed sets" and "skipped lifts
 *   are not regressions" hold without touching any reader: the session's
 *   unlogged sets and untouched lifts are dropped exactly as a finish drops
 *   them, so volume counts only what was done, and a skipped lift simply has
 *   no new entry for the engine to read. `partial.skipped` names them.
 *
 * ## The resume window
 *
 * A paused session can be resumed until {@link resumeDeadline}: the end of the
 * session's own day (the user's day boundary — 23:59 local on a midnight
 * boundary), and never more than 24 h after it began. Past that it is closed
 * as partial by whichever screen sees it first ({@link closeAsPartial}). A part
 * RESUMED before the deadline may run past midnight; the session's `date`
 * never moves.
 */

import { dayKeyAt, dayRange, type DayBoundary } from './day-boundary';
import { supersetFlow } from './superset';
import { dropEmptyExercises } from './train-view';
import { normalizeClusterGroups } from './cluster-groups';
import {
  DEFAULT_LOG_STYLE,
  fillMissingClusterLoads,
  isLoggedSet,
  type SessionExercise,
  type WorkoutSession,
} from './workout';

/** One stretch of active training inside a session. `end` is absent on the
 *  part in progress. */
export interface SessionSegment {
  start: Date;
  end?: Date;
}

/** A session closed before all of it was done (see the module header). */
export interface PartialClose {
  /** When it was closed. */
  closedAt: Date;
  /** Steps never started, in the order they would have run ("Skull Crusher",
   *  "DB Lateral Raise c2"). */
  skipped: string[];
}

/** The longest a session may stay open, start of part 1 to the end of the last
 *  part, hours. */
export const MAX_SESSION_SPAN_HOURS = 24;

/** The export's word for a session (owner spec: complete / paused / partial). */
export type SessionStatusLabel = 'complete' | 'paused' | 'partial' | 'active';

export function sessionStatusLabel(s: Pick<WorkoutSession, 'status' | 'partial'>): SessionStatusLabel {
  if (s.status === 'paused') return 'paused';
  if (s.status === 'active') return 'active';
  return s.partial ? 'partial' : 'complete';
}

/** The parts as stored, or the one implied part of a session that never paused. */
export function segmentsOf(s: Pick<WorkoutSession, 'date' | 'segments'>): SessionSegment[] {
  return s.segments && s.segments.length > 0 ? s.segments : [{ start: s.date }];
}

/** Whole minutes of active training: the sum of the parts, an open part
 *  counted up to `now`. Never the gap between parts. */
export function activeMinutes(segments: readonly SessionSegment[], now: Date): number {
  let ms = 0;
  for (const g of segments) ms += Math.max(0, (g.end ?? now).getTime() - g.start.getTime());
  return Math.round(ms / 60_000);
}

/** The 1-based part in progress (or the last one, on a paused session). */
export function currentSegmentIndex(s: Pick<WorkoutSession, 'date' | 'segments'>): number {
  return segmentsOf(s).length;
}

/** The last moment a paused session can be resumed. */
export function resumeDeadline(s: Pick<WorkoutSession, 'date'>, boundary: DayBoundary): Date {
  const dayEnd = dayRange(dayKeyAt(s.date, boundary), boundary).end;
  const cap = new Date(s.date.getTime() + MAX_SESSION_SPAN_HOURS * 3_600_000);
  return new Date(Math.min(dayEnd.getTime() - 1, cap.getTime()));
}

export function canResume(s: Pick<WorkoutSession, 'status' | 'date'>, now: Date, boundary: DayBoundary): boolean {
  return s.status === 'paused' && now.getTime() <= resumeDeadline(s, boundary).getTime();
}

/** A paused session whose window has passed — to be closed as partial. */
export function isExpiredPause(s: Pick<WorkoutSession, 'status' | 'date'>, now: Date, boundary: DayBoundary): boolean {
  return s.status === 'paused' && now.getTime() > resumeDeadline(s, boundary).getTime();
}

/** Stamp every logged set that has no part yet with `segment`. */
function stampSets(exercises: SessionExercise[], segment: number): SessionExercise[] {
  return exercises.map((ex) => {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    if (!ex.sets.some((x) => x.segment == null && isLoggedSet(x, style))) return ex;
    return { ...ex, sets: ex.sets.map((x) => (x.segment == null && isLoggedSet(x, style) ? { ...x, segment } : x)) };
  });
}

/** Close the part in progress at `now`. */
function closeSegments(s: Pick<WorkoutSession, 'date' | 'segments'>, now: Date): SessionSegment[] {
  const parts = segmentsOf(s).map((g) => ({ ...g }));
  const last = parts[parts.length - 1];
  if (!last.end) {
    // Never longer than the span cap — a phone left on the bench overnight is
    // not a 9-hour part.
    const cap = new Date(s.date.getTime() + MAX_SESSION_SPAN_HOURS * 3_600_000);
    last.end = new Date(Math.max(last.start.getTime(), Math.min(now.getTime(), cap.getTime())));
  }
  return parts;
}

/** The session as Pause leaves it: the part closed, logged sets stamped with
 *  it, `durationMin` the active total. Unlogged sets stay for the resume. */
export function pausedSession(s: WorkoutSession, now: Date): WorkoutSession {
  const segments = closeSegments(s, now);
  return {
    ...s,
    status: 'paused',
    segments,
    exercises: stampSets(s.exercises, segments.length),
    durationMin: activeMinutes(segments, now),
  };
}

/** The session as Resume leaves it: active again, a new part open at `now`.
 *  Date, template, order and grouping are untouched. */
export function resumedSession(s: WorkoutSession, now: Date): WorkoutSession {
  return { ...s, status: 'active', segments: [...closeSegments(s, now), { start: now }] };
}

/**
 * What Finish writes for a session that was ever paused: the last part closed
 * and its sets stamped, `durationMin` the active total. A session that never
 * paused is returned as it was — its duration stays the caller's
 * start-to-finish interval.
 */
export function finishedSegments(s: WorkoutSession, now: Date): WorkoutSession {
  if (!s.segments || s.segments.length === 0) return s;
  const segments = closeSegments(s, now);
  return { ...s, segments, exercises: stampSets(s.exercises, segments.length), durationMin: activeMinutes(segments, now) };
}

/** A step of the template's order that has not been started. */
export interface RemainingStep {
  exerciseIndex: number;
  name: string;
  /** "C2" inside a superset. */
  label?: string;
  /** 1-based unit of the exercise ("cluster 2"), when it has more than one. */
  unit?: number;
  /** The unit ends in a drop set. */
  drop?: boolean;
}

/**
 * The steps of the session's flow (core `supersetFlow`: template order,
 * superset rounds interleaved) with no logged set — what "6 exercises left"
 * counts. A unit with some sets logged is in progress, not remaining.
 */
export function remainingSteps(s: Pick<WorkoutSession, 'exercises'>): RemainingStep[] {
  const flow = supersetFlow(s.exercises);
  const unitsPer = new Map<number, number>();
  for (const st of flow) unitsPer.set(st.exerciseIndex, (unitsPer.get(st.exerciseIndex) ?? 0) + 1);
  const out: RemainingStep[] = [];
  for (const st of flow) {
    const ex = s.exercises[st.exerciseIndex];
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    if (st.setIndices.some((i) => isLoggedSet(ex.sets[i], style))) continue;
    out.push({
      exerciseIndex: st.exerciseIndex,
      name: ex.name,
      ...(st.label ? { label: st.label } : {}),
      ...((unitsPer.get(st.exerciseIndex) ?? 0) > 1 ? { unit: st.unit + 1 } : {}),
      ...(st.setIndices.some((i) => ex.sets[i].kind === 'drop') ? { drop: true } : {}),
    });
  }
  return out;
}

/** "DB Lateral Raise c2 + drop" — a remaining step as one English line, for
 *  the export and `partial.skipped`. Screens localize from the fields. */
export function remainingStepText(r: RemainingStep): string {
  return `${r.label ? `${r.label} ` : ''}${r.name}${r.unit ? ` c${r.unit}` : ''}${r.drop ? ' + drop' : ''}`;
}

/**
 * Close a paused session as partial: completed, with only what was logged
 * (the finish's own pruning — loads healed, unlogged sets and untouched lifts
 * dropped, cluster numbers re-derived) and the steps it never reached named.
 * Its parts and duration are the ones Pause stored; the gap after the last
 * part is not training.
 */
export function closeAsPartial(s: WorkoutSession, now: Date): WorkoutSession {
  const skipped = remainingSteps(s).map(remainingStepText);
  const exercises = dropEmptyExercises(
    fillMissingClusterLoads(s.exercises).map((ex) => ({
      ...ex,
      sets: normalizeClusterGroups(ex.sets.filter((x) => isLoggedSet(x, ex.logStyle ?? DEFAULT_LOG_STYLE))),
    })),
  );
  const segments = segmentsOf(s);
  return {
    ...s,
    status: 'completed',
    exercises,
    segments,
    durationMin: s.durationMin ?? activeMinutes(segments, now),
    partial: { closedAt: now, skipped },
  };
}

/**
 * The instant a running clock should count from so it shows ACTIVE time only:
 * the open part's start, moved back by the parts already closed. The session's
 * `date` for one that never paused. What the elapsed clock, the Live Activity
 * and the widget read — none of them can sum parts themselves.
 */
export function clockStart(s: Pick<WorkoutSession, 'date' | 'segments'>): Date {
  if (!s.segments || s.segments.length === 0) return s.date;
  const open = s.segments[s.segments.length - 1];
  let closedMs = 0;
  for (const g of s.segments) if (g !== open && g.end) closedMs += Math.max(0, g.end.getTime() - g.start.getTime());
  return new Date(open.start.getTime() - closedMs);
}
