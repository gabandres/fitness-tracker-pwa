/**
 * Weekly FRACTIONAL volume per muscle, counted in myo-rep clusters (Program v2,
 * 2026-10-11).
 *
 * Every cluster credits its exercise's PRIMARY muscle 1.0 and each secondary
 * muscle 0.5 — the coaching table below. It is reported as "clusters
 * (myo-rep)", never "sets": no validated cluster-to-set conversion exists
 * (`weekly-cluster-audit.ts` explains why a cluster is not three sets).
 *
 * A single-leg exercise logged as an L cluster and an R cluster is ONE
 * cluster of that muscle, not two — one cluster per leg is one cluster's
 * worth of work for the muscle. {@link clusterCount} is the one place that
 * rule lives; the weekly cluster audit (`weekly-cluster-audit.ts`) counts
 * through it too.
 *
 * Muscles are finer than the catalog's {@link MuscleGroup}: the deltoid heads
 * are split, because side delt is exactly the head this program is short on.
 *
 * Pure; no I/O.
 */
import type { MuscleGroup, SetKind, WorkoutSession, WorkoutTemplate } from './workout';
import { exerciseNameKey } from './workout';

export type VolumeMuscle =
  | 'chest' | 'triceps' | 'frontDelt' | 'sideDelt' | 'rearDelt'
  | 'back' | 'biceps' | 'quads' | 'glutes' | 'hamstrings' | 'calves' | 'abs';

export const VOLUME_MUSCLES: readonly VolumeMuscle[] = [
  'chest', 'frontDelt', 'sideDelt', 'rearDelt', 'triceps', 'back', 'biceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'abs',
];

export interface VolumeCredit {
  muscle: VolumeMuscle;
  /** 1 for the primary muscle, 0.5 for a secondary one. */
  weight: 1 | 0.5;
}

const c = (muscle: VolumeMuscle, weight: 1 | 0.5 = 1): VolumeCredit => ({ muscle, weight });

/**
 * The coaching credit table (2026-10-11), matched on the exercise's name.
 * ORDER MATTERS: the more specific pattern first ("leg curl" before "curl",
 * "leg extension" before "extension", "rear delt" before "row").
 */
const TABLE: readonly { test: RegExp; credits: readonly VolumeCredit[] }[] = [
  { test: /\bleg curls?\b|hamstring curl/, credits: [c('hamstrings')] },
  { test: /\bleg extensions?\b/, credits: [c('quads')] },
  { test: /\bcalf\b|\bcalves\b/, credits: [c('calves')] },
  { test: /crunch|knee raise|leg raise/, credits: [c('abs')] },
  { test: /rear delt|reverse fly|face pull/, credits: [c('rearDelt')] },
  { test: /lateral raise|side raise/, credits: [c('sideDelt')] },
  { test: /shoulder press|overhead press|military press|\bohp\b/, credits: [c('frontDelt'), c('sideDelt', 0.5), c('triceps', 0.5)] },
  { test: /overhead (db |dumbbell )?(triceps )?extension|oh extension|skull ?crusher|triceps? (pushdown|extension)/, credits: [c('triceps')] },
  { test: /\brdl\b|romanian/, credits: [c('hamstrings'), c('glutes', 0.5)] },
  { test: /squat/, credits: [c('quads'), c('glutes', 0.5)] },
  { test: /pull-?ups?|chin-?ups?|pulldown/, credits: [c('back'), c('biceps', 0.5)] },
  { test: /\brows?\b/, credits: [c('back'), c('rearDelt', 0.5), c('biceps', 0.5)] },
  { test: /curl/, credits: [c('biceps')] },
  { test: /press|push-?ups?|\bflye?s?\b|bench/, credits: [c('chest'), c('triceps', 0.5), c('frontDelt', 0.5)] },
];

/** Catalog groups to volume muscles, for an exercise the table does not name. */
const FROM_GROUP: Partial<Record<MuscleGroup, VolumeMuscle>> = {
  chest: 'chest', back: 'back', shoulders: 'frontDelt', biceps: 'biceps', triceps: 'triceps',
  quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves', core: 'abs',
};

/**
 * The credits one cluster of `name` earns. The table first; otherwise the
 * catalog's muscles — the first primary (1.0), the rest secondary (0.5).
 * Empty when neither says anything: the caller reports it as unattributed.
 */
export function creditsFor(name: string, muscles: readonly MuscleGroup[] = []): VolumeCredit[] {
  const key = exerciseNameKey(name);
  const hit = TABLE.find((r) => r.test.test(key));
  if (hit) return [...hit.credits];
  const out: VolumeCredit[] = [];
  muscles.forEach((m, i) => {
    const v = FROM_GROUP[m];
    if (v && !out.some((x) => x.muscle === v)) out.push(c(v, i === 0 ? 1 : 0.5));
  });
  return out;
}

const SIDES = new Set(['L', 'R']);

/**
 * Clusters in a set list: one per activation group — except that clusters
 * labelled L and R (a single-leg lift, one cluster per side) count as ONE
 * per pair. `performedOnly` counts only activations with logged reps (a
 * session); off, every planned activation counts (a template).
 */
