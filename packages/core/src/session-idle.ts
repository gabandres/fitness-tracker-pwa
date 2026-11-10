/**
 * A workout timer that stops itself (owner, 2026-11-10).
 *
 * The session clock runs from Start to Finish, and twice in a week the lifter
 * forgot Finish: 11/4 saved 897 min, 11/10 saved 178 min. Both were fixed by
 * hand from the one thing that knew when training stopped — the last set. This
 * module makes that the rule.
 *
 * ## What it reads
 *
 * `WorkoutSet.loggedAt`, stamped by the session reducer the moment a set is
 * ticked done (`applySessionAction` with a clock). Sets logged before
 * 2026-11-10 have none and are left as they are; a session with logged sets
 * but no usable times falls back to ASKING (rule 10), never to guessing.
 *
 * ## The rules
 *
 * 1. **Idle prompt** — no set for {@link IDLE_PROMPT_MIN} min during an active
 *    session: "Still training?" (a local notification, an in-app ask when the
 *    app is open). "Keep going" restarts the idle clock.
 * 2. **Auto-end** — no answer within {@link IDLE_GRACE_MIN} more minutes: the
 *    session ends at the last logged set + {@link AUTO_END_PAD_MIN} min. The
 *    end time is computed from the set, never from when the app noticed, so a
 *    phone that was suspended for an hour ends it at the same minute.
 * 3. **Stale on open** — the app opened on a session open longer than
 *    {@link STALE_OPEN_MIN} min: "End session at last set (HH:MM)?" — End /
 *    Keep going / Enter duration.
 * 4. **Hard cap** — no session saves more than {@link DURATION_CAP_MIN} min
 *    without the lifter confirming it. Unconfirmed, it saves last set + 5 min
 *    and says so ("auto-capped").
 * 5. **No times** — sets without times, or all ticked within moments of each
 *    other at the end (bulk logging): ask for the length at Finish, suggesting
 *    {@link UNTIMED_DEFAULT_MIN} min.
 *
 * Pure: every function takes `now`. The notification, the timers and the
 * prompts are the app's (`useSessionIdle`).
 */

import { clockStart } from './session-pause';
import { DEFAULT_LOG_STYLE, isLoggedSet, type WorkoutSession } from './workout';

/** No set for this long → "Still training?". */
export const IDLE_PROMPT_MIN = 20;
/** Unanswered for this much longer → the session ends by itself. */
export const IDLE_GRACE_MIN = 10;
/** An ended session's last set is followed by this much (re-racking, a sip of
 *  water) — the end is never the instant the last set was ticked. */
export const AUTO_END_PAD_MIN = 5;
/** Opening the app on a session open this long asks whether it is over. */
export const STALE_OPEN_MIN = 120;
/** No session saves more than this many minutes without the lifter's say-so. */
export const DURATION_CAP_MIN = 150;
/** The length suggested when no set carries a time. */
export const UNTIMED_DEFAULT_MIN = 60;
/** Bulk logging: at least this many sets, all ticked inside {@link BULK_SPAN_MIN}. */
export const BULK_MIN_SETS = 6;
export const BULK_SPAN_MIN = 3;

const MIN = 60_000;

type SessionTimes = Pick<WorkoutSession, 'date' | 'segments' | 'exercises'>;

