/**
 * Weekly FRACTIONAL volume per muscle, in two units that are never mixed
 * (Program v2, 2026-10-11; the hard-set view added 2026-10-12, ADR-0046).
 *
 * - **Clusters** ({@link volumeBetween}): myo-rep clusters. Reported as
 *   "clusters", never "sets": no validated cluster-to-set conversion exists
 *   (`weekly-cluster-audit.ts` explains why a cluster is not three sets).
 * - **Hard sets** ({@link hardSetsBetween}): performed straight working sets.
 *   Clusters are not in it, not even their activation sets.
 *
 * Both run through ONE tally: the same window, the same credits — the
 * PRIMARY muscle 1.0 and each secondary 0.5 ({@link creditsFor}, where the
 * user's muscle tags win over the name table, S23-12) — and the same
 * per-session plateau. Only the unit differs.
 *
 * A single-leg exercise logged as an L cluster and an R cluster is ONE
 * cluster of that muscle, not two — one cluster per leg is one cluster's
 * worth of work for the muscle. {@link clusterCount} is the one place that
 * rule lives; the weekly cluster audit (`weekly-cluster-audit.ts`) counts
 * through it too. {@link hardSetCount} applies the same pairing to sets.
 *
 * Muscles are finer than the catalog's {@link MuscleGroup}: the deltoid heads
 * are split, because side delt is exactly the head this program is short on.
 *
 * Pure; no I/O.
 */
import type { LogStyle, MuscleGroup, SetKind, WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';
import { DEFAULT_LOG_STYLE, exerciseNameKey, isLoggedSet } from './workout';

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

/** Catalog groups to volume muscles, for a tag the table does not refine. */
const FROM_GROUP: Partial<Record<MuscleGroup, VolumeMuscle>> = {
  chest: 'chest', back: 'back', shoulders: 'frontDelt', biceps: 'biceps', triceps: 'triceps',
  quads: 'quads', hamstrings: 'hamstrings', glutes: 'glutes', calves: 'calves', core: 'abs',
};

/**
 * The volume muscles a tag COVERS — what "the table agrees with the tag"
 * means (ADR-0046). Shoulders covers all three deltoid heads, so the table can
 * name which head; Core covers abs only; Forearms covers nothing (there is no
 * forearm volume muscle, so the tag credits nothing and the table cannot fill
 * in for it). Every other tag covers the one muscle of the same name.
 */
const REGION: Record<MuscleGroup, readonly VolumeMuscle[]> = {
  chest: ['chest'], back: ['back'], shoulders: ['frontDelt', 'sideDelt', 'rearDelt'],
  biceps: ['biceps'], triceps: ['triceps'], quads: ['quads'], hamstrings: ['hamstrings'],
  glutes: ['glutes'], calves: ['calves'], core: ['abs'], forearms: [],
};

/**
 * The credits one cluster (or one hard set) of `name` earns.
 *
 * **Untagged** (`muscles` empty): the name table, as it always was. Empty
 * when the table says nothing: the caller reports it as unattributed.
 *
 * **Tagged — the tags win (S23-12, owner 2026-10-12, ADR-0046).** The result
 * holds ONLY muscles a tag covers ({@link REGION}); the table never adds a
 * muscle nobody tagged (a "Landmine press" tagged Shoulders is not chest).
 * Per tag, in the user's order:
 *
 * - **Which muscle**: the table "agrees" with a tag when it names a muscle
 *   that tag covers — then it refines the tag (Shoulders + "lateral raise" →
 *   side delt, + "rear delt fly" → rear delt). When it names none, the tag's
 *   own muscle ({@link FROM_GROUP}; Shoulders → front delt, as before).
 * - **What weight**: the tag's position decides, because the chips call the
 *   first tag "Primary" and the user chose it. The FIRST tag's lead muscle is
 *   1.0 — even over the table's own primary ("Face pull" tagged Back, then
 *   Shoulders, is back 1 · rear delt ½). Every later tag is ½ in total, so a
 *   secondary Shoulders tag keeps only its lead head. The table's weights
 *   survive only inside the primary tag: a shoulder press tagged Shoulders
 *   keeps front delt 1 · side delt ½. "Lead" = the table's highest-weighted
 *   muscle in the region, in table order.
 *
 * So there is at most one 1.0 credit, and it is always the first tag's.
 */
export function creditsFor(name: string, muscles: readonly MuscleGroup[] = []): VolumeCredit[] {
  const key = exerciseNameKey(name);
  const table = TABLE.find((r) => r.test.test(key))?.credits ?? [];
  if (muscles.length === 0) return [...table];
  const out: VolumeCredit[] = [];
  const has = (m: VolumeMuscle) => out.some((x) => x.muscle === m);
  for (const tag of new Set(muscles)) {
    const region = REGION[tag] ?? [];
    const named = table
      .filter((cr) => region.includes(cr.muscle))
      .sort((a, b) => b.weight - a.weight);
    const lead = named[0]?.muscle ?? FROM_GROUP[tag];
    if (!lead || has(lead)) continue;
    // The primary is the first tag that covers a muscle at all — a leading
    // Forearms tag covers none, so the next one is the primary.
    if (out.length === 0) {
      out.push(c(lead, 1));
      for (const cr of named.slice(1)) if (!has(cr.muscle)) out.push(c(cr.muscle, 0.5));
    } else {
      out.push(c(lead, 0.5));
    }
  }
  return out;
}

const SIDES = new Set(['L', 'R']);
const sideOf = (label?: string) => (label && SIDES.has(label.trim()) ? label.trim() : undefined);

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
    (sideOf(s.label) ? sided : plain).add(g);
  });
  return plain.size + Math.ceil(sided.size / 2);
}

