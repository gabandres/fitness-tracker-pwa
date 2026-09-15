/**
 * Weekly volume audit, counted in CLUSTERS (progression engine layer 5).
 *
 * ## Why clusters and not sets
 *
 * One myo-reps cluster — an activation set plus its mini-sets — is ONE
 * rest-pause set, worth roughly 3-4 traditional sets of stimulus. The
 * rest-pause guideline is 2-6 SETS per muscle group per week, not the 10-20
 * that applies to straight sets. Counting a cluster as three sets and
 * comparing to 10-20 reads the whole program as under-volumed, which is the
 * false reading this module exists to avoid. So a cluster counts once, the
 * range is {@link CLUSTER_WEEK_MIN}-{@link CLUSTER_WEEK_MAX}, and straight
 * working sets are reported separately rather than converted.
 *
 * ## Which muscle a cluster counts toward
 *
 * The exercise's PRIMARY muscle: `muscles[0]` on the catalog exercise. That
 * field already exists on every exercise doc, is ordered by the person who
 * wrote it, and needs no rules change — an explicit `primaryMuscle` would
 * have been a second field saying the same thing. An exercise with no
 * muscles listed is reported by name under `unattributed` so the gap is
 * visible rather than silently dropped.
 *
 * Pure; the caller supplies completed sessions and the catalog.
 */
import type { MuscleGroup, WorkoutSession } from './workout';

export const CLUSTER_WEEK_MIN = 2;
export const CLUSTER_WEEK_MAX = 6;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type VolumeStatus = 'below' | 'in-range' | 'above';

export interface MuscleClusterCount {
  muscle: MuscleGroup;
  clusters: number;
  status: VolumeStatus;
}

export interface WeeklyClusterAudit {
  /** One row per muscle that received at least one cluster, most first. */
  muscles: MuscleClusterCount[];
  /** Exercise names that logged clusters but have no muscle group to count toward. */
  unattributed: string[];
  /** Straight working sets in the window — shown, never converted to clusters. */
  straightSets: number;
  /** Total clusters in the window. */
  clusters: number;
}

export function volumeStatus(clusters: number): VolumeStatus {
  if (clusters < CLUSTER_WEEK_MIN) return 'below';
  if (clusters > CLUSTER_WEEK_MAX) return 'above';
  return 'in-range';
}

/** Clusters performed in one session exercise: distinct groups with a logged
 *  activation. An activation with no group is one cluster. */
export function clustersInExercise(sets: readonly { kind: string; group?: number; reps?: number }[]): number {
  const groups = new Set<number>();
  for (const s of sets) {
    if (s.kind === 'activation' && s.reps != null) groups.add(s.group ?? 1);
  }
  return groups.size;
}

export function weeklyClusterAudit(
  sessions: readonly WorkoutSession[],
  catalog: readonly { id?: string; muscles: readonly MuscleGroup[] }[],
  now: number,
): WeeklyClusterAudit {
  const primary = new Map<string, MuscleGroup | undefined>();
  for (const ex of catalog) if (ex.id) primary.set(ex.id, ex.muscles[0]);

  const weekAgo = now - WEEK_MS;
  const byMuscle = new Map<MuscleGroup, number>();
  const unattributed = new Set<string>();
  let straightSets = 0;
  let clusters = 0;

  for (const s of sessions) {
    if (s.status !== 'completed' || s.date.getTime() < weekAgo) continue;
    for (const ex of s.exercises) {
      const n = clustersInExercise(ex.sets);
      straightSets += ex.sets.filter((x) => x.kind === 'working' && x.reps != null).length;
      if (n === 0) continue;
      clusters += n;
      const muscle = primary.get(ex.exerciseId);
      if (!muscle) {
        unattributed.add(ex.name);
        continue;
      }
      byMuscle.set(muscle, (byMuscle.get(muscle) ?? 0) + n);
    }
  }

  const muscles = [...byMuscle.entries()]
    .map(([muscle, count]) => ({ muscle, clusters: count, status: volumeStatus(count) }))
    .sort((a, b) => b.clusters - a.clusters || a.muscle.localeCompare(b.muscle));
  return { muscles, unattributed: [...unattributed], straightSets, clusters };
}
