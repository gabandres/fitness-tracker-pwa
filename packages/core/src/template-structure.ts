/**
 * Template STRUCTURE at Finish (S23-10, owner 2026-10-12; ADR-0044 note).
 *
 * A session started from a template can gain lifts (Add exercise) and lose
 * them (Remove from workout) mid-session. At Finish the lifter is asked ONE
 * question — the load moves of `progression-apply.ts` and these lines
 * together — and the template takes the session's shape only on an explicit
 * "Update". Auto-apply progression never applies structure: it is a setting
 * about loads, and a lift deleted on a bad day is not a programme change.
 *
 * Definitions, pinned by `template-structure.test.ts`:
 *
 * - **Added** — a lift in the session whose `exerciseId` the template does not
 *   have, with at least one LOGGED set. An added lift with nothing logged is
 *   not proposed: there is nothing to prescribe from, and the save drops it.
 * - **Removed** — a template row whose `exerciseId` is absent from the LIVE
 *   session (read before the save prunes empty lifts). A lift still in the
 *   session with zero logged sets is UNSTARTED, not removed — Finish already
 *   says it is left out, and skipping a lift once is not deleting it. A row
 *   stamped `lastModifiedAt` after the session started was added to the
 *   template since, so it is not "removed" from a session that never had it.
 * - Identity is the `exerciseId`. The same lift twice is not a structure
 *   change; reordering is not offered here (the session reorder is a
 *   one-day choice more often than a plan change).
 *
 * An added lift's row comes from what was performed ({@link rowFromPerformed}):
 * one planned set per logged set, with its reps (or hold), and the load on
 * `targetLoad` — NEVER per-set weights on effort sets, because
 * `templateToSessionExercises` reads `ps.weight ?? targetLoad` and progression
 * moves only `targetLoad`, so a stored per-set weight would freeze the lift
 * (FIX-R, S23-11). Warm-ups and drop sets keep their own lighter weight, as
 * `applyTemplateChanges` already treats them.
 *
 * Order: an added row goes after the lift it followed in the SESSION (the
 * nearest earlier session lift that will be in the template); first in the
 * session → top of the template. Superset groups are never broken: an add
 * anchored on a group member lands after the whole block, an added row never
 * joins a group, and removing a member goes through `unpair` (a partner left
 * alone runs straight; a tri-set's rests pass to its new leader).
 *
 * Pure, framework-free (ADR-0012).
 */
import { normalizeSupersets, unpair } from './superset';
import { stampChangedRows } from './progression-apply';
import { isWorkingSet } from './workout-progression';
import {
  DEFAULT_LOG_STYLE,
  isLoggedSet,
  type PlannedSet,
  type SessionExercise,
  type TemplateChangeBy,
  type TemplateExercise,
} from './workout';

export type TemplateStructureChange =
  | {
      kind: 'add';
      exerciseId: string;
      name: string;
      /** The row to insert, built from what was performed. */
      row: TemplateExercise;
      /** The exerciseId it goes after; `null` = the top of the template. */
      after: string | null;
    }
  | { kind: 'remove'; exerciseId: string; name: string };

/** Planned-set kinds that keep a weight of their own: lighter by design, and
 *  never moved by progression (`applyTemplateChanges`). */
const OWN_WEIGHT_KINDS = new Set<PlannedSet['kind']>(['warmup', 'drop']);

/**
 * A template row from one performed lift, or null when nothing was logged.
 * See the module header for the rules.
 */
export function rowFromPerformed(se: SessionExercise): TemplateExercise | null {
  const style = se.logStyle ?? DEFAULT_LOG_STYLE;
  const logged = se.sets.filter((s) => isLoggedSet(s, style));
  if (logged.length === 0) return null;
  const plannedSets: PlannedSet[] = logged.map((s) => {
    const p: PlannedSet = { kind: s.kind };
    if (s.group != null) p.group = s.group;
    if (s.label) p.label = s.label;
    if (style === 'time') {
      if (s.durationSec != null) p.durationSec = s.durationSec;
    } else if (s.reps != null) {
      p.reps = s.reps;
    }
    if (style === 'weight-reps' && OWN_WEIGHT_KINDS.has(s.kind) && s.weight != null) p.weight = s.weight;
    return p;
  });
  const load = style === 'weight-reps'
    ? logged.find((s) => isWorkingSet(s) && s.weight != null)?.weight
    : undefined;
  return {
    exerciseId: se.exerciseId,
    name: se.name,
    ...(load != null ? { targetLoad: load } : {}),
    ...(se.logStyle ? { logStyle: se.logStyle } : {}),
    ...(se.progression ? { progression: se.progression } : {}),
    plannedSets,
  };
}