/**
 * Hard sets in a set list (S23-13, ADR-0046): every `working` set that was
 * PERFORMED — reps logged, or a duration for a `time` lift; the same proof
 * {@link isLoggedSet} uses everywhere, so a planned set nobody ticked is not
 * one. `performedOnly` off counts every planned working set (a template).
 *
 * Deliberately NOT counted:
 * - `warmup` and `mobility` — not working sets;
 * - `drop` — the continuation of the working set before it, already counted;
 * - `activation`, `mini`, `continuation` — a myo-rep / rest-pause / cluster
 *   set is counted in CLUSTERS by {@link clusterCount} and nowhere else. Not
 *   even its activation counts as a set: there is no validated conversion
 *   between a cluster and sets (`weekly-cluster-audit.ts`), and counting the
 *   activation would put a fraction of the cluster into a number that then
 *   reads as the cluster's set-equivalent. The two views never mix.
 *
 * A single-leg lift logged as L and R sets counts per PAIR, like its
 * clusters: 3 left + 3 right is 3 sets of work for the muscle (the longer
 * side when they differ).
 */
export function hardSetCount(
  sets: readonly (Omit<Partial<WorkoutSet>, 'kind'> & { kind: SetKind | string })[],
  logStyle: LogStyle = DEFAULT_LOG_STYLE,
  performedOnly = true,
): number {
  let plain = 0;
  const sides = new Map<string, number>();
  for (const s of sets) {
    if (s.kind !== 'working') continue;
    if (performedOnly && !isLoggedSet(s as WorkoutSet, logStyle)) continue;
    const side = sideOf(s.label);
    if (side) sides.set(side, (sides.get(side) ?? 0) + 1);
    else plain += 1;
  }
  return plain + Math.max(0, ...sides.values());
}

export interface MuscleVolume {
  muscle: VolumeMuscle;
  /** Units (clusters, or hard sets) where this is the PRIMARY muscle. */
  direct: number;
  /** Primary 1.0 + secondary 0.5, per unit. */
  fractional: number;
}

type CatalogMuscles = readonly { id?: string; muscles: readonly MuscleGroup[] }[];

function add(into: Map<VolumeMuscle, MuscleVolume>, credits: readonly VolumeCredit[], units: number) {
  for (const cr of credits) {
    const row = into.get(cr.muscle) ?? { muscle: cr.muscle, direct: 0, fractional: 0 };
    if (cr.weight === 1) row.direct += units;
    row.fractional += units * cr.weight;
    into.set(cr.muscle, row);
  }
}

const sortAscending = (rows: MuscleVolume[]) =>
  rows.sort((a, b) => a.fractional - b.fractional || a.direct - b.direct || a.muscle.localeCompare(b.muscle));

/** Above this many fractional sets of one muscle in ONE session, extra
 *  volume showed no further gain (Pelland et al., preprint). Applied to
 *  clusters and to hard sets alike, each in its own view. */
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
  /** Units counted in the window, attributed or not — clusters in a cluster
   *  report, hard sets in a hard-set report. */
  total: number;
}

type SessionLike = Pick<WorkoutSession, 'id' | 'status' | 'date' | 'exercises'>;
type UnitCount = (ex: SessionLike['exercises'][number]) => number;

/**
 * The one tally both views run through, so they share the window (COMPLETED
 * sessions dated in `[fromMs, toMs]`), the credits ({@link creditsFor}) and
 * the per-session plateau — and differ ONLY in what one unit is.
 */
