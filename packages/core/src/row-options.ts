/**
 * A template row's options (owner, 2026-11-05: the Travel C/D DB swaps, the
 * 11/5 carryover session, Stephanie's Day 2B):
 *
 * - **alternatives** — one-tap swaps ("Lat Pulldown → One-arm DB Row") for a
 *   busy machine or a missing cable. The swap changes the session row's
 *   `exerciseId`, so history follows the exercise actually done; the row it
 *   replaced becomes an alternative, so the swap can be undone.
 * - **optional** — a row the session can leave out. Leaving it out is not a
 *   skip: a partial close does not name it.
 * - **carryover** — clusters carried from an earlier session that did not
 *   reach them. A label only: the earlier session logged nothing for them, so
 *   weekly volume counts them once, here.
 * - **time cap** (template level) — past N active minutes, what to drop first.
 *
 * Template rows are not validated field-by-field by the rules (a list of ≤ 40),
 * so the row fields need no rules change; `timeCap` is a template key and does.
 * All of them ride {@link CARRIED_ROW_FIELDS} across an editor save. Pure.
 */
import type { LogStyle, PlannedSet, SessionExercise, SetKind, WorkoutSet } from './workout';

export interface RowAlternative {
  exerciseId: string;
  name: string;
  /** The alternative's own sets ("1 cluster per arm"); absent = the row's. */
  plannedSets?: PlannedSet[];
  /** Pounds. Absent = no pre-fill. */
  targetLoad?: number;
  cues?: string[];
  logStyle?: LogStyle;
  /** Shares its id with the home program (see `TemplateExercise.linkedHome`). */
  linkedHome?: boolean;
  /** "if the pulldown is busy". */
  note?: string;
}

export interface RowCarryover {
  /** The session day the clusters were carried from, YYYY-MM-DD. */
  from: string;
  /** How many of this row's clusters (or sets) are carried. */
  clusters: number;
}

export interface TimeCap {
  /** Active minutes after which the drop order shows. */
  minutes: number;
  /** What to drop, first first ("3rd lateral raise"). */
  drop: string[];
}

export const ALTERNATIVES_MAX = 4;

export function alternativesOf(raw: unknown): RowAlternative[] {
  if (!Array.isArray(raw)) return [];
  const out: RowAlternative[] = [];
  for (const a of raw) {
    if (!a || typeof a !== 'object') continue;
    const r = a as Record<string, unknown>;
    if (typeof r['exerciseId'] !== 'string' || !r['exerciseId'] || typeof r['name'] !== 'string' || !r['name']) continue;
    out.push(r as unknown as RowAlternative);
  }
  return out.slice(0, ALTERNATIVES_MAX);
}

export function timeCapOf(raw: unknown): TimeCap | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const minutes = r['minutes'];
  if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return null;
  const drop = Array.isArray(r['drop']) ? r['drop'].filter((x): x is string => typeof x === 'string' && !!x.trim()) : [];
  return drop.length ? { minutes, drop } : null;
}

/** Past the cap: the drop order shows. */
export function overTimeCap(cap: TimeCap | null | undefined, activeMinutes: number): boolean {
  return cap != null && activeMinutes > cap.minutes;
}

/** A row can be swapped while none of its sets is ticked. */
export function canSwap(ex: Pick<SessionExercise, 'sets' | 'alternatives'>): boolean {
  return (ex.alternatives?.length ?? 0) > 0 && !ex.sets.some((s) => s.done);
}

/**
 * The session row after a swap to `alt`. The row keeps its place, superset
 * group, rests, gym and unit; it takes the alternative's id, name, cues and
 * sets. The engine's frozen call belonged to the old lift, so it goes, and the
 * old lift becomes an alternative (first), so a second tap swaps back.
 * `calibration` is the caller's: whether the new lift has history at the gym.
 */
export function swapToAlternative<E extends SessionExercise>(ex: E, alt: RowAlternative, calibration: boolean): E {
  const back: RowAlternative = {
    exerciseId: ex.exerciseId,
    name: ex.name,
    plannedSets: planOf(ex.sets),
    ...(ex.targetLoad != null ? { targetLoad: ex.targetLoad } : {}),
    cues: ex.cues,
    ...(ex.logStyle ? { logStyle: ex.logStyle } : {}),
    ...(ex.linkedHome ? { linkedHome: true } : {}),
  };
  const style = alt.logStyle ?? ex.logStyle;
  const plan = alt.plannedSets?.length ? alt.plannedSets : planOf(ex.sets);
  const sets: WorkoutSet[] = plan.map((ps) => ({
    kind: ps.kind,
    ...(ps.group != null ? { group: ps.group } : {}),
    ...(style !== 'time' && (ps.weight ?? alt.targetLoad) != null ? { weight: ps.weight ?? alt.targetLoad } : {}),
    ...(style !== 'time' && ps.reps != null ? { targetReps: ps.reps } : {}),
    ...(style === 'time' && ps.durationSec != null ? { targetDurationSec: ps.durationSec } : {}),
    ...(ps.label ? { label: ps.label } : {}),
    ...(ex.loadUnit ? { unit: ex.loadUnit } : {}),
    done: false,
  }));
  const {
    recommendation: _r, sideRecommendations: _s, progression: _p, calibration: _c, linkedHome: _l, targetLoad: _t,
    ...rest
  } = ex;
  return {
    ...(rest as E),
    exerciseId: alt.exerciseId,
    name: alt.name,
    cues: alt.cues ?? [],
    ...(alt.logStyle ? { logStyle: alt.logStyle } : {}),
    ...(alt.targetLoad != null ? { targetLoad: alt.targetLoad } : {}),
    ...(alt.linkedHome ? { linkedHome: true } : {}),
    ...(calibration ? { calibration: true } : {}),
    sets,
    alternatives: [back, ...(ex.alternatives ?? []).filter((a) => a.exerciseId !== alt.exerciseId)].slice(0, ALTERNATIVES_MAX),
  };
}

/** The planned shape of a row's sets (kinds, groups, labels, targets). */
function planOf(sets: readonly WorkoutSet[]): PlannedSet[] {
  return sets.map((s) => ({
    kind: s.kind as SetKind,
    ...(s.group != null ? { group: s.group } : {}),
    ...(s.targetReps != null ? { reps: s.targetReps } : {}),
    ...(s.targetDurationSec != null ? { durationSec: s.targetDurationSec } : {}),
    ...(s.label ? { label: s.label } : {}),
  }));
}

/** `TemplateExercise.carryover`, cleaned. */
export function carryoverOf(raw: unknown): RowCarryover | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['from'] !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(r['from'])) return null;
  const n = r['clusters'];
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) return null;
  return { from: r['from'], clusters: n };
}
