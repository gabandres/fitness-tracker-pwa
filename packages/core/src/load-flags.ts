/**
 * Lifts whose load is overdue for a change (Program v2.1, 2026-10-15): the
 * last session's activation went PAST the top of the lift's rep range at the
 * template's own load, and the template load was not moved since.
 *
 * The engine already calls an increase for most of these; the flag is for the
 * lifter, who sets the template loads by hand — a load left where it was
 * after 15 × 17 is the gap this names. "Past the top" is in LOGGED reps, the
 * number the lifter sees. A row whose baseline is still pending (its next
 * session starts a new baseline, e.g. a lift in a new position) is flagged
 * `held`: the next session is the read, not a load change.
 *
 * Pure; no I/O.
 */
import { calendarDateKey } from './date';
import { resolveEngineConfig, type EngineCatalogFields } from './progression-engine';
import type { WorkoutSession, WorkoutTemplate } from './workout';

export interface OverdueLoad {
  templateId?: string;
  templateName: string;
  exerciseId: string;
  name: string;
  load: number;
  /** Activation reps at that load, in the order performed. */
  reps: number[];
  /** Top of the lift's rep range. */
  max: number;
  /** The session that went past it. */
  date: Date;
  /** The row waits for a pending baseline — hold, do not raise. */
  held?: { since: string; reason: string };
}

export function overdueLoads(input: {
  templates: readonly WorkoutTemplate[];
  sessions: readonly WorkoutSession[];
  catalogOf: (exerciseId: string) => EngineCatalogFields | null | undefined;
  now: Date;
}): OverdueLoad[] {
  const completed = input.sessions
    .filter((s) => s.status === 'completed' && !s.deload)
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const out: OverdueLoad[] = [];
  for (const t of input.templates) {
    for (const row of t.exercises) {
      const last = completed.find((s) => s.exercises.some((e) => e.exerciseId === row.exerciseId && e.sets.some((x) => x.kind === 'activation' && x.reps != null)));
      if (!last) continue;
      const ex = last.exercises.find((e) => e.exerciseId === row.exerciseId)!;
      const { max } = resolveEngineConfig(input.catalogOf(row.exerciseId) ?? { name: row.name }, row).repRange;
      const loadFor = (label?: string) => (label === 'L' || label === 'R' ? row.sideLoads?.[label] ?? row.targetLoad : row.targetLoad);
      const acts = ex.sets.filter((x) => x.kind === 'activation' && x.reps != null && x.weight != null && x.weight === loadFor(x.label));
      if (acts.length === 0 || !acts.some((x) => (x.reps as number) > max)) continue;
      // The engine's rule: a baseline is pending until a session on or after
      // its `since` — so a read from BEFORE it is not this context's read.
      // (Comparing `since` with today flipped a row to "raise" on the
      // baseline's own date, before its first session.)
      const pending = row.baseline && calendarDateKey(last.date) < row.baseline.since ? { since: row.baseline.since, reason: row.baseline.reason } : undefined;
      out.push({
        ...(t.id ? { templateId: t.id } : {}),
        templateName: t.name,
        exerciseId: row.exerciseId,
        name: row.name,
        load: acts[0].weight as number,
        reps: acts.map((x) => x.reps as number),
        max,
        date: last.date,
        ...(pending ? { held: pending } : {}),
      });
    }
  }
  return out;
}