/**
 * The lifts the session added to, and removed from, its template — adds in
 * session order first, then removes in template order. Empty when the shape
 * is unchanged.
 */
export function proposeStructureChanges(
  rows: readonly TemplateExercise[],
  session: { exercises: readonly SessionExercise[]; date?: Date },
): TemplateStructureChange[] {
  const inTemplate = new Set(rows.map((r) => r.exerciseId));
  const inSession = new Set(session.exercises.map((e) => e.exerciseId));
  const out: TemplateStructureChange[] = [];
  // The nearest earlier session lift that will be in the updated template.
  let anchor: string | null = null;
  const added = new Set<string>();
  for (const se of session.exercises) {
    if (inTemplate.has(se.exerciseId)) {
      anchor = se.exerciseId;
      continue;
    }
    if (added.has(se.exerciseId)) continue;
    const row = rowFromPerformed(se);
    if (!row) continue;
    added.add(se.exerciseId);
    out.push({ kind: 'add', exerciseId: se.exerciseId, name: se.name, row, after: anchor });
    anchor = se.exerciseId;
  }
  const started = session.date?.getTime();
  const removed = new Set<string>();
  for (const r of rows) {
    if (inSession.has(r.exerciseId) || removed.has(r.exerciseId)) continue;
    const stamped = r.lastModifiedAt ? Date.parse(r.lastModifiedAt) : NaN;
    if (started != null && !Number.isNaN(stamped) && stamped > started) continue;
    removed.add(r.exerciseId);
    out.push({ kind: 'remove', exerciseId: r.exerciseId, name: r.name });
  }
  return out;
}

/** Strip the superset half: an added row runs straight. */
function straight(row: TemplateExercise): TemplateExercise {
  const { supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...rest } = row;
  return rest;
}

/**
 * The template rows with the chosen structure changes made: removes (through
 * `unpair`, so groups stay sane), then adds after their anchors, the list put
 * back into canonical superset form, and every new or moved row stamped.
 */
export function applyStructureChanges(
  rows: readonly TemplateExercise[],
  changes: readonly TemplateStructureChange[],
  opts: { at: Date; by: TemplateChangeBy },
): TemplateExercise[] {
  if (changes.length === 0) return [...rows];
  let next: TemplateExercise[] = [...rows];
  for (const c of changes) {
    if (c.kind !== 'remove') continue;
    // One occurrence at a time: `unpair` re-canonicalizes, so indices move.
    for (let i = next.findIndex((r) => r.exerciseId === c.exerciseId); i >= 0; i = next.findIndex((r) => r.exerciseId === c.exerciseId)) {
      const unpaired = unpair(next, i);
      const j = unpaired.findIndex((r) => r.exerciseId === c.exerciseId && r.supersetGroup == null);
      if (j < 0) break;
      next = [...unpaired.slice(0, j), ...unpaired.slice(j + 1)];
    }
  }
  for (const c of changes) {
    if (c.kind !== 'add' || next.some((r) => r.exerciseId === c.exerciseId)) continue;
    let at: number;
    if (c.after == null) {
      at = 0;
    } else {
      const a = next.findIndex((r) => r.exerciseId === c.after);
      if (a < 0) {
        at = next.length;
      } else {
        // After the anchor's whole superset block, never between partners.
        const group = next[a].supersetGroup;
        let end = a;
        while (group && next[end + 1]?.supersetGroup === group) end++;
        at = end + 1;
      }
    }
    next = [...next.slice(0, at), straight(c.row), ...next.slice(at)];
  }
  return stampChangedRows(rows, normalizeSupersets(next), opts);
}