/** `loggedAt` as a Date, or undefined when absent or unreadable. */
function timeOf(v: unknown): Date | undefined {
  if (v == null) return undefined;
  const d = v instanceof Date ? v : new Date(v as string);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

/** Every logged set's time, and how many logged sets have none. */
function loggedTimes(s: Pick<WorkoutSession, 'exercises'>): { times: Date[]; untimed: number } {
  const times: Date[] = [];
  let untimed = 0;
  for (const ex of s.exercises) {
    const style = ex.logStyle ?? DEFAULT_LOG_STYLE;
    for (const set of ex.sets) {
      if (!isLoggedSet(set, style)) continue;
      const at = timeOf(set.loggedAt);
      if (at) times.push(at);
      else untimed += 1;
    }
  }
  return { times, untimed };
}

/** When the last logged set was ticked, if any set carries a time. */
export function lastLoggedAt(s: Pick<WorkoutSession, 'exercises'>): Date | undefined {
  const { times } = loggedTimes(s);
  return times.length ? new Date(Math.max(...times.map((d) => d.getTime()))) : undefined;
}

/** Why a session's set times cannot place its end: `none` (no logged set
 *  carries one — every session before 2026-11-10), `partial` (some logged sets
 *  have none), `bulk` (all ticked inside a few minutes — logged after the
 *  fact). Undefined when they can. */
export type UntimedReason = 'none' | 'partial' | 'bulk';

export function untimedReason(s: Pick<WorkoutSession, 'exercises'>): UntimedReason | undefined {
  const { times, untimed } = loggedTimes(s);
  if (times.length === 0) return 'none';
  if (untimed > 0) return 'partial';
  if (times.length >= BULK_MIN_SETS) {
    const ms = times.map((d) => d.getTime());
    if (Math.max(...ms) - Math.min(...ms) < BULK_SPAN_MIN * MIN) return 'bulk';
  }
  return undefined;
}

/** The last sign the lifter was training: the latest of the open part's start
 *  (the session's start, or the last Resume), the last logged set, and a
 *  "Keep going" answer (`keepGoingAt`). */
export function lastActivityAt(s: SessionTimes, keepGoingAt?: Date): Date {
  const parts = s.segments && s.segments.length > 0 ? s.segments : [{ start: s.date }];
  const open = parts[parts.length - 1].start;
  const ms = [open.getTime(), lastLoggedAt(s)?.getTime() ?? 0, keepGoingAt?.getTime() ?? 0];
  return new Date(Math.max(...ms));
}

/** Where an ended session stops: its last logged set + {@link AUTO_END_PAD_MIN},
 *  and the minutes that makes from the clock's start. Undefined when the set
 *  times cannot say (see {@link untimedReason}). */
export interface EndAtLastSet {
  lastSetAt: Date;
  endAt: Date;
  durationMin: number;
}

export function endAtLastSet(s: SessionTimes): EndAtLastSet | undefined {
  if (untimedReason(s)) return undefined;
  const lastSetAt = lastLoggedAt(s)!;
  const endAt = new Date(lastSetAt.getTime() + AUTO_END_PAD_MIN * MIN);
  const durationMin = Math.max(1, Math.round((endAt.getTime() - clockStart(s).getTime()) / MIN));
  return { lastSetAt, endAt, durationMin };
}

export type IdleState =
  /** Training, or not idle long enough to ask. `promptAt` is when it will be. */
  | { kind: 'active'; promptAt: Date }
  /** Ask "Still training?"; with no answer it ends at `autoEndAt`. */
  | { kind: 'prompt'; promptAt: Date; autoEndAt: Date }
  /** The grace ran out: end it here. */
  | { kind: 'auto-end'; end: EndAtLastSet }
  /** Idle past the grace, but the set times cannot place the end — ask, never
   *  guess (rule 10). */
  | { kind: 'ask'; promptAt: Date };

/**
 * Where an ACTIVE session stands on the idle rules at `now`. `keepGoingAt` is
 * the lifter's last "Keep going" (the app keeps it per session, on the device).
 */
export function idleState(s: SessionTimes, now: Date, keepGoingAt?: Date): IdleState {
  const last = lastActivityAt(s, keepGoingAt);
  const promptAt = new Date(last.getTime() + IDLE_PROMPT_MIN * MIN);
  const autoEndAt = new Date(promptAt.getTime() + IDLE_GRACE_MIN * MIN);
  if (now < promptAt) return { kind: 'active', promptAt };
  if (now < autoEndAt) return { kind: 'prompt', promptAt, autoEndAt };
  const end = endAtLastSet(s);
  // Nothing logged since "Keep going" or since the last Resume: the last set
  // is not where THIS stretch ended, so ending there would erase time the
  // lifter said was training. Ask instead.
  if (!end || end.lastSetAt.getTime() < last.getTime()) return { kind: 'ask', promptAt };
  return { kind: 'auto-end', end };
}

/** Rule 3: the app opened on a session open longer than {@link STALE_OPEN_MIN}.
 *  `askedAt` is the last time this session was asked about (Keep going): it is
 *  not asked again until another {@link STALE_OPEN_MIN} has passed. */
export function isStaleOpen(s: Pick<WorkoutSession, 'date' | 'segments' | 'status'>, now: Date, askedAt?: Date): boolean {
  if (s.status !== 'active') return false;
  const since = Math.max(clockStart(s).getTime(), askedAt?.getTime() ?? 0);
  return now.getTime() - since > STALE_OPEN_MIN * MIN;
}

/** What Finish offers for the session's length. */
export interface DurationCall {
  /** The clock's minutes, start (or the parts) to now. */
  timerMin: number;
  /** Over {@link DURATION_CAP_MIN}: saving the timer needs a confirm. */
  overCap: boolean;
  /** The set times cannot place the end (rule 10): ask for the length. */
  untimed?: UntimedReason;
  /** What to pre-fill when asking: last set + 5, or {@link UNTIMED_DEFAULT_MIN}. */
  suggestedMin: number;
  /** Present when the suggestion is the last set + 5. */
  lastSetAt?: Date;
  /** Ask for the length at all: over the cap, or no usable set times. */
  ask: boolean;
}

export function finishDurationCall(s: SessionTimes, timerMin: number): DurationCall {
  const end = endAtLastSet(s);
  const untimed = untimedReason(s);
  const overCap = timerMin > DURATION_CAP_MIN;
  return {
    timerMin,
    overCap,
    ...(untimed ? { untimed } : {}),
    suggestedMin: end ? Math.min(end.durationMin, DURATION_CAP_MIN) : UNTIMED_DEFAULT_MIN,
    ...(end ? { lastSetAt: end.lastSetAt } : {}),
    ask: overCap || untimed != null,
  };
}

/** How a saved length came to differ from the clock — the session's
 *  `durationNote` (exported in the 'workout' row's notes). */
export type DurationSource =
  /** Rule 2: ended by itself after the unanswered idle prompt. */
  | 'auto-ended'
  /** Rule 4: over the cap and not confirmed — saved at last set + 5. */
  | 'auto-capped'
  /** Rule 3's "End": the lifter ended it at the last set. */
  | 'ended-at-last-set'
  /** The lifter typed the length. */
  | 'entered'
  /** The lifter confirmed a session over the cap. */
  | 'confirmed-long';

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

/** The `durationNote` for a length that is not the clock's (≤ 300 chars, the
 *  rules' cap). Undefined when the clock's own number is saved unremarked. */
export function durationNoteFor(source: DurationSource, x: { timerMin: number; savedMin: number; lastSetAt?: Date }): string | undefined {
  const last = x.lastSetAt ? `last set ${hhmm(x.lastSetAt)} + ${AUTO_END_PAD_MIN} min` : undefined;
  switch (source) {
    case 'auto-ended':
      return `auto-ended: ${x.timerMin} → ${x.savedMin} min (no set for ${IDLE_PROMPT_MIN} min, "Still training?" unanswered for ${IDLE_GRACE_MIN}; ${last ?? 'no set time'})`;
    case 'auto-capped':
      return `auto-capped: ${x.timerMin} → ${x.savedMin} min (over ${DURATION_CAP_MIN} min, not confirmed; ${last ?? `default ${UNTIMED_DEFAULT_MIN} min, no set times`})`;
    case 'ended-at-last-set':
      return `ended at last set: ${x.timerMin} → ${x.savedMin} min (${last ?? 'no set time'}; user-confirmed)`;
    case 'entered':
      return x.savedMin === x.timerMin ? undefined : `user-entered: ${x.timerMin} → ${x.savedMin} min`;
    case 'confirmed-long':
      return `long session confirmed: ${x.savedMin} min`;
  }
}

/**
 * The backstop every finish goes through: a length over the cap without the
 * lifter's confirm is replaced by the suggestion and flagged "auto-capped".
 * Anything else passes as it is.
 */
export function capDuration(
  s: SessionTimes,
  durationMin: number | undefined,
  confirmedLong: boolean,
): { durationMin: number | undefined; note?: string } {
  if (durationMin == null || durationMin <= DURATION_CAP_MIN || confirmedLong) return { durationMin };
  const call = finishDurationCall(s, durationMin);
  return {
    durationMin: call.suggestedMin,
    note: durationNoteFor('auto-capped', { timerMin: durationMin, savedMin: call.suggestedMin, lastSetAt: call.lastSetAt }),
  };
}
