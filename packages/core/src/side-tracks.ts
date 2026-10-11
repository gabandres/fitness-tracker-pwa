/**
 * Program v2 (2026-10-11): two rules for what the progression engine READS
 * from a lift's history. Neither changes the engine's maths (Epley e1RM,
 * predicted reps and the rep ranges are untouched): they change which sets it
 * is shown.
 *
 * - **Cluster-count change** (`TemplateExercise.clusterCountChange`). The
 *   lateral raise went from 1 cluster to 2. Its history has one cluster per
 *   session, so the engine judges only cluster 1 — before and after the
 *   change alike — and the new cluster 2 starts its own baseline instead of
 *   reading as a failed session. Drop sets are never read (they never were).
 *
 * - **Side tracks** (an L/R lift, `PlannedSet.label`). The single-leg calf
 *   raise is one cluster per leg. Each side is its own progression track:
 *   the engine reads the L cluster's history for L and the R cluster's for R,
 *   and each side has its own load (`TemplateExercise.sideLoads`). For weekly
 *   VOLUME the pair is still one calf cluster (`volume-credits.ts`).
 *
 * Pure; no I/O.
 */
import type { PlannedSet, SessionExercise, Side, TemplateExercise, WorkoutSet } from './workout';

export const SIDES: readonly Side[] = ['L', 'R'];

const sideOf = (label: string | undefined): Side | undefined => {
  const l = label?.trim();
  return l === 'L' || l === 'R' ? l : undefined;
};

/** The sides an L/R lift's plan names, in order — empty for any other lift. */
export function sidesOf(row: { plannedSets: readonly Pick<PlannedSet, 'kind' | 'label'>[] } | null | undefined): Side[] {
  const found = new Set<Side>();
  for (const p of row?.plannedSets ?? []) {
    const s = p.kind === 'activation' ? sideOf(p.label) : undefined;
    if (s) found.add(s);
  }
  return SIDES.filter((s) => found.has(s));
}

/** The groups (cluster numbers) of one side in a set list. */
function groupsOfSide(sets: readonly Pick<WorkoutSet, 'kind' | 'group' | 'label'>[], side: Side): Set<number> {
  return new Set(sets.filter((s) => s.kind === 'activation' && sideOf(s.label) === side).map((s) => s.group ?? 1));
}

/**
 * One side's sets, renumbered as cluster 1 — what the engine reads for that
 * side's track. A session with no cluster for the side reads as no history.
 */
export function sideSets<T extends Pick<WorkoutSet, 'kind' | 'group' | 'label'>>(sets: readonly T[], side: Side): T[] {
  const groups = groupsOfSide(sets, side);
  return sets
    .filter((s) => (s.kind === 'activation' || s.kind === 'mini') && groups.has(s.group ?? 1))
    .map((s) => ({ ...s, group: 1 }));
}

/**
 * The first `n` clusters of a set list (by cluster number), minis included,
 * drop sets excluded — what the engine reads while a cluster-count change is
 * in force.
 */
export function firstClusters<T extends Pick<WorkoutSet, 'kind' | 'group'>>(sets: readonly T[], n: number): T[] {
  const groups = [...new Set(sets.filter((s) => s.kind === 'activation').map((s) => s.group ?? 1))].sort((a, b) => a - b);
  const keep = new Set(groups.slice(0, Math.max(0, n)));
  return sets.filter((s) => (s.kind === 'activation' || s.kind === 'mini') && keep.has(s.group ?? 1));
}

/** The history the engine reads for one row (and side): each session's sets
 *  cut by the two rules above. Sessions left with no activation drop out. */
export function readableHistory(
  history: readonly SessionExercise[],
  row: Pick<TemplateExercise, 'clusterCountChange'> | null | undefined,
  side?: Side,
): SessionExercise[] {
  const n = row?.clusterCountChange?.from;
  if (n == null && !side) return [...history];
  return history
    .map((h) => {
      let sets = h.sets;
      if (side) sets = sideSets(sets, side);
      if (n != null) sets = firstClusters(sets, n);
      return { ...h, sets };
    })
    .filter((h) => h.sets.some((s) => s.kind === 'activation'));
}

/** A side's load: its own, else the row's. */
export function sideLoad(row: Pick<TemplateExercise, 'sideLoads' | 'targetLoad'>, side: Side): number | undefined {
  return row.sideLoads?.[side] ?? row.targetLoad;
}

/**
 * Seed each side's sets with that side's load (the session's starting
 * weights) — the per-side `seedCallLoad`. A side with no load is untouched.
 */
export function seedSideLoads<E extends { sets: WorkoutSet[] }>(exercise: E, loads: Partial<Record<Side, number>>): E {
  return {
    ...exercise,
    sets: exercise.sets.map((s) => {
      const side = sideOf(s.label) ?? sideOfGroup(exercise.sets, s.group);
      const w = side ? loads[side] : undefined;
      return w != null && (s.kind === 'activation' || s.kind === 'mini') ? { ...s, weight: w } : s;
    }),
  };
}

/** A mini carries no label; its cluster's activation does. */
function sideOfGroup(sets: readonly WorkoutSet[], group: number | undefined): Side | undefined {
  return sideOf(sets.find((x) => x.kind === 'activation' && (x.group ?? 1) === (group ?? 1))?.label);
}