export function clusterCount(
  sets: readonly { kind: SetKind | string; group?: number; reps?: number; label?: string }[],
  performedOnly = true,
): number {
  const plain = new Set<number>();
  const sided = new Set<number>();
  sets.forEach((s, i) => {
    if (s.kind !== 'activation' || (performedOnly && s.reps == null)) return;
    const g = s.group ?? i + 1;
    (s.label && SIDES.has(s.label.trim()) ? sided : plain).add(g);
  });
  return plain.size + Math.ceil(sided.size / 2);
}

export interface MuscleVolume {
  muscle: VolumeMuscle;
  /** Clusters where this is the PRIMARY muscle. */
  direct: number;
  /** Primary 1.0 + secondary 0.5, per cluster. */
  fractional: number;
}

type CatalogMuscles = readonly { id?: string; muscles: readonly MuscleGroup[] }[];

function add(into: Map<VolumeMuscle, MuscleVolume>, credits: readonly VolumeCredit[], clusters: number) {
  for (const cr of credits) {
    const row = into.get(cr.muscle) ?? { muscle: cr.muscle, direct: 0, fractional: 0 };
    if (cr.weight === 1) row.direct += clusters;
    row.fractional += clusters * cr.weight;
    into.set(cr.muscle, row);
  }
}

const sortAscending = (rows: MuscleVolume[]) =>
  rows.sort((a, b) => a.fractional - b.fractional || a.direct - b.direct || a.muscle.localeCompare(b.muscle));

/** Above this many fractional clusters of one muscle in ONE session, extra
 *  volume showed no further gain (Pelland et al., preprint). */
export const PER_SESSION_PLATEAU = 11;

export interface SessionVolume {
  date: Date;
  sessionId?: string;
  muscles: MuscleVolume[];
  /** Muscles over {@link PER_SESSION_PLATEAU} in this session. */
  overPlateau: VolumeMuscle[];
}

export interface WeeklyVolumeReport {
  /** Every muscle, LOWEST first (a muscle with no credit reads 0). */
  week: MuscleVolume[];
  perSession: SessionVolume[];
  /** Exercises that earned no credit (nothing in the table, no muscles). */
  unattributed: string[];
}

/**
 * Volume from the logged clusters of COMPLETED sessions dated in
 * `[fromMs, toMs]`. Every muscle in {@link VOLUME_MUSCLES} is listed, so a
 * muscle with none shows as 0 — at the top, where the lowest belongs.
 */
export function volumeBetween(
  sessions: readonly Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises'>[],
  catalog: CatalogMuscles,
  fromMs: number,
  toMs: number,
): WeeklyVolumeReport {
  const muscles = new Map(catalog.flatMap((e) => (e.id ? [[e.id, e.muscles] as const] : [])));
  const week = new Map<VolumeMuscle, MuscleVolume>(VOLUME_MUSCLES.map((m) => [m, { muscle: m, direct: 0, fractional: 0 }]));
  const perSession: SessionVolume[] = [];
  const unattributed = new Set<string>();
  const ordered = [...sessions].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const s of ordered) {
    if (s.status !== 'completed' || s.date.getTime() < fromMs || s.date.getTime() > toMs) continue;
    const one = new Map<VolumeMuscle, MuscleVolume>();
    for (const ex of s.exercises) {
      const n = clusterCount(ex.sets);
      if (n === 0) continue;
      const credits = creditsFor(ex.name, muscles.get(ex.exerciseId));
      if (credits.length === 0) {
        unattributed.add(ex.name);
        continue;
      }
      add(week, credits, n);
      add(one, credits, n);
    }
    if (one.size) {
      const rows = sortAscending([...one.values()]);
      perSession.push({
        date: s.date,
        ...(s.id ? { sessionId: s.id } : {}),
        muscles: rows,
        overPlateau: rows.filter((r) => r.fractional > PER_SESSION_PLATEAU).map((r) => r.muscle),
      });
    }
  }
  return { week: sortAscending([...week.values()]), perSession, unattributed: [...unattributed] };
}

/** {@link volumeBetween} over the 7 days up to `now`. */
export function weeklyVolume(
  sessions: readonly Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises'>[],
  catalog: CatalogMuscles,
  now: number,
): WeeklyVolumeReport {
  return volumeBetween(sessions, catalog, now - 7 * 24 * 60 * 60 * 1000, now);
}

/** The same credits from a set of TEMPLATES, each performed once a week —
 *  what the program plans, to set beside what was logged. */
export function plannedVolume(
  templates: readonly Pick<WorkoutTemplate, 'exercises'>[],
  catalog: CatalogMuscles,
): MuscleVolume[] {
  const muscles = new Map(catalog.flatMap((e) => (e.id ? [[e.id, e.muscles] as const] : [])));
  const out = new Map<VolumeMuscle, MuscleVolume>(VOLUME_MUSCLES.map((m) => [m, { muscle: m, direct: 0, fractional: 0 }]));
  for (const t of templates) {
    for (const row of t.exercises) {
      const n = clusterCount(row.plannedSets, false);
      if (n) add(out, creditsFor(row.name, muscles.get(row.exerciseId)), n);
    }
  }
  return sortAscending([...out.values()]);
}

/** The muscle a cluster of `name` credits 1.0 — the "same muscle" the
 *  Program v2 rest rule compares. */
export function primaryMuscleOf(name: string, muscles?: readonly MuscleGroup[]): VolumeMuscle | undefined {
  return creditsFor(name, muscles).find((c) => c.weight === 1)?.muscle;
}