function tallyBetween(
  sessions: readonly SessionLike[],
  catalog: CatalogMuscles,
  fromMs: number,
  toMs: number,
  unitsOf: UnitCount,
): WeeklyVolumeReport {
  const muscles = new Map(catalog.flatMap((e) => (e.id ? [[e.id, e.muscles] as const] : [])));
  const week = new Map<VolumeMuscle, MuscleVolume>(VOLUME_MUSCLES.map((m) => [m, { muscle: m, direct: 0, fractional: 0 }]));
  const perSession: SessionVolume[] = [];
  const unattributed = new Set<string>();
  let total = 0;
  const ordered = [...sessions].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const s of ordered) {
    if (s.status !== 'completed' || s.date.getTime() < fromMs || s.date.getTime() > toMs) continue;
    const one = new Map<VolumeMuscle, MuscleVolume>();
    for (const ex of s.exercises) {
      const n = unitsOf(ex);
      if (n === 0) continue;
      total += n;
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
  return { week: sortAscending([...week.values()]), perSession, unattributed: [...unattributed], total };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Volume from the logged clusters of COMPLETED sessions dated in
 * `[fromMs, toMs]`. Every muscle in {@link VOLUME_MUSCLES} is listed, so a
 * muscle with none shows as 0 — at the top, where the lowest belongs.
 */
export function volumeBetween(
  sessions: readonly SessionLike[],
  catalog: CatalogMuscles,
  fromMs: number,
  toMs: number,
): WeeklyVolumeReport {
  return tallyBetween(sessions, catalog, fromMs, toMs, (ex) => clusterCount(ex.sets));
}

/** {@link volumeBetween} over the 7 days up to `now`. */
export function weeklyVolume(sessions: readonly SessionLike[], catalog: CatalogMuscles, now: number): WeeklyVolumeReport {
  return volumeBetween(sessions, catalog, now - WEEK_MS, now);
}

/**
 * Hard working sets per muscle (S23-13, ADR-0046): {@link volumeBetween}'s
 * window and credit weights, counting {@link hardSetCount} instead of
 * clusters — so the two views are comparable muscle for muscle, and never
 * summed into one figure.
 */
export function hardSetsBetween(
  sessions: readonly SessionLike[],
  catalog: CatalogMuscles,
  fromMs: number,
  toMs: number,
): WeeklyVolumeReport {
  return tallyBetween(sessions, catalog, fromMs, toMs, (ex) => hardSetCount(ex.sets, ex.logStyle));
}

/** {@link hardSetsBetween} over the 7 days up to `now`. */
export function weeklyHardSets(sessions: readonly SessionLike[], catalog: CatalogMuscles, now: number): WeeklyVolumeReport {
  return hardSetsBetween(sessions, catalog, now - WEEK_MS, now);
}

type TemplateLike = Pick<WorkoutTemplate, 'exercises'>;

function plannedTally(
  templates: readonly TemplateLike[],
  catalog: CatalogMuscles,
  unitsOf: (row: TemplateLike['exercises'][number]) => number,
): MuscleVolume[] {
  const muscles = new Map(catalog.flatMap((e) => (e.id ? [[e.id, e.muscles] as const] : [])));
  const out = new Map<VolumeMuscle, MuscleVolume>(VOLUME_MUSCLES.map((m) => [m, { muscle: m, direct: 0, fractional: 0 }]));
  for (const t of templates) {
    for (const row of t.exercises) {
      const n = unitsOf(row);
      if (n) add(out, creditsFor(row.name, muscles.get(row.exerciseId)), n);
    }
  }
  return sortAscending([...out.values()]);
}

/** The same credits from a set of TEMPLATES, each performed once a week —
 *  what the program plans, to set beside what was logged. */
export function plannedVolume(templates: readonly TemplateLike[], catalog: CatalogMuscles): MuscleVolume[] {
  return plannedTally(templates, catalog, (row) => clusterCount(row.plannedSets, false));
}

/** {@link plannedVolume} in hard sets: every planned working set. */
export function plannedHardSets(templates: readonly TemplateLike[], catalog: CatalogMuscles): MuscleVolume[] {
  return plannedTally(templates, catalog, (row) => hardSetCount(row.plannedSets, DEFAULT_LOG_STYLE, false));
}

export type VolumeView = 'sets' | 'clusters';

/**
 * Which face the volume sheet opens on until the user picks one (S23-13,
 * owner 2026-10-12): Clusters for someone who performed a myo-rep cluster in
 * the window, Sets otherwise. When the window holds NO logged work at all,
 * the plan decides (a Program v2 lifter on a Monday has logged nothing yet
 * and would otherwise open on an empty Sets face): Clusters only when it
 * plans clusters and no working sets.
 */
export function defaultVolumeView(week: { clusters: number; sets: number; plannedClusters: number; plannedSets: number }): VolumeView {
  if (week.clusters > 0) return 'clusters';
  if (week.sets > 0) return 'sets';
  return week.plannedClusters > 0 && week.plannedSets === 0 ? 'clusters' : 'sets';
}

/** The muscle a cluster of `name` credits 1.0 — the "same muscle" the
 *  Program v2 rest rule compares. With tags, the first tag's muscle, refined
 *  by the name table to a deltoid head where it agrees (S23-12). */
export function primaryMuscleOf(name: string, muscles?: readonly MuscleGroup[]): VolumeMuscle | undefined {
  return creditsFor(name, muscles).find((c) => c.weight === 1)?.muscle;
}
