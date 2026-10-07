/**
 * Turning progression calls into template edits — and recording every one.
 *
 * The engine (`progression-engine.ts`) never touches a template. This module
 * is the only path from a call to a `targetLoad`, and it runs in exactly two
 * cases: the lifter taps "Apply to template" on the finish sheet (all lifts,
 * or the ones they leave switched on), or they have turned on "Auto-apply
 * progression" — which is OFF by default. {@link finishProgression} is where
 * that setting is read, so "never change a template silently while the
 * setting is off" is one branch with a test on it, not a convention.
 *
 * Every applied move appends a {@link LoadChange} to the row's `loadLog`, and
 * so does a load the lifter edits by hand in the template editor
 * ({@link logUserLoadEdits}). The lift's history reads that log to show when
 * the load moved and whether the engine or the lifter moved it.
 *
 * Pure, framework-free (ADR-0012).
 */
import { type ProgressionCall, type Recommendation, progressionCall } from './progression-engine';
import type { LoadChange, TemplateExercise } from './workout';

export interface TemplateLoadChange {
  exerciseId: string;
  name: string;
  /** The row's load before, pounds; absent when it had none. */
  from?: number;
  to: number;
  call: ProgressionCall;
  /** The sentence shown for the call — stored on the log as given. */
  reason: string;
}

/** Calls that may move a template's load. An invalid read says nothing about
 *  the load (the 10/6 crunch: the template's 30 must not be "corrected" back
 *  to the 25 an invalid session was performed at), and a first session has
 *  nothing to move it with. */
const MOVES: ReadonlySet<ProgressionCall> = new Set<ProgressionCall>(['increase', 'drop', 'hold', 'stalled']);

const same = (a: number | undefined, b: number | undefined) =>
  a != null && b != null && Math.abs(a - b) < 0.01;

/**
 * The template moves a set of calls implies, one per row whose load would
 * change. A hold proposes the load that was actually lifted when the
 * template had drifted from it (a template at 15 for a lift done at 25).
 */
export function proposeTemplateChanges(
  rows: readonly Pick<TemplateExercise, 'exerciseId' | 'name' | 'targetLoad'>[],
  recs: ReadonlyMap<string, Recommendation>,
  reasonFor: (rec: Recommendation) => string,
): TemplateLoadChange[] {
  const out: TemplateLoadChange[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (seen.has(row.exerciseId)) continue;
    const rec = recs.get(row.exerciseId);
    if (!rec || rec.load == null) continue;
    const call = progressionCall(rec);
    if (!MOVES.has(call) || same(rec.load, row.targetLoad)) continue;
    seen.add(row.exerciseId);
    out.push({
      exerciseId: row.exerciseId,
      name: row.name,
      ...(row.targetLoad != null ? { from: row.targetLoad } : {}),
      to: rec.load,
      call,
      reason: reasonFor(rec),
    });
  }
  return out;
}

/**
 * Apply the chosen changes: `targetLoad` moves, a planned activation or mini
 * that carried the old load explicitly moves with it (a drop set keeps its
 * own lighter weight), and a {@link LoadChange} is appended.
 */
export function applyTemplateChanges(
  rows: readonly TemplateExercise[],
  changes: readonly TemplateLoadChange[],
  opts: { at: Date; by: LoadChange['by'] },
): TemplateExercise[] {
  if (changes.length === 0) return [...rows];
  const byId = new Map(changes.map((c) => [c.exerciseId, c]));
  return rows.map((row) => {
    const c = byId.get(row.exerciseId);
    if (!c) return row;
    const entry: LoadChange = {
      at: opts.at.toISOString(),
      ...(row.targetLoad != null ? { from: row.targetLoad } : {}),
      to: c.to,
      by: opts.by,
      reason: c.reason,
    };
    return {
      ...row,
      targetLoad: c.to,
      plannedSets: row.plannedSets.map((p) =>
        (p.kind === 'activation' || p.kind === 'mini') && p.weight != null && same(p.weight, row.targetLoad)
          ? { ...p, weight: c.to }
          : p,
      ),
      loadLog: [...(row.loadLog ?? []), entry],
    };
  });
}

/**
 * What finishing a session does to its template. With auto-apply OFF the
 * answer is "nothing": `applied` is null and the rows are untouched until the
 * lifter taps Apply. With it ON, every proposed change is applied as the
 * engine's.
 */
export function finishProgression(input: {
  rows: readonly TemplateExercise[];
  recs: ReadonlyMap<string, Recommendation>;
  autoApply: boolean;
  at: Date;
  reasonFor: (rec: Recommendation) => string;
}): { proposed: TemplateLoadChange[]; applied: TemplateExercise[] | null } {
  const proposed = proposeTemplateChanges(input.rows, input.recs, input.reasonFor);
  if (!input.autoApply || proposed.length === 0) return { proposed, applied: null };
  return { proposed, applied: applyTemplateChanges(input.rows, proposed, { at: input.at, by: 'engine' }) };
}

/**
 * The template editor's save: a row whose `targetLoad` the lifter changed by
 * hand gets a `by: 'user'` entry. Rows are matched by exercise id; a new row
 * is not a move (it had no load to move from), and a removed row has nowhere
 * to log.
 */
export function logUserLoadEdits(
  before: readonly Pick<TemplateExercise, 'exerciseId' | 'targetLoad' | 'loadLog'>[],
  after: readonly TemplateExercise[],
  opts: { at: Date; reason: string },
): TemplateExercise[] {
  const prev = new Map(before.map((r) => [r.exerciseId, r]));
  return after.map((row) => {
    const old = prev.get(row.exerciseId);
    // The editor rebuilds rows from its draft; carry the log across first.
    const log = row.loadLog ?? old?.loadLog;
    const carried = log ? { ...row, loadLog: log } : row;
    if (!old || old.targetLoad == null || row.targetLoad == null || same(old.targetLoad, row.targetLoad)) return carried;
    return {
      ...carried,
      loadLog: [...(log ?? []), { at: opts.at.toISOString(), from: old.targetLoad, to: row.targetLoad, by: 'user', reason: opts.reason }],
    };
  });
}

/** Every logged move of one exercise across a set of templates, oldest first. */
export function loadChangesFor(
  templates: readonly { name: string; exercises: readonly Pick<TemplateExercise, 'exerciseId' | 'loadLog'>[] }[],
  exerciseId: string,
): Array<LoadChange & { template: string }> {
  return templates
    .flatMap((t) => t.exercises
      .filter((e) => e.exerciseId === exerciseId)
      .flatMap((e) => (e.loadLog ?? []).map((c) => ({ ...c, template: t.name }))))
    .sort((a, b) => a.at.localeCompare(b.at));
}
