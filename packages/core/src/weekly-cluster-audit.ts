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
 * ## Whether to add a cluster (2026-10-07)
 *
 * {@link volumeCalls} turns the audit into at most ONE added cluster per
 * muscle per week, and NEVER in a cut: during energy restriction extra
 * training volume did not change lean-mass retention (Roth 2023), so recovery
 * comes first. In maintenance or a bulk, a muscle under
 * {@link CLUSTER_ADD_BELOW} clusters a week earns one more when its main lift
 * has stalled for {@link STALL_TRIGGER_SESSIONS}+ sessions, or when every lift
 * for it progressed over the last two weeks. Never above
 * {@link CLUSTER_WEEK_MAX}. The app never adds the cluster itself: it says so.
 *
 * Pure; the caller supplies completed sessions and the catalog.
 */
import type { MuscleGroup, SessionExercise, TrainingPhase, WorkoutSession } from './workout';
import { detectStall, effectiveReps, readExercise } from './progression-engine';

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

// ─── Volume calls ───────────────────────────────────────────────

/** A muscle at or above this many clusters a week is not offered another. */
export const CLUSTER_ADD_BELOW = 4;
/** Stalled sessions on the main lift that justify one more cluster. */
export const STALL_TRIGGER_SESSIONS = 3;
/** "Every lift progressed" is judged over this window. */
export const PROGRESS_WINDOW_DAYS = 14;

export type VolumeCallReason =
  /** A cut: never more volume. */
  | 'cut'
  /** Already at {@link CLUSTER_ADD_BELOW} or more this week. */
  | 'enough-volume'
  /** One more would exceed {@link CLUSTER_WEEK_MAX}. */
  | 'at-ceiling'
  /** A cluster was already added for this muscle this week. */
  | 'added-this-week'
  | 'main-lift-stalled'
  | 'all-progressing'
  /** Under the threshold, but neither trigger holds. */
  | 'no-trigger';

export interface VolumeCall {
  muscle: MuscleGroup;
  clusters: number;
  /** One more cluster this week, or none. Never more than one. */
  add: 0 | 1;
  reason: VolumeCallReason;
}

export interface MuscleSignals {
  /** Stalled sessions on the muscle's main lift (`detectStall`), 0 when moving. */
  mainLiftStallSessions?: number;
  /** Every lift for the muscle progressed over the last two weeks. */
  allProgressed?: boolean;
}

export function volumeCalls(
  audit: Pick<WeeklyClusterAudit, 'muscles'>,
  phase: TrainingPhase,
  signals: Partial<Record<MuscleGroup, MuscleSignals>> = {},
  addedThisWeek: ReadonlySet<MuscleGroup> = new Set(),
): VolumeCall[] {
  return audit.muscles.map(({ muscle, clusters }) => {
    const call = (add: 0 | 1, reason: VolumeCallReason): VolumeCall => ({ muscle, clusters, add, reason });
    if (phase === 'cut') return call(0, 'cut');
    if (clusters >= CLUSTER_ADD_BELOW) return call(0, 'enough-volume');
    if (clusters + 1 > CLUSTER_WEEK_MAX) return call(0, 'at-ceiling');
    if (addedThisWeek.has(muscle)) return call(0, 'added-this-week');
    const sig = signals[muscle] ?? {};
    if ((sig.mainLiftStallSessions ?? 0) >= STALL_TRIGGER_SESSIONS) return call(1, 'main-lift-stalled');
    if (sig.allProgressed) return call(1, 'all-progressing');
    return call(0, 'no-trigger');
  });
}

/** The latest read beats the earliest one in the window: a heavier load, or
 *  the same load with more effective reps on the binding cluster. */
function progressed(history: readonly SessionExercise[]): boolean {
  const reads = history.map((h) => readExercise(h, { expectsCluster: true })).filter((r) => r.valid && !r.legacy);
  if (reads.length < 2) return false;
  const score = (r: (typeof reads)[number]) => ({
    load: r.load ?? 0,
    reps: Math.min(...r.clusters.map((c) => effectiveReps(c) as number)),
  });
  const latest = score(reads[0]);
  const earliest = score(reads[reads.length - 1]);
  return latest.load > earliest.load || (latest.load === earliest.load && latest.reps > earliest.reps);
}

/**
 * The two triggers {@link volumeCalls} reads, per muscle, from the log. The
 * MAIN lift is the one with the most clusters for the muscle in the last two
 * weeks.
 */
export function muscleSignals(
  sessions: readonly WorkoutSession[],
  catalog: readonly { id?: string; muscles: readonly MuscleGroup[] }[],
  now: number,
): Partial<Record<MuscleGroup, MuscleSignals>> {
  const primary = new Map<string, MuscleGroup | undefined>();
  for (const ex of catalog) if (ex.id) primary.set(ex.id, ex.muscles[0]);
  const completed = sessions
    .filter((s) => s.status === 'completed')
    .sort((a, b) => b.date.getTime() - a.date.getTime());
  const windowFrom = now - PROGRESS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  // muscle → exerciseId → clusters in the window
  const byMuscle = new Map<MuscleGroup, Map<string, number>>();
  for (const s of completed) {
    if (s.date.getTime() < windowFrom) continue;
    for (const ex of s.exercises) {
      const n = clustersInExercise(ex.sets);
      const m = primary.get(ex.exerciseId);
      if (n === 0 || !m) continue;
      const lifts = byMuscle.get(m) ?? new Map<string, number>();
      lifts.set(ex.exerciseId, (lifts.get(ex.exerciseId) ?? 0) + n);
      byMuscle.set(m, lifts);
    }
  }

  const out: Partial<Record<MuscleGroup, MuscleSignals>> = {};
  for (const [muscle, lifts] of byMuscle) {
    const historyOf = (id: string, inWindow: boolean) => completed
      .filter((s) => !inWindow || s.date.getTime() >= windowFrom)
      .flatMap((s) => s.exercises.filter((e) => e.exerciseId === id));
    const main = [...lifts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    out[muscle] = {
      mainLiftStallSessions: detectStall(historyOf(main, false))?.sessions ?? 0,
      allProgressed: [...lifts.keys()].every((id) => progressed(historyOf(id, true))),
    };
  }
  return out;
}

/**
 * The lifter's own gate for the next volume phase, as the volume panel states
 * it: "Phase 2 volume unlocks at {gateLb} on the 7-day average AND
 * maintenance calories". `met` needs both halves, and is false while either is
 * unknown.
 */
export function volumeGateMet(gateLb: number, sevenDayAvgLb: number | null | undefined, phase: TrainingPhase): boolean {
  return sevenDayAvgLb != null && sevenDayAvgLb <= gateLb && phase !== 'cut';
}
