/**
 * The progression engine — what the next session should do with each lift,
 * derived from logged sets and nothing else.
 *
 * ## The order is the design
 *
 * Layer 1 (validity) runs FIRST and blocks everything after it. Self-reported
 * RIR is unreliable (Steele 2017, Halperin, Refalo 2024 — see
 * `activation-validity.ts`); the mini-set rep count is objective. In myo-reps
 * an activation set is followed by mini-sets after 5-10 s, and the published
 * rule reads the FIRST mini as a measurement of the activation:
 *
 *     first mini > 5 reps  → the activation was too easy   → read INVALID
 *     first mini < 2 reps  → the activation was too hard   → read INVALID
 *     first mini 2-5 reps  → read VALID
 *
 * A read is also invalid when a mini out-reps its activation. A load that
 * moved inside the lift no longer invalidates it (owner, 2026-10-20): the
 * read is taken at the load of the LAST performed cluster's activation, the
 * load the lifter ended on — clusters at another activation load drop out of
 * the read, a mini at another load is still judged by the mini rule — and the
 * call carries `load-changed-mid-cluster`. Volume never cared: every set
 * still counts there. A planned drop set is not read at all. The activation's RIR
 * only invalidates at the top (RIR 4+); RIR 0 is the standard since ADR-0039.
 *
 * A MISSING RIR is read as 0 and flagged (`rir-missing-assumed-0`), never
 * blocked (2026-10-13). It used to make a clustered read invalid, which is
 * how the 10/13 DB RDL — 35 × 13, past the top of its range, RIR left blank —
 * repeated 35 with no visible cause. Assuming 0 is the conservative reading:
 * it gives the FEWEST effective reps the set can stand for, so it can never
 * advance a lift a logged RIR would have held. The mini rule still judges the
 * set, and the app prompts for the RIR on the row.
 *
 * An invalid read never produces a load recommendation. It produces "repeat
 * <load> — read invalid" and the specific reason. That is the single most
 * important rule in this module: advancing load off a read that cannot support
 * the claim corrupts every session that follows it.
 *
 * ## Layer 2 — the rep-range rules (2026-10-07, replacing ADR-0039's band)
 *
 * The derived band (`addLoadAt = max observed reps`) is gone: it moved its own
 * goalposts — a new best raised the mark it had to beat — so a lift could only
 * advance by repeating its record. Each lift now has a REP RANGE, from its
 * category (compound/machine 6-12, isolation and core 8-15, bodyweight 6-15)
 * or the lifter's override. On the ACTIVATION sets only:
 *
 *   effective reps = activation reps + logged RIR  (Smith 13 @ RIR 1 = 14)
 *
 *   every cluster ≥ max  → load-increase candidate. The next load w2 is the
 *       next real step. e1RM = w × (1 + eff/30) from the LOWEST cluster
 *       (Epley — a heuristic, weaker at high reps, so the number is
 *       "expected", never "guaranteed"); predicted = ⌊30 × (e1RM/w2 − 1)⌋.
 *       predicted ≥ min → increase to w2, "expect about N reps".
 *       Otherwise hold and build reps, up to max + 5 (hypertrophy is similar
 *       across moderate and high rep ranges when sets go to failure —
 *       Schoenfeld 2017); at that cap, a 3 s eccentric or a pause rep, then
 *       microplates if the lifter has them, then one more cluster only if the
 *       volume rules allow it.
 *   any cluster < max    → hold the load; target = last + 1 rep.
 *   first session after an increase, and under min → drop back to the
 *       previous load and build.
 *
 * Layer 3 is the load steps: the catalog's `availableLoads` when entered,
 * else 5 lb for dumbbells, Smith, barbell and plates; a stack with no entered
 * steps falls back to the template's increment and says it is guessing. Past
 * the LAST entered step the next one is assumed at the list's own spacing
 * (70/80/90 → 100), and the call says so (2026-10-13: the 10/13 Leg Curls hit
 * 90 × 15 with 90 as the last entered pin and were told to build reps).
 *
 * Layer 4 is stalls: three consecutive valid sessions at one load with no new
 * best is "Stalled", with three checks (sleep under 7 h, intake under target,
 * mini-set rest over 10 s); five suggests swapping the exercise for a
 * variation.
 *
 * Bodyweight lifts build reps to max, then add load (5-10 lb) when the lifter
 * has a way to, else a harder variation or a slower tempo.
 *
 * Sets flagged `legacyEffortStandard` (logged on or before 2026-09-15, under
 * an inconsistent RIR standard) are history, not evidence: the engine skips
 * them entirely.
 *
 * ## What it deliberately does not do
 *
 * No soreness/pump prompts, no velocity, no deload scheduling, and it NEVER
 * mutates a template or a catalog exercise. It recommends; applying a call to
 * a template is `progression-apply.ts`, behind the lifter's tap or their
 * explicit auto-apply setting. The recommendation is frozen on the session
 * (`SessionExercise.recommendation`) so an override can be audited later.
 *
 * ## Straight sets
 *
 * Everything above is a property of the cluster protocol. An exercise logged
 * as plain working sets has no activation to read, so the engine dispatches to
 * double progression instead (ADR-0040). Applying the rep-range rules or the
 * mini rule to a straight set would invert the rule for every straight-set
 * user in the app — the same boundary `activation-validity.ts` draws.
 *
 * Pure, framework-free, shared by both apps (ADR-0012).
 */
import type {
  EffortStandard,
  ExerciseCategory,
  LoadChange,
  LogStyle,
  ProgressionBaseline,
  ProgressionRule,
  RepBand,
  RepRange,
  SessionExercise,
  SetStructure,
  WorkoutSet,
} from './workout';
import { CATEGORY_REP_RANGES, DEFAULT_EFFORT_STANDARD, DEFAULT_LOG_STYLE } from './workout';
import { ACTIVATION_RIR_MAX } from './activation-validity';
import { DEFAULT_INCREMENT_LB } from './load-units';
import { inferStructure, structureOf } from './set-structure';

// ─── Constants (stated once; the tests pin them) ────────────────

/** The first mini-set's readable band, inclusive. */
export const FIRST_MINI_MIN = 2;
export const FIRST_MINI_MAX = 5;
/** Sets logged on or before this date (inclusive) carry
 *  `legacyEffortStandard: true` — see `WorkoutSet`. Informational here; the
 *  engine reads the flag, never the date. */
export const LEGACY_EFFORT_CUTOFF = '2026-09-15';
// The fallback load step is `DEFAULT_INCREMENT_LB` from ./load-units — the
// same 5 lb the weight stepper assumes.
/** RETIRED 2026-10-24 (owner: "the smallest real step is always allowed").
 *  Until then a straight-set / rest-pause / cluster step larger than this
 *  fraction of the current load was refused as `jump-too-big` and the lift was
 *  told to build reps — which, on a light dumbbell or a coarse stack, was
 *  forever: 20 → 25 is +25 % and there is no smaller real weight. `loadCall`
 *  no longer applies it, because `nextLoad` only ever proposes the next REAL
 *  step (grid dumbbell, `availableLoads` entry, or +increment). Kept exported
 *  for the record and because `jump-too-big` reasons already stored or cached
 *  still name it. The myo-reps path never used it (Epley `step-too-big`). */
export const MAX_JUMP_PCT = 0.15;
/** Reps past `repRange.max` a lift may build before the engine stops asking
 *  for more reps and offers a technique instead. */
export const REP_CAP_EXTRA = 5;
/** Epley's denominator: e1RM = w × (1 + reps / 30). */
export const EPLEY_DIVISOR = 30;
/** Consecutive valid sessions at one load with no new best that make a stall. */
export const STALL_SESSIONS = 3;
/** …and that earn the suggestion to swap the exercise for a variation. */
export const SWAP_SESSIONS = 5;
/** Under this average sleep the stall checklist flags sleep. */
export const STALL_SLEEP_MIN_H = 7;
/** Over this mini-set rest the stall checklist flags the rest. */
export const STALL_MINI_REST_MAX_SEC = 10;
/** Added load a bodyweight lift starts at once it tops its range. */
export const BODYWEIGHT_START_LB: readonly [number, number] = [5, 10];

// ─── Layer 1: validity ──────────────────────────────────────────

export type InvalidReason =
  /** The activation has no rep count. */
  | 'reps-missing'
  /** No RIR on the activation. Retained for stored/rendered compatibility;
   *  never produced since 2026-10-13 — a missing RIR is read as 0 and flagged
   *  with the `rir-missing-assumed-0` warning instead. */
  | 'rir-missing'
  /** Activation at RIR {@link ACTIVATION_RIR_MAX}+ — not proximate to failure. */
  | 'rir-too-easy'
  /** No mini-set logged after the activation — the objective check cannot run. */
  | 'minis-missing'
  /** First mini above {@link FIRST_MINI_MAX}: the activation was too easy. */
  | 'first-mini-too-many'
  /** First mini below {@link FIRST_MINI_MIN}: the activation was too hard. */
  | 'first-mini-too-few'
  /** A mini out-repped its activation. */
  | 'mini-exceeds-activation'
  /** The load moved inside the lift — between clusters, or between an
   *  activation and its minis. Retained for stored/rendered compatibility;
   *  never produced since 2026-10-20 — the read is taken at the last
   *  cluster's activation load and flagged `mixedLoad` instead. */
  | 'load-changed'
  /** The template prescribes a cluster; the session logged straight sets. */
  | 'not-clustered';

export interface ClusterRead {
  group: number;
  load?: number;
  reps?: number;
  rir?: number;
  /** Logged mini rep counts, in order. */
  minis: number[];
  /** The first blocking issue on this cluster, or null when it is clean. */
  issue: InvalidReason | null;
  /** The activation carries `legacyEffortStandard`. */
  legacy: boolean;
  /** Reps were logged but RIR was not: the read assumes RIR 0. */
  rirAssumed: boolean;
  /** A performed mini in this cluster used a different load from its
   *  activation (10/20 Lat Pulldown: 90 × 8, minis at 80). */
  loadChanged: boolean;
}

export interface ExerciseRead {
  /** One entry per performed cluster, in performance order. Empty for a
   *  straight-set or untouched exercise. */
  clusters: ClusterRead[];
  /** The exercise-level issue (`load-changed`, `not-clustered`) or the first
   *  cluster issue; null when the read is clean. */
  issue: InvalidReason | null;
  /** Which cluster carried {@link issue}, when it was a cluster issue. */
  issueGroup?: number;
  valid: boolean;
  /** The load every cluster used, when it was one load. */
  load?: number;
  /** True when there was an activation set to read at all. */
  clustered: boolean;
  /** Any performed activation was logged under the legacy effort standard.
   *  Such a read is history, not evidence. */
  legacy: boolean;
  /** The load moved inside the lift — a mini off its activation's load, or
   *  clusters at different activation loads. The read stands, taken at
   *  {@link load} from the activation sets alone; the call says so. */
  mixedLoad?: boolean;
}

export interface ReadOptions {
  /** The template prescribed a cluster for this exercise. Turns a straight-set
   *  log into `not-clustered`. */
  expectsCluster?: boolean;
  /** Retired (2026-10-13): a missing RIR no longer blocks in any mode.
   *  Accepted so old callers compile; never read. */
  strictRir?: boolean;
}

const hasReps = (s: WorkoutSet) => s.reps != null;

/**
 * Layer 1. Group the exercise's sets into clusters and judge each one.
 *
 * A cluster is one activation set plus the minis that share its `group`;
 * an activation with no group is treated as group 1 so a hand-logged cluster
 * without numbering still reads. Only PERFORMED activations are judged — an
 * untouched scaffold row is a set that has not happened yet, not a bad one.
 */
export function readExercise(
  exercise: Pick<SessionExercise, 'sets' | 'logStyle'>,
  opts: ReadOptions = {},
): ExerciseRead {
  const style: LogStyle = exercise.logStyle ?? DEFAULT_LOG_STYLE;
  const none = (issue: InvalidReason | null, clustered = false): ExerciseRead => ({
    clusters: [], issue, valid: false, clustered, legacy: false,
  });
  // A timed hold has no reps to read. The engine is a rep engine; this is not
  // a defect in the log, it is the wrong instrument.
  if (style === 'time') return none(null);

  const activations = exercise.sets.filter((s) => s.kind === 'activation');
  if (activations.length === 0) {
    const performed = exercise.sets.some(hasReps);
    return none(opts.expectsCluster && performed ? 'not-clustered' : null);
  }

  const clusters: ClusterRead[] = [];
  for (const a of activations) {
    const group = a.group ?? 1;
    const minis = exercise.sets
      .filter((s) => s.kind === 'mini' && (s.group ?? 1) === group && hasReps(s))
      .map((s) => s.reps as number);
    // Nothing performed in this cluster: skip it rather than judge it.
    if (!hasReps(a) && minis.length === 0) continue;
    const loadChanged = exercise.sets.some(
      (s) => s.kind === 'mini' && (s.group ?? 1) === group && hasReps(s) && s.weight != null && a.weight != null && s.weight !== a.weight,
    );
    const read: ClusterRead = {
      group, load: a.weight, reps: a.reps, rir: a.rir, minis, issue: null,
      legacy: a.legacyEffortStandard === true,
      rirAssumed: a.reps != null && a.rir == null,
      loadChanged,
    };
    read.issue = clusterIssue(read);
    clusters.push(read);
  }
  if (clusters.length === 0) return none(null, true);
  const legacy = clusters.some((c) => c.legacy);

  // One load per read, from the ACTIVATIONS (owner, 2026-10-20). Until then
  // any load that moved — a mini at another weight (9/30 hammer curl
  // 20 → 15 → 20), or a second cluster at another load (9/15 calf raise
  // 40 / 35) — made the whole lift `load-changed` and the engine skipped it,
  // which is how the 10/20 Lat Pulldown (90 × 8, minis at 80) and the 10/15
  // Floor Crunch (25, then 30) produced no call. Now the read is taken at the
  // load of the LAST performed cluster's activation, the load the lifter ended
  // on: clusters at another activation load drop out of the read (they still
  // count as volume — volume reads sets, not this), and a cluster whose minis
  // moved is read from its activation, which is what e1RM is computed from
  // anyway. Drop sets are not read at all, as before.
  const loaded = clusters.filter((c) => c.load != null);
  const load = loaded.length ? loaded[loaded.length - 1].load : undefined;
  const read = load == null ? clusters : clusters.filter((c) => c.load == null || c.load === load);
  const mixedLoad = read.length < clusters.length || clusters.some((c) => c.loadChanged);
  const bad = read.find((c) => c.issue);
  return {
    clusters: read,
    issue: bad?.issue ?? null,
    ...(bad ? { issueGroup: bad.group } : {}),
    valid: !bad,
    load,
    clustered: true,
    legacy,
    ...(mixedLoad ? { mixedLoad: true } : {}),
  };
}

function clusterIssue(c: ClusterRead): InvalidReason | null {
  if (c.reps == null) return 'reps-missing';
  // RIR 0 is the standard, not an error (ADR-0039); only the top edge blocks.
  // A missing RIR is read as 0 (`effectiveReps`) and flagged by `recommend`.
  if (c.rir != null && c.rir > ACTIVATION_RIR_MAX) return 'rir-too-easy';
  if (c.minis.length === 0) return 'minis-missing';
  const first = c.minis[0];
  if (first > FIRST_MINI_MAX) return 'first-mini-too-many';
  if (first < FIRST_MINI_MIN) return 'first-mini-too-few';
  if (c.minis.some((m) => m > (c.reps as number))) return 'mini-exceeds-activation';
  return null;
}

/** Reps to failure an activation stands for: logged reps + logged RIR.
 *  Smith 13 @ RIR 1 is 14. A missing RIR adds nothing — it is read as 0. */
export function effectiveReps(c: Pick<ClusterRead, 'reps' | 'rir'>): number | undefined {
  if (c.reps == null) return undefined;
  return c.reps + (c.rir ?? 0);
}

/** The RIR a lift's activation is meant to stop at: 0 for `failure`, 1 for
 *  `rir1` (Program v2.1, 2026-10-15), 2 for `rir2` (Program v2.2, 2026-10-22).
 *  An unknown value reads as `failure`, the standard (ADR-0039). */
export function targetRirOf(standard: EffortStandard | undefined): number {
  return standard === 'rir2' ? 2 : standard === 'rir1' ? 1 : 0;
}

/**
 * Reps at the lift's target effort that put the load up next session, whatever
 * the step (owner, Program v2.2, 2026-10-22): every activation at ≥ 15 reps AT
 * THE TARGET RIR (`eff` in `rangeCall`) takes the smallest real step, even
 * where the Epley gate would hold and build reps toward max + 5. A lift past
 * 15 reps is a lift whose load is too light for the cut's purpose; the
 * first-session drop-back rule (Rule 5) is what catches a step that was too
 * big. Clustered (myo-reps) lifts only — a straight-set lift progresses on its
 * own prescription (`progression.targetReps`).
 */
export const REP_FLAG_AT = 15;

/**
 * The lowest RIR logged below the lift's target on a read, or null when every
 * logged RIR meets it (or the target is 0 — nothing is below failure). The
 * RIR-compliance warning (Program v2.2): soft, the read stands.
 */
export function rirBelowTarget(
  rirs: readonly (number | undefined)[],
  standard: EffortStandard | undefined,
): { logged: number; target: number } | null {
  const target = targetRirOf(standard);
  if (target === 0) return null;
  const below = rirs.filter((r): r is number => r != null && r < target);
  return below.length ? { logged: Math.min(...below), target } : null;
}

/**
 * Reps a lift would log at its TARGET RIR at `load`, from an e1RM (Program
 * v2.1): 30 × (e1RM / w − 1) − target RIR, floored, never negative. The e1RM
 * comes from the read's reps to failure (`effectiveReps`), so a 12 @ RIR 1
 * read is a 13-rep effort, and a `rir1` lift is predicted one rep short of it.
 */
export function predictedRepsAtTarget(e1rm: number, load: number, targetRir: number): number {
  return Math.max(0, predictedRepsAt(e1rm, load) - targetRir);
}

// ─── Per-lift configuration ─────────────────────────────────────

/** What the lift is loaded with — it decides the default load step. */
export type Equipment = 'dumbbell' | 'stack' | 'smith' | 'barbell' | 'plate' | 'bodyweight' | 'other';

/** Everything the rep-range rules need to know about one lift, resolved once
 *  by {@link resolveEngineConfig} so no caller re-derives a default. */
export interface EngineConfig {
  category: ExerciseCategory;
  /** Whether {@link category} was set by the lifter or inferred from the name. */
  categorySource: 'set' | 'inferred';
  repRange: RepRange;
  repRangeSource: 'set' | 'category';
  equipment: Equipment;
  /** The loads the equipment can be set to, ascending, when entered. */
  loadSteps?: number[];
  /** The step used when {@link loadSteps} is absent. */
  stepLb: number;
  /** Dumbbells move on a fixed grid of {@link stepLb} (17.5 → 20 on 2.5-lb
   *  steps; 17.5 → 20, not 22.5, on 5-lb ones) — the lifter's "Available
   *  dumbbell weights" setting. Absent for other equipment. */
  loadGrid?: number;
  /** A stack with no entered steps: the next load is a guess. */
  stepsUnknown: boolean;
  smithBarEffectiveLb?: number;
  /** Predictions use the plate load alone — a Smith lift with no bar weight. */
  approximate: boolean;
  effortStandard: EffortStandard;
  loadable: boolean;
  microplates: boolean;
  assisted: boolean;
}

const has = (re: RegExp, s: string) => re.test(s);

/**
 * The category a lift's name implies, for when the lifter has not set one.
 * Curls, extensions and raises are isolations (8-15) — the machine leg
 * extension and leg curl included, which are single-joint knee movements
 * (owner, 2026-10-13; the 10/07 spec had filed them as compounds, 6-12, so a
 * 14-rep leg extension read as "past the top"). Crunches are core, and
 * pull-ups, push-ups, dips and knee raises are bodyweight.
 */
export function inferCategory(name: string): ExerciseCategory {
  const n = name.toLowerCase();
  if (has(/pull-?ups?\b|chin-?ups?\b|push-?ups?\b|knee raise|leg raise|\bdips?\b/, n)) return 'bodyweight';
  if (has(/crunch|plank|twist|sit-?up|rollout|ab wheel|pallof|woodchop/, n)) return 'core';
  if (has(/lateral raise|rear delt|fl(y|ye|yes|ies)\b|curl|tricep|extension|pushdown|kickback|calf raise|skull|face pull|shrug/, n)) return 'isolation';
  return 'compound';
}

/** The equipment a lift's name implies. A stack is the one kind whose steps
 *  cannot be assumed — they differ by machine. */
export function inferEquipment(name: string): Equipment {
  const n = name.toLowerCase();
  if (has(/smith/, n)) return 'smith';
  if (has(/pull-?ups?\b|chin-?ups?\b|push-?ups?\b|knee raise|leg raise|\bdips?\b/, n)) return 'bodyweight';
  if (has(/\bdb\b|dumbbell/, n)) return 'dumbbell';
  if (has(/barbell|\bbb\b/, n)) return 'barbell';
  if (has(/machine|cable|pulldown|pushdown|leg (extension|curl)|stack|paramount/, n)) return 'stack';
  if (has(/crunch|plate/, n)) return 'plate';
  return 'other';
}

/** The catalog fields the engine reads, in the shape every caller has. */
export interface EngineCatalogFields {
  name?: string;
  logStyle?: LogStyle;
  availableLoads?: number[];
  assisted?: boolean;
  effortStandard?: EffortStandard;
  category?: ExerciseCategory;
  repRange?: RepRange;
  smithBarEffectiveLb?: number;
  loadable?: boolean;
  microplates?: boolean;
  /** The lifter's dumbbell step, lb (`dumbbellStepLb` from the profile's
   *  "2.5-lb steps" setting) — a user setting, merged into the catalog fields
   *  by the caller because every engine entry point already takes them.
   *  Absent → {@link DEFAULT_DUMBBELL_STEP_LB}. */
  dumbbellStepLb?: number;
}

/** "2.5-lb steps (17.5, 22.5…)" is on unless the lifter turns it off
 *  (Program v2.1): add-on plates or a gym's dumbbell rack. Off → 5-lb steps. */
export const DEFAULT_DUMBBELL_STEP_LB = 2.5;
export const DUMBBELL_STEPS_LB = { half: 2.5, whole: 5 } as const;

/** The dumbbell step for the profile's setting (`dumbbellHalfSteps`, absent
 *  = on). */
export function dumbbellStepLb(halfSteps: boolean | undefined): number {
  return halfSteps === false ? DUMBBELL_STEPS_LB.whole : DUMBBELL_STEPS_LB.half;
}

/** A rep range a lifter could actually mean: whole, positive, min ≤ max. */
export function isValidRepRange(r: unknown): r is RepRange {
  if (!r || typeof r !== 'object') return false;
  const { min, max } = r as RepRange;
  return Number.isInteger(min) && Number.isInteger(max) && min >= 1 && min <= max && max <= 100;
}

/**
 * Resolve one lift's configuration: the lifter's catalog fields first, then
 * the category default, then the equipment default. The template row only
 * contributes `progression.incrementLb`, and only as a stack's fallback step.
 */
export function resolveEngineConfig(
  catalog: EngineCatalogFields | null | undefined,
  template?: { name?: string; progression?: Partial<ProgressionRule> } | null,
): EngineConfig {
  const name = catalog?.name ?? template?.name ?? '';
  const category = catalog?.category ?? inferCategory(name);
  const repRange = isValidRepRange(catalog?.repRange) ? catalog!.repRange! : CATEGORY_REP_RANGES[category];
  const equipment: Equipment = catalog?.logStyle === 'bodyweight' ? 'bodyweight' : inferEquipment(name);
  const steps = (catalog?.availableLoads ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  const loadSteps = steps.length > 0 ? steps : undefined;
  const stack = equipment === 'stack';
  const dumbbell = equipment === 'dumbbell';
  const dbStep = catalog?.dumbbellStepLb != null && catalog.dumbbellStepLb > 0 ? catalog.dumbbellStepLb : DEFAULT_DUMBBELL_STEP_LB;
  const stepLb = stack ? (template?.progression?.incrementLb ?? DEFAULT_INCREMENT_LB) : dumbbell ? dbStep : DEFAULT_INCREMENT_LB;
  const bar = catalog?.smithBarEffectiveLb;
  return {
    category,
    categorySource: catalog?.category ? 'set' : 'inferred',
    repRange,
    repRangeSource: isValidRepRange(catalog?.repRange) ? 'set' : 'category',
    equipment,
    ...(loadSteps ? { loadSteps } : {}),
    stepLb,
    ...(dumbbell && !loadSteps ? { loadGrid: stepLb } : {}),
    stepsUnknown: stack && !loadSteps,
    ...(bar != null && bar >= 0 ? { smithBarEffectiveLb: bar } : {}),
    approximate: equipment === 'smith' && (bar == null || bar < 0),
    effortStandard: catalog?.effortStandard ?? DEFAULT_EFFORT_STANDARD,
    loadable: catalog?.loadable === true,
    microplates: catalog?.microplates === true,
    assisted: catalog?.assisted === true,
  };
}

/** Epley's estimated one-rep max: w × (1 + reps / 30). An estimate; it
 *  over-reads at high rep counts. */
export function epleyE1rm(load: number, reps: number): number {
  return load * (1 + reps / EPLEY_DIVISOR);
}

/** Reps expected at `nextLoad` from an e1RM: ⌊30 × (e1RM / w2 − 1)⌋, never
 *  negative. */
export function predictedRepsAt(e1rm: number, nextLoad: number): number {
  if (nextLoad <= 0) return 0;
  return Math.max(0, Math.floor(EPLEY_DIVISOR * (e1rm / nextLoad - 1) + 1e-9));
}

// ─── Layer 2: the recommendation ────────────────────────────────

export type RecommendAction =
  /** Every activation reached the top of the range and the next step is
   *  expected to land in range: take it. On an `assisted` lift this means
   *  LESS assistance. */
  | 'add-load'
  /** At least one cluster under the top of the range: same load, +1 rep. */
  | 'hold'
  /** Same load, build reps first — the next step is too big a jump, there is
   *  no heavier step, or a bodyweight lift is building toward its range. */
  | 'build-reps'
  /** The first session after an increase came in under the range: go back to
   *  the previous load and build. */
  | 'drop-back'
  /** The last read was invalid: repeat the load, fix the read. */
  | 'repeat-invalid'
  /** No usable history yet: log a session at the planned load. */
  | 'calibrate'
  /** Not a lift the engine reads; nothing to say. */
  | 'none';

/** What the lifter can do once reps are capped and the next step is still too
 *  big, in the order offered. */
export type CapTechnique = 'tempo' | 'microplates' | 'add-cluster';

export type RecommendReason =
  | { kind: 'no-history' }
  /** A straight-sets read (ADR-0040). `reps` is the BINDING set — the lowest
   *  rep count across the session's working sets, because double progression's
   *  claim is "the threshold was held", and it is not held by the set that
   *  fell short. `sessionsAtTarget` counts back from the most recent. */
  | { kind: 'straight-sets'; reps?: number; targetReps?: number;
      sessionsAtTarget: number; holdSessions: number }
  /** A rest-pause read (ADR-0040): TOTAL reps across the activation and its
   *  continuations, which is the quantity this structure produces. */
  | { kind: 'rest-pause'; total: number; targetReps: number;
      sessionsAtTarget: number; holdSessions: number }
  /** A cluster-set read (ADR-0040): how many PRESCRIBED blocks were completed.
   *  Not a rep count against a band — cluster sets are not autoregulated. */
  | { kind: 'cluster-sets'; completed: number; blocks: number;
      sessionsAtTarget: number; holdSessions: number }
  /** A HIT read (ADR-0040): the reps of the ONE set taken to failure. */
  | { kind: 'hit'; reps: number; targetReps: number;
      sessionsAtTarget: number; holdSessions: number }
  /** No target to progress against: the prescription states no
   *  `progression.targetReps` (straight / rest-pause) or no per-block
   *  `targetReps` (cluster), so there is no threshold to hold. */
  | { kind: 'no-rule' }
  /** Nothing in the latest session the engine can read — a timed hold, or a
   *  lift with no performed sets. Not a fault in the log. */
  | { kind: 'nothing-to-read' }
  /** The exercise is programmed as a structure the engine has no reader for
   *  (ADR-0040). Never a fall-through to another structure's rule. */
  | { kind: 'unsupported-structure'; structure: SetStructure }
  | { kind: 'invalid'; reason: InvalidReason; group?: number; firstMini?: number; rir?: number; reps?: number }
  /** LEGACY — no longer produced (2026-10-24). Straight-set double
   *  progression used to refuse a step over {@link MAX_JUMP_PCT}; the smallest
   *  real step is now always allowed. Kept so a reason already stored or
   *  cached still type-checks and still renders. */
  | { kind: 'jump-too-big'; nextLoad: number; jumpPct: number; repsGoal: number }
  // ── myo-reps, rep-range rules ──
  /** Every cluster at or over the top of the range, and the next step is
   *  expected to land in range. `reps` is the binding effective count. */
  /** {@link REP_FLAG_AT}: every activation at ≥ 15 reps at the target RIR, so
   *  the load goes up a step even though Epley predicts under the range. */
  | { kind: 'rep-flag'; reps: number; at: number; nextLoad: number; jumpPct: number; predictedReps: number }
  | { kind: 'increase'; reps: number; max: number; nextLoad: number; jumpPct: number;
      /** Absent where Epley cannot speak: assistance, or added load on a
       *  bodyweight lift (the body is most of the load and is not logged). */
      predictedReps?: number; e1rm?: number }
  /** A cluster sits under the top of the range. */
  | { kind: 'below-max'; reps: number; max: number; group?: number; clusters: number }
  /** At the top of the range, but the next step predicts fewer than `min`:
   *  build reps (to `repsForStep` when that is within `cap`). */
  | { kind: 'step-too-big'; reps: number; nextLoad: number; jumpPct: number; predictedReps: number;
      min: number; cap: number; repsForStep?: number }
  /** At the top of the range and there is no heavier step entered. */
  | { kind: 'no-next-step'; reps: number; cap: number }
  /** Reps are capped (max + 5) and the step is still too big (or absent):
   *  try a technique instead of more reps. */
  | { kind: 'at-rep-cap'; reps: number; cap: number; nextLoad?: number; jumpPct?: number;
      predictedReps?: number; techniques: CapTechnique[] }
  /** The first session after an increase came in under the range. */
  | { kind: 'drop-back'; reps: number; min: number; previousLoad: number }
  /** Bodyweight lift under the top of its range. */
  | { kind: 'bodyweight-build'; reps: number; max: number }
  /** Bodyweight lift at the top of its range, with added load available. */
  | { kind: 'bodyweight-add-load'; reps: number; max: number; startLb: readonly [number, number] }
  /** Bodyweight lift at the top of its range, with no way to add load. */
  | { kind: 'bodyweight-variation'; reps: number; max: number }
  // ── baseline marker (`TemplateExercise.baseline`) ──
  /** No session since the marker yet: this one sets the baseline. */
  | { kind: 'baseline-pending'; since: string; note: string }
  /** The first read since the marker IS the baseline: hold and build from it. */
  | { kind: 'baseline-set'; reps: number; note: string }
  /** The baseline read came in under the floor the marker set: drop back. */
  | { kind: 'baseline-drop-back'; reps: number; below: number; to: number; note: string }
  // ── a load the lifter set (`honourLifterLoad`) ──
  /** The lifter moved the template's load after the newest read: that load is
   *  the plan, and `engineLoad` is what the read alone would have said. */
  | { kind: 'lifter-load'; load: number; engineLoad: number };

export type RecommendWarning =
  /** An activation (or a straight working set) was logged closer to failure
   *  than the lift's target — RIR 0 on a `rir1` lift, RIR 0-1 on a `rir2`
   *  one. `Recommendation.rirBelowTarget` carries the numbers. Soft: the
   *  read stands. Was `failure-on-rir1` until Program v2.2 added `rir2`. */
  | 'below-target-rir'
  /** An activation was logged with reps and no RIR: the call read it as RIR 0
   *  (the fewest effective reps it can stand for). Soft: the read stands. */
  | 'rir-missing-assumed-0'
  /** The load moved inside the lift: the call was read from the activation
   *  set(s) at the last cluster's load (`ExerciseRead.mixedLoad`). Soft. */
  | 'load-changed-mid-cluster';

export interface ActivationSummary {
  group: number;
  reps?: number;
  rir?: number;
  firstMini?: number;
}

export interface Recommendation {
  action: RecommendAction;
  /** The load to use next session, pounds. Equals `currentLoad` on hold /
   *  repeat / build-reps / calibrate; the next step on add-load; the previous
   *  load on drop-back. Absent when unknown. */
  load?: number;
  /** The load the last session used. */
  currentLoad?: number;
  /** The last session's activation sets, one per cluster. */
  last: ActivationSummary[];
  reason: RecommendReason;
  /** True when the exercise's weight is assistance (less is progress). */
  assisted: boolean;
  /** The activation reps to aim for next session, as LOGGED (a `rir1` lift's
   *  target is one under its effective count). Absent when the call has no
   *  rep target (an invalid read, a technique at the cap). */
  targetReps?: number;
  /** On an increase: reps expected at the new load (to failure). */
  predictedReps?: number;
  /** Predictions use the plate load alone — see {@link EngineConfig.approximate}. */
  approximate: boolean;
  /** The call cites a next step past the last entered `availableLoads` entry,
   *  assumed at this spacing (lb). Absent when the step was entered. */
  assumedStepLb?: number;
  /** The rep range the call was made against (myo-reps only). */
  repRange?: RepRange;
  /** The resolved configuration (myo-reps only). */
  config?: EngineConfig;
  /** Soft flags that do not change the action. */
  warnings: RecommendWarning[];
  /** With the `below-target-rir` warning: the lowest RIR logged under the
   *  target, and the target ("logged RIR 0, target 1"). */
  rirBelowTarget?: { logged: number; target: number };
  /** Layer 4, when the lift has stalled. */
  stall?: StallReport;
}

/** Facts outside the logged sets that the stall checklist reads. Every one is
 *  optional; an absent fact reads as "unknown", never as fine. */
export interface StallContext {
  /** Average nightly sleep over the stalled sessions, hours. */
  sleepHours?: number;
  /** Whether intake ran under the calorie target over those sessions. */
  intakeBelowTarget?: boolean;
  /** The mini-set rest the template prescribes, seconds. */
  restMiniSec?: number;
}

export interface RecommendOptions extends ReadOptions {
  /** From the template's `progression`; `incrementLb` is a stack's fallback
   *  step and the straight-set readers' increment. */
  progression?: Partial<ProgressionRule>;
  /** From the catalog exercise. */
  availableLoads?: number[];
  assisted?: boolean;
  /** From the catalog exercise; defaults to {@link DEFAULT_EFFORT_STANDARD}. */
  effortStandard?: EffortStandard;
  /** Retired (2026-10-07). Accepted so old callers compile; never read. */
  targetRepBand?: RepBand;
  /** What the exercise is PROGRAMMED as (ADR-0040), resolved by `structureOf`
   *  from the template, then the catalog. Absent means "infer with the
   *  pre-0040 rule" from the latest session's set list. */
  structure?: SetStructure;
  /** The resolved per-lift configuration. Absent → resolved from the fields
   *  above with an inferred (compound) category. */
  config?: EngineConfig;
  /** The weekly volume rules allow one more cluster for this lift's muscle
   *  (`volumeCalls`). Offered at the rep cap only; never in a cut. */
  volumeAllowsCluster?: boolean;
  stallContext?: StallContext;
  /** The row's baseline marker. The caller must ALSO pass history filtered to
   *  it (`engineHistory`); this only changes how the first read is judged. */
  baseline?: ProgressionBaseline;
}

/**
 * Layer 3. The next load the equipment offers, and how big a step it is.
 *
 * `availableLoads` wins when present (a rack, a stack); otherwise the
 * template's increment; otherwise {@link DEFAULT_INCREMENT_LB}. On an
 * assisted lift "next" is the next LOWER assistance, floored at 0.
 *
 * Past the end of the entered steps, the next one is assumed at the list's
 * own spacing — the gap between its last two entries going up (70/80/90 →
 * 100), its first two going down — and `beyondSteps` says it was assumed. A
 * stack's pins are evenly spaced far more often than not, and "no heavier
 * step entered" stalled a lift that had earned one (10/13 Leg Curls, 90 × 15).
 * A one-entry list has no spacing and falls back to the increment.
 */
export function nextLoad(
  current: number,
  opts: { availableLoads?: number[]; incrementLb?: number; assisted?: boolean; grid?: number },
): { load: number; jumpPct: number; beyondSteps?: true } {
  const step = opts.incrementLb ?? DEFAULT_INCREMENT_LB;
  // A fixed grid (dumbbells): the next weight that exists, so an off-grid
  // load (17.5 on 5-lb dumbbells) lands on the grid, never past it.
  if (opts.grid != null && opts.grid > 0 && !(opts.availableLoads ?? []).some((x) => Number.isFinite(x))) {
    const g = opts.grid;
    const load = opts.assisted
      ? Math.max(0, (Math.ceil(current / g - 1e-9) - 1) * g)
      : (Math.floor(current / g + 1e-9) + 1) * g;
    const rounded = +load.toFixed(2);
    return { load: rounded, jumpPct: current > 0 ? Math.abs(rounded - current) / current : 0 };
  }
  const steps = [...new Set((opts.availableLoads ?? []).filter((x) => Number.isFinite(x)))].sort((a, b) => a - b);
  let load: number;
  let beyond = false;
  if (opts.assisted) {
    const lower = steps.filter((x) => x < current);
    const gap = steps.length >= 2 ? steps[1] - steps[0] : step;
    beyond = lower.length === 0 && steps.length > 0;
    load = lower.length ? lower[lower.length - 1] : Math.max(0, current - gap);
  } else {
    const higher = steps.filter((x) => x > current);
    const gap = steps.length >= 2 ? steps[steps.length - 1] - steps[steps.length - 2] : step;
    beyond = higher.length === 0 && steps.length > 0;
    load = higher.length ? higher[0] : current + gap;
  }
  load = +load.toFixed(2);
  const jumpPct = current > 0 ? Math.abs(load - current) / current : 0;
  return { load, jumpPct, ...(beyond ? { beyondSteps: true as const } : {}) };
}

/** Working sets that were actually performed, in log order. */
function workingReps(ex: SessionExercise): WorkoutSet[] {
  return ex.sets.filter((s) => s.kind === 'working' && s.reps != null);
}

/**
 * The BINDING rep count of a straight-sets session: the lowest across its
 * working sets.
 *
 * Double progression's claim is "the threshold was held for N sessions", and
 * a threshold is not held by the set that fell short of it. Taking the first
 * or the best set instead is the same defect `keySets` was written to close
 * for multi-cluster lifts — the app recommended load off half the evidence.
 */
function bindingStraight(
  ex: SessionExercise,
  targetRir = 0,
): { reps?: number; load?: number; rir?: number; atTarget?: number } {
  const sets = workingReps(ex);
  if (sets.length === 0) return {};
  const reps = Math.min(...sets.map((s) => s.reps as number));
  const loads = sets.map((s) => s.weight).filter((w): w is number => w != null);
  const rirs = sets.map((s) => s.rir).filter((r): r is number => r != null);
  // Program v2.2: on a lift with a target RIR above 0, a set holds the
  // prescription by its reps AT THE TARGET — 12 @ RIR 2 holds a 12-rep target
  // on a `rir2` lift, 12 @ RIR 1 (taken closer to failure) does not. A blank
  // RIR reads as 0, as on every other path. A `failure` lift keeps the plain
  // rep count, exactly as before.
  const atTarget =
    targetRir > 0 ? Math.min(...sets.map((s) => (s.reps as number) + (s.rir ?? 0) - targetRir)) : reps;
  return {
    reps,
    atTarget,
    ...(loads.length ? { load: Math.min(...loads) } : {}),
    ...(rirs.length ? { rir: Math.min(...rirs) } : {}),
  };
}

/**
 * Straight sets: deterministic double progression (ADR-0040).
 *
 * Bump the load once every working set has held `targetReps` for
 * `holdSessions` consecutive sessions at a non-decreasing load. Deliberately
 * NOT the myo-reps reader: no activation, no mini rule, no derived band. The
 * mini rule is meaningless here and must never run on this path.
 */
/** One session's read, in the shape every non-myo-reps structure shares:
 *  did it HOLD the prescription, and at what load. */
interface HeldRead {
  load?: number;
  held: boolean;
}

/**
 * Consecutive sessions, counting back from the most recent, that held the
 * prescription AT THE CURRENT LOAD.
 *
 * Any other load breaks the run, so a load change restarts the count by
 * construction — the rule ADR-0039 uses for the myo-reps calibration run, and
 * for the same reason: holding the target at 130 says nothing about whether
 * 135 has been held yet. Shared by every ADR-0040 reader so the three cannot
 * drift apart on what "held it for N sessions" means.
 */
function heldRun(
  history: readonly SessionExercise[],
  currentLoad: number | undefined,
  read: (ex: SessionExercise) => HeldRead,
): number {
  let n = 0;
  for (const h of history) {
    const r = read(h);
    if (!r.held || r.load !== currentLoad) break;
    n++;
  }
  return n;
}

/**
 * The add-load / build-reps decision, once a reader has counted its run.
 * Shared so the assisted/steps/grid handling cannot diverge between
 * structures.
 *
 * The smallest real step is always allowed (owner, 2026-10-24). `nextLoad`
 * proposes exactly one step — the next grid dumbbell, the next entered load,
 * or +increment — so whatever percentage that is, it is the smallest move the
 * equipment can make. The 15 % ceiling (`MAX_JUMP_PCT`) used to turn it into
 * `jump-too-big` → build reps, which on a 20-lb dumbbell or a 10-lb-pin stack
 * meant building reps with no end. That reason is no longer produced here.
 */
function loadCall(
  base: Pick<Recommendation, 'last' | 'assisted' | 'approximate' | 'warnings'>,
  opts: RecommendOptions,
  currentLoad: number | undefined,
  sessionsAtTarget: number,
  holdSessions: number,
  reason: RecommendReason,
): Recommendation {
  if (sessionsAtTarget >= holdSessions && currentLoad != null) {
    // The dumbbell grid (Settings → "2.5-lb steps", Program v2.1) applies to
    // every structure, not only myo-reps: a straight-set DB press moves
    // 20 → 22.5, never "build reps" toward a 25 that is a 25 % jump.
    const grid = opts.config?.loadGrid;
    const { load } = nextLoad(currentLoad, {
      availableLoads: opts.availableLoads,
      incrementLb: opts.progression?.incrementLb,
      assisted: base.assisted,
      ...(grid ? { grid } : {}),
    });
    return { ...base, action: 'add-load', load, currentLoad, reason };
  }
  return {
    ...base, action: 'build-reps',
    ...(currentLoad != null ? { load: currentLoad, currentLoad } : {}),
    reason,
  };
}

/** The sets a rest-pause / cluster read owns: the activation and the
 *  PRESCRIBED continuations that follow it. Never `mini` — that kind means
 *  autoregulated-to-failure and belongs to myo-reps (ADR-0040). */
function blockSets(ex: SessionExercise): WorkoutSet[] {
  return ex.sets.filter((s) => (s.kind === 'activation' || s.kind === 'continuation') && s.reps != null);
}

/** The single load a block ran at, or undefined when the sets disagree. */
function blockLoad(sets: readonly WorkoutSet[]): number | undefined {
  const loads = new Set(sets.map((s) => s.weight).filter((w): w is number => w != null));
  return loads.size === 1 ? [...loads][0] : undefined;
}

/**
 * Rest-pause: activation to failure, short rest, continue to failure.
 *
 * The read is TOTAL reps across the whole set — that is the quantity the
 * structure produces, and it is why the myo-reps first-mini rule is
 * meaningless here: a rest-pause continuation is SUPPOSED to be short, and
 * judging it against a 2-5 band would fault every correct set.
 */
function restPauseRead(ex: SessionExercise): { total?: number; load?: number } {
  const sets = blockSets(ex);
  if (sets.length === 0) return {};
  const total = sets.reduce((sum, s) => sum + (s.reps as number), 0);
  const load = blockLoad(sets);
  return { total, ...(load != null ? { load } : {}) };
}

/**
 * Cluster sets: PRESCRIBED reps per block with intra-set rest.
 *
 * Not autoregulated — which is exactly what separates this from myo-reps — so
 * the read is completion against the prescription, not a rep count against a
 * derived band. The prescription is each set's `targetReps`, snapshotted from
 * the template when the session started.
 */
function clusterSetRead(
  ex: SessionExercise,
): { done?: number; blocks?: number; prescribed: boolean; load?: number } {
  const sets = blockSets(ex);
  if (sets.length === 0) return { prescribed: false };
  const load = blockLoad(sets);
  const withTarget = sets.filter((s) => s.targetReps != null);
  // Nothing prescribed: there is no threshold to judge completion against.
  if (withTarget.length === 0) return { prescribed: false, ...(load != null ? { load } : {}) };
  const done = withTarget.filter((s) => (s.reps as number) >= (s.targetReps as number)).length;
  return { done, blocks: withTarget.length, prescribed: true, ...(load != null ? { load } : {}) };
}

function recommendRestPause(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, approximate: false, warnings: [] as RecommendWarning[],
  };
  if (history.length === 0) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const latest = restPauseRead(history[0]);
  const currentLoad = latest.load;
  if (latest.total == null) {
    return {
      ...base, action: 'none', ...(currentLoad != null ? { currentLoad } : {}),
      reason: { kind: 'nothing-to-read' },
    };
  }
  const targetReps = opts.progression?.targetReps;
  if (targetReps == null) {
    return { ...base, action: 'none', load: currentLoad, currentLoad, reason: { kind: 'no-rule' } };
  }
  const holdSessions = Math.max(1, opts.progression?.holdSessions ?? 1);
  const sessionsAtTarget = heldRun(history, currentLoad, (h) => {
    const r = restPauseRead(h);
    return { load: r.load, held: r.total != null && r.total >= targetReps };
  });
  const reason: RecommendReason = {
    kind: 'rest-pause', total: latest.total, targetReps, sessionsAtTarget, holdSessions,
  };
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason);
}

function recommendCluster(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, approximate: false, warnings: [] as RecommendWarning[],
  };
  if (history.length === 0) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const latest = clusterSetRead(history[0]);
  const currentLoad = latest.load;
  if (!latest.prescribed) {
    // Two different absences, and they are not the same failure. Nothing
    // logged is unreadable; sets logged with no prescribed reps is an absent
    // PRESCRIPTION — a cluster set is defined by its prescription, so without
    // one there is nothing to judge completion against.
    const logged = blockSets(history[0]).length > 0;
    return {
      ...base, action: 'none', ...(currentLoad != null ? { load: currentLoad, currentLoad } : {}),
      reason: logged ? { kind: 'no-rule' } : { kind: 'nothing-to-read' },
    };
  }
  const holdSessions = Math.max(1, opts.progression?.holdSessions ?? 1);
  const sessionsAtTarget = heldRun(history, currentLoad, (h) => {
    const r = clusterSetRead(h);
    return { load: r.load, held: r.prescribed && r.done === r.blocks };
  });
  const reason: RecommendReason = {
    kind: 'cluster-sets', completed: latest.done as number, blocks: latest.blocks as number,
    sessionsAtTarget, holdSessions,
  };
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason);
}

/**
 * HIT: ONE set taken to failure.
 *
 * The read is that set's reps, and the progression is the same double
 * progression every other non-myo-reps structure runs — hold `targetReps` for
 * `holdSessions` consecutive sessions at the current load, then add load. It
 * is a one-set straight read, which is why it reuses `heldRun` and `loadCall`
 * rather than growing a rule of its own.
 *
 * **The FIRST working set is the HIT set, not the lowest.** That is the one
 * deliberate difference from {@link bindingStraight}, and it follows from what
 * the structure prescribes: a HIT lift programmes exactly one set to failure,
 * so a second logged set is back-off work the prescription does not own.
 * Taking the minimum would let a light back-off set veto a qualifying effort
 * — the mirror image of the defect `bindingStraight` exists to prevent, where
 * the binding set is genuinely part of the prescription.
 *
 * No RIR gate, deliberately. "To failure" is the definition of the structure,
 * not a validity condition the engine re-checks; ADR-0039's effort standard
 * governs the myo-reps ACTIVATION set and adding it here would be new policy
 * no ADR has taken.
 */
function hitRead(ex: SessionExercise): { reps?: number; load?: number; rir?: number } {
  const set = workingReps(ex)[0];
  if (!set) return {};
  return {
    reps: set.reps as number,
    ...(set.weight != null ? { load: set.weight } : {}),
    ...(set.rir != null ? { rir: set.rir } : {}),
  };
}

function recommendHit(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, approximate: false, warnings: [] as RecommendWarning[],
  };
  if (history.length === 0) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const latest = hitRead(history[0]);
  const currentLoad = latest.load;
  // Declared `hit` but the latest session logged no working set — an
  // activation/mini-shaped log under a structure that does not own those
  // kinds. Reading reps out of them is the cross-structure guess ADR-0040
  // exists to refuse.
  if (latest.reps == null) {
    return { ...base, action: 'none', ...(currentLoad != null ? { currentLoad } : {}), reason: { kind: 'nothing-to-read' } };
  }
  const targetReps = opts.progression?.targetReps;
  if (targetReps == null) {
    return { ...base, action: 'none', load: currentLoad, currentLoad, reason: { kind: 'no-rule' } };
  }
  const holdSessions = Math.max(1, opts.progression?.holdSessions ?? 1);
  const sessionsAtTarget = heldRun(history, currentLoad, (h) => {
    const r = hitRead(h);
    return { load: r.load, held: r.reps != null && r.reps >= targetReps };
  });
  const reason: RecommendReason = {
    kind: 'hit', reps: latest.reps, targetReps, sessionsAtTarget, holdSessions,
  };
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason);
}

function recommendStraight(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, approximate: false, warnings: [] as RecommendWarning[],
  };
  if (history.length === 0) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const latest = bindingStraight(history[0]);
  const currentLoad = latest.load;
  // Declared `straight` but the latest session logged no working set — e.g. a
  // lift whose structure was switched while its log is still activation/mini
  // shaped. Reading a rep count out of sets this structure does not own would
  // be the exact cross-structure guess ADR-0040 forbids.
  if (latest.reps == null) {
    return { ...base, action: 'none', ...(currentLoad != null ? { currentLoad } : {}), reason: { kind: 'nothing-to-read' } };
  }
  const targetReps = opts.progression?.targetReps;
  const holdSessions = Math.max(1, opts.progression?.holdSessions ?? 1);

  // No stated target is not a failed read, it is an absent prescription. Say
  // so rather than invent a threshold the user never programmed.
  if (targetReps == null) {
    return { ...base, action: 'none', load: currentLoad, currentLoad, reason: { kind: 'no-rule' } };
  }

  const standard = opts.config?.effortStandard;
  const targetRir = targetRirOf(standard);
  const sessionsAtTarget = heldRun(history, currentLoad, (h) => {
    const r = bindingStraight(h, targetRir);
    return { load: r.load, held: r.atTarget != null && r.atTarget >= targetReps };
  });

  const reason: RecommendReason = {
    kind: 'straight-sets', targetReps, sessionsAtTarget, holdSessions,
    ...(latest.reps != null ? { reps: latest.reps } : {}),
  };
  // RIR compliance (Program v2.2): any working set logged under the target.
  const below = rirBelowTarget(workingReps(history[0]).map((s) => s.rir), standard);
  const judged = below ? { ...base, warnings: ['below-target-rir' as const], rirBelowTarget: below } : base;
  return loadCall(judged, opts, currentLoad, sessionsAtTarget, holdSessions, reason);
}

/**
 * Layers 1-4 for one exercise. `history` is the SAME exercise across recent
 * COMPLETED sessions, most-recent-first (what `exerciseHistory` returns).
 */
export function recommend(history: readonly SessionExercise[], opts: RecommendOptions = {}): Recommendation {
  // ADR-0040. Resolve the PRESCRIBED structure first and dispatch on it. The
  // fall-through is an explicit refusal, never another structure's reader:
  // an engine that guesses is worse than one that declines, and one that
  // declines silently is indistinguishable from one that is broken.
  const structure = opts.structure ?? inferStructure(history[0]?.sets);
  if (structure === 'straight') return recommendStraight(history, opts);
  if (structure === 'rest-pause') return recommendRestPause(history, opts);
  if (structure === 'cluster') return recommendCluster(history, opts);
  if (structure === 'hit') return recommendHit(history, opts);
  if (structure !== 'myoreps') {
    return {
      last: [], assisted: opts.assisted ?? false, approximate: false, warnings: [],
      action: 'none', reason: { kind: 'unsupported-structure', structure },
    };
  }

  // ─── myo-reps: the rep-range rules ────────────────────────────────
  const config = opts.config ?? resolveEngineConfig(
    {
      availableLoads: opts.availableLoads,
      assisted: opts.assisted,
      effortStandard: opts.effortStandard,
    },
    { progression: opts.progression },
  );
  const assisted = opts.assisted ?? config.assisted;
  // A declared myo-reps lift DOES expect a cluster, which is what makes a
  // straight-set log of it read as `not-clustered` instead of being ignored.
  // An explicit caller value still wins.
  const readOpts: RecommendOptions = { ...opts, expectsCluster: opts.expectsCluster ?? true };
  // Legacy reads (logged under the pre-2026-09-16 effort standard) are history,
  // not evidence: every rule below runs as if they were never logged.
  const reads = history.map((h) => readExercise(h, readOpts)).filter((r) => !r.legacy);
  const base = {
    last: [] as ActivationSummary[], assisted, approximate: config.approximate,
    repRange: config.repRange, config, warnings: [] as RecommendWarning[],
  };
  const read = reads[0];

  if (!read) {
    return opts.baseline
      ? { ...base, action: 'calibrate', reason: { kind: 'baseline-pending', since: opts.baseline.since, note: opts.baseline.reason } }
      : { ...base, action: 'calibrate', reason: { kind: 'no-history' } };
  }

  const summaries: ActivationSummary[] = read.clusters.map((c) => ({
    group: c.group, reps: c.reps, rir: c.rir, firstMini: c.minis[0],
  }));
  const currentLoad = read.load ?? read.clusters.find((c) => c.load != null)?.load;

  if (!read.clustered) {
    if (read.issue === 'not-clustered') {
      return {
        ...base, action: 'repeat-invalid', load: currentLoad, currentLoad, last: summaries,
        reason: { kind: 'invalid', reason: 'not-clustered' },
      };
    }
    // A myo-reps lift whose latest session is a timed hold, or one with
    // nothing performed yet: nothing to read, which is not a bad log.
    return { ...base, action: 'none', currentLoad, reason: { kind: 'nothing-to-read' } };
  }
  // Clustered, but no cluster performed (an unstarted scaffold): `readExercise`
  // answers `valid: false` with NO issue, which the gate below would turn into
  // an `invalid` call with no reason — it crashed the Finish sheet once.
  if (read.clusters.length === 0) {
    return { ...base, action: 'none', ...(currentLoad != null ? { currentLoad } : {}), reason: { kind: 'nothing-to-read' } };
  }

  // An activation logged closer to failure than the lift's target: say so,
  // but the mini rule decides validity. A blank RIR is not "below": it has its
  // own warning, and the call already reads it as 0.
  const below = rirBelowTarget(read.clusters.map((c) => (c.rirAssumed ? undefined : c.rir)), config.effortStandard);
  const warnings: RecommendWarning[] = [
    ...(below ? ['below-target-rir' as const] : []),
    // A blank RIR is read as 0, never as a reason to stop (2026-10-13).
    ...(read.clusters.some((c) => c.rirAssumed) ? ['rir-missing-assumed-0' as const] : []),
    ...(read.mixedLoad ? ['load-changed-mid-cluster' as const] : []),
  ];
  const judged = { ...base, warnings, last: summaries, currentLoad, ...(below ? { rirBelowTarget: below } : {}) };

  // Rule 1 — the validity gate. An invalid read repeats the load, always.
  if (!read.valid) {
    const bad = read.clusters.find((c) => c.group === read.issueGroup);
    return {
      ...judged, action: 'repeat-invalid', load: currentLoad,
      reason: {
        kind: 'invalid',
        reason: read.issue as InvalidReason,
        ...(read.issueGroup != null ? { group: read.issueGroup } : {}),
        ...(bad?.minis[0] != null ? { firstMini: bad.minis[0] } : {}),
        ...(bad?.rir != null ? { rir: bad.rir } : {}),
        ...(bad?.reps != null ? { reps: bad.reps } : {}),
      },
    };
  }

  // A baseline marker: the first read since it is the new baseline, not a
  // step in the old progression. Hold it — unless the marker set a floor and
  // the activation came in under it, which is the one case for going back.
  // From the second read on, the ordinary rules run over post-marker reads.
  if (opts.baseline && reads.length === 1) {
    const low = bindingCluster(read);
    // At the lift's target RIR, like every range judgement (Program v2.1):
    // 5 @ RIR 1 on a `rir1` lift is 5, under a floor of 6.
    const eff = Math.max(0, (effectiveReps(low) as number) - targetRirOf(config.effortStandard));
    const b = opts.baseline;
    if (b.dropBackTo != null && b.dropBackBelowReps != null && eff < b.dropBackBelowReps) {
      return {
        ...judged, action: 'drop-back', load: b.dropBackTo,
        reason: { kind: 'baseline-drop-back', reps: eff, below: b.dropBackBelowReps, to: b.dropBackTo, note: b.reason },
      };
    }
    return {
      ...judged, action: 'hold', load: read.load ?? currentLoad,
      reason: { kind: 'baseline-set', reps: eff, note: b.reason },
      targetReps: (low.reps as number) + 1,
    };
  }

  const call = rangeCall(reads, read, config, assisted, opts);
  const out: Recommendation = { ...judged, ...call };
  // Rule 6 — a stall is reported on a call that keeps the load; a lift that
  // is moving (or moving back) is not stalled.
  if (out.action === 'hold' || out.action === 'build-reps') {
    const stall = stallFrom(reads, opts.stallContext);
    if (stall) out.stall = stall;
  }
  return out;
}

/** The binding cluster of a read: fewest effective reps. */
function bindingCluster(read: ExerciseRead): ClusterRead {
  return [...read.clusters].sort((a, b) => (effectiveReps(a) as number) - (effectiveReps(b) as number))[0];
}

/** The load a read was performed at, as a key: a bodyweight cluster (no
 *  weight on any set) is load 0; a read whose loads disagree has no key. */
function loadKey(r: ExerciseRead): number | undefined {
  if (!r.clustered || r.issue === 'load-changed') return undefined;
  return r.load ?? 0;
}

/**
 * Rules 2-5 and 7-8 on a VALID read. Returns the call without the shared
 * fields (`last`, `warnings`, …), which the caller owns.
 */
function rangeCall(
  reads: readonly ExerciseRead[],
  read: ExerciseRead,
  config: EngineConfig,
  assisted: boolean,
  opts: RecommendOptions,
): Pick<Recommendation, 'action' | 'load' | 'reason' | 'targetReps' | 'predictedReps' | 'assumedStepLb'> {
  const call = rangeRules(reads, read, config, assisted, opts);
  // The ≥ 15 flag (owner, Program v2.2): every activation at ≥ 15 reps at the
  // target RIR takes the smallest real step next session. It OVERRIDES a call
  // that kept the load — Rule 4 on a range running past 15, the Epley gate's
  // "step too big", the rep cap's techniques — and leaves every other call
  // exactly as it was: a normal increase keeps its own reason and e1RM. Not
  // for assisted or bodyweight lifts: they already step on the rep rule alone.
  if (call.action === 'add-load' || assisted || config.category === 'bodyweight') return call;
  const targetRir = targetRirOf(config.effortStandard);
  const low = bindingCluster(read);
  const effToFailure = effectiveReps(low) as number;
  const eff = Math.max(0, effToFailure - targetRir);
  const loadNow = read.load ?? 0;
  if (eff < REP_FLAG_AT || loadNow <= 0) return call;
  const step = nextStep(loadNow, config, assisted);
  if (!step) return call;
  const bar = config.smithBarEffectiveLb ?? 0;
  const predicted = predictedRepsAtTarget(epleyE1rm(loadNow + bar, effToFailure), step.load + bar, targetRir);
  return {
    action: 'add-load', load: step.load,
    reason: { kind: 'rep-flag', reps: eff, at: REP_FLAG_AT, nextLoad: step.load, jumpPct: step.jumpPct, predictedReps: predicted },
    predictedReps: predicted,
    targetReps: Math.max(1, predicted),
    ...(step.beyondSteps ? { assumedStepLb: +Math.abs(step.load - loadNow).toFixed(2) } : {}),
  };
}

/** Rules 2-5 and 7-8 as written on 2026-10-07 — {@link rangeCall} adds the
 *  Program v2.2 flag on top. */
function rangeRules(
  reads: readonly ExerciseRead[],
  read: ExerciseRead,
  config: EngineConfig,
  assisted: boolean,
  opts: RecommendOptions,
): Pick<Recommendation, 'action' | 'load' | 'reason' | 'targetReps' | 'predictedReps' | 'assumedStepLb'> {
  const { min, max } = config.repRange;
  const cap = max + REP_CAP_EXTRA;
  const multi = read.clusters.length > 1;
  const low = bindingCluster(read);
  // Program v2.1: the range is judged at the lift's TARGET RIR. `eff` is the
  // reps to failure the read stands for (logged + RIR); `at` is what it would
  // log at the target — a `rir1` lift reaches the top of 6-12 at 12 @ RIR 1,
  // not 11 @ RIR 1. For a `failure` lift the two are the same number.
  const targetRir = targetRirOf(config.effortStandard);
  const effToFailure = effectiveReps(low) as number;
  const eff = Math.max(0, effToFailure - targetRir);
  const lowLogged = low.reps as number;
  const loadNow = read.load ?? 0;

  // Rule 7 — a bodyweight lift (no load on it) builds reps to the top of its
  // range, then adds load if the lifter can, else gets harder another way.
  if (loadNow === 0 && !assisted) {
    if (eff < max) {
      return {
        action: 'build-reps', reason: { kind: 'bodyweight-build', reps: eff, max },
        targetReps: lowLogged + 1,
      };
    }
    if (config.loadable) {
      return {
        action: 'add-load', load: BODYWEIGHT_START_LB[0],
        reason: { kind: 'bodyweight-add-load', reps: eff, max, startLb: BODYWEIGHT_START_LB },
      };
    }
    return { action: 'build-reps', load: 0, reason: { kind: 'bodyweight-variation', reps: eff, max } };
  }

  // Rule 5 — the first session after an increase, under the range: go back.
  // "After an increase" is read off the log, not a stored flag: the session
  // before this one was performed at a LOWER load.
  const prev = reads.slice(1).find((r) => loadKey(r) != null);
  const prevLoad = prev ? loadKey(prev) : undefined;
  if (!assisted && prevLoad != null && prevLoad > 0 && loadNow > prevLoad && eff < min) {
    return {
      action: 'drop-back', load: prevLoad,
      reason: { kind: 'drop-back', reps: eff, min, previousLoad: prevLoad },
    };
  }

  // Rule 4 — any cluster under the top of the range: hold, one more rep.
  if (eff < max) {
    return {
      action: 'hold', load: loadNow,
      reason: { kind: 'below-max', reps: eff, max, clusters: read.clusters.length, ...(multi ? { group: low.group } : {}) },
      // One more rep AT THE TARGET RIR — the text says "@ RIR 1" for a
      // `rir1` lift, so 12 @ RIR 0 asks for 12 there, not 13.
      targetReps: (targetRir > 0 ? eff : lowLogged) + 1,
    };
  }

  // Rule 3 — every cluster at or over the top: a load-increase candidate.
  const next = nextStep(loadNow, config, assisted);
  // A step past the entered list is a guess; every call that cites it says so.
  const assumed = next?.beyondSteps ? { assumedStepLb: +Math.abs(next.load - loadNow).toFixed(2) } : {};
  if (assisted || config.category === 'bodyweight') {
    // Less assistance, or more added load on a bodyweight lift: Epley needs the
    // TOTAL load and the body is most of it, unlogged. Take the step on the rep
    // rule alone rather than predict off a number that is not the load.
    return next
      ? { action: 'add-load', load: next.load, reason: { kind: 'increase', reps: eff, max, nextLoad: next.load, jumpPct: next.jumpPct }, ...assumed }
      : { action: 'build-reps', load: loadNow, reason: { kind: 'no-next-step', reps: eff, cap } };
  }
  const bar = config.smithBarEffectiveLb ?? 0;
  const e1rm = epleyE1rm(loadNow + bar, effToFailure);
  const techniques = (): CapTechnique[] => [
    'tempo',
    ...(config.microplates ? ['microplates' as const] : []),
    ...(opts.volumeAllowsCluster ? ['add-cluster' as const] : []),
  ];
  if (!next) {
    return eff >= cap
      ? { action: 'build-reps', load: loadNow, reason: { kind: 'at-rep-cap', reps: eff, cap, techniques: techniques() } }
      : { action: 'build-reps', load: loadNow, reason: { kind: 'no-next-step', reps: eff, cap }, targetReps: lowLogged + 1 };
  }
  const predictedReps = predictedRepsAtTarget(e1rm, next.load + bar, targetRir);
  if (predictedReps >= min) {
    return {
      action: 'add-load', load: next.load,
      reason: { kind: 'increase', reps: eff, max, nextLoad: next.load, jumpPct: next.jumpPct, predictedReps, e1rm },
      predictedReps,
      targetReps: Math.max(1, predictedReps),
      ...assumed,
    };
  }
  if (eff >= cap) {
    return {
      action: 'build-reps', load: loadNow,
      reason: { kind: 'at-rep-cap', reps: eff, cap, nextLoad: next.load, jumpPct: next.jumpPct, predictedReps, techniques: techniques() },
      ...assumed,
    };
  }
  // The reps at this load (at the target RIR) that would predict `min` at the
  // next one: w(1 + (r + t)/30) ≥ w2(1 + (min + t)/30). Offered only when it is
  // inside the cap.
  const need = Math.ceil(EPLEY_DIVISOR * (((next.load + bar) * (1 + (min + targetRir) / EPLEY_DIVISOR)) / (loadNow + bar) - 1) - 1e-9) - targetRir;
  return {
    action: 'build-reps', load: loadNow,
    reason: {
      kind: 'step-too-big', reps: eff, nextLoad: next.load, jumpPct: next.jumpPct, predictedReps, min, cap,
      ...(need > eff && need <= cap ? { repsForStep: need } : {}),
    },
    targetReps: lowLogged + 1,
    ...assumed,
  };
}

/** The next step from `current` — past the entered steps it is assumed at
 *  their spacing ({@link nextLoad}). Null only for an assisted lift already at
 *  no assistance: there is nothing lighter to take away. */
function nextStep(
  current: number,
  config: EngineConfig,
  assisted: boolean,
): { load: number; jumpPct: number; beyondSteps?: true } | null {
  if (assisted && current <= 0) return null;
  return nextLoad(current, { availableLoads: config.loadSteps, incrementLb: config.stepLb, assisted, ...(config.loadGrid ? { grid: config.loadGrid } : {}) });
}

/** Back-compat: the engine's view of a lift's configuration with no catalog
 *  doc — callers that want the full resolution use {@link resolveEngineConfig}. */
export function configFromOptions(opts: RecommendOptions): EngineConfig {
  return opts.config ?? resolveEngineConfig(
    { availableLoads: opts.availableLoads, assisted: opts.assisted, effortStandard: opts.effortStandard },
    { progression: opts.progression },
  );
}

// ─── Layer 4: stalls ────────────────────────────────────────────

export type StallCheckKind = 'sleep' | 'intake' | 'mini-rest';

export interface StallCheck {
  check: StallCheckKind;
  /** `flag` — this is a likely cause; `ok` — it is not; `unknown` — no data. */
  status: 'flag' | 'ok' | 'unknown';
  /** The number the status was judged on, when there is one. */
  value?: number;
}

export interface StallReport {
  /** Valid sessions at {@link load} since the last new best, inclusive. */
  sessions: number;
  load: number;
  /** Binding effective reps per session in the run, most-recent-first. */
  reps: number[];
  /** The three things to rule out first, in order. */
  checks: StallCheck[];
  /** {@link SWAP_SESSIONS} or more: suggest a variation of the exercise. */
  suggestSwap: boolean;
}

/**
 * Layer 4. Walk the valid reads at the CURRENT load (invalid ones are skipped,
 * not counted — they say nothing about progress; a different load ends the
 * run, because a load change IS progress or a reset). Counting forward from
 * the oldest, every new best restarts the count; the count that is left is
 * the sessions since the lift last improved. Three is a stall.
 */
export function detectStall(
  history: readonly SessionExercise[],
  opts: RecommendOptions = {},
): StallReport | null {
  const reads = history
    .map((h) => readExercise(h, { ...opts, expectsCluster: opts.expectsCluster ?? true }))
    .filter((r) => !r.legacy);
  return stallFrom(reads, opts.stallContext);
}

function stallFrom(reads: readonly ExerciseRead[], ctx: StallContext = {}): StallReport | null {
  const first = reads.find((r) => r.valid);
  if (!first) return null;
  const load = loadKey(first);
  if (load == null) return null;
  const run: number[] = [];
  for (const r of reads) {
    if (!r.clustered) break;
    const k = loadKey(r);
    if (k == null) continue;
    if (k !== load) break;
    if (!r.valid) continue;
    run.push(effectiveReps(bindingCluster(r)) as number);
  }
  // Oldest first: a new best restarts the count.
  const oldestFirst = [...run].reverse();
  let best = -Infinity;
  let count = 0;
  for (const reps of oldestFirst) {
    if (reps > best) { best = reps; count = 1; } else count += 1;
  }
  if (count < STALL_SESSIONS) return null;
  const checks: StallCheck[] = [
    ctx.sleepHours == null
      ? { check: 'sleep', status: 'unknown' }
      : { check: 'sleep', status: ctx.sleepHours < STALL_SLEEP_MIN_H ? 'flag' : 'ok', value: ctx.sleepHours },
    ctx.intakeBelowTarget == null
      ? { check: 'intake', status: 'unknown' }
      : { check: 'intake', status: ctx.intakeBelowTarget ? 'flag' : 'ok' },
    ctx.restMiniSec == null
      ? { check: 'mini-rest', status: 'unknown' }
      : { check: 'mini-rest', status: ctx.restMiniSec > STALL_MINI_REST_MAX_SEC ? 'flag' : 'ok', value: ctx.restMiniSec },
  ];
  return { sessions: count, load, reps: run.slice(0, count), checks, suggestSwap: count >= SWAP_SESSIONS };
}

// ─── The call, as the finish sheet names it ─────────────────────

/** The five calls the lifter sees on the finish sheet, plus the quiet ones. */
export type ProgressionCall = 'increase' | 'hold' | 'drop' | 'repeat-invalid' | 'stalled' | 'start' | 'none';

export function progressionCall(rec: Pick<Recommendation, 'action' | 'stall'>): ProgressionCall {
  switch (rec.action) {
    case 'add-load': return 'increase';
    case 'drop-back': return 'drop';
    case 'repeat-invalid': return 'repeat-invalid';
    case 'hold':
    case 'build-reps': return rec.stall ? 'stalled' : 'hold';
    case 'calibrate': return 'start';
    case 'none': return 'none';
  }
}

// ─── Wiring helpers ─────────────────────────────────────────────

/**
 * A load the LIFTER put on the template after the engine's newest read wins
 * over the engine's call (owner, 2026-10-09). The engine reads only logged
 * sessions, so a load the lifter confirmed between sessions — Wide-grip lat
 * pulldown 80 → 90 on 10/7, after 80 × 12 — is invisible to it, and it would
 * call "add load: 85" over the 90 the lifter chose. Since the session's sets
 * start at the call's load, that call would undo the choice.
 *
 * Only the lifter's own move counts: the row's newest `loadLog` entry, made by
 * a person (`user` or `prompt`, never `engine`), that still matches
 * `targetLoad` and is newer than the session the call was read from. The
 * result is a hold at that load with no rep target — the old read says
 * nothing about reps at a load it was not lifted at — and the session after
 * it is read like any other. `none` and a call with no load pass through.
 */
export function honourLifterLoad(
  rec: Recommendation,
  row: { targetLoad?: number; loadLog?: readonly LoadChange[] } | null | undefined,
  lastReadAt: Date | undefined,
): Recommendation {
  const load = row?.targetLoad;
  const last = row?.loadLog?.[row.loadLog.length - 1];
  if (rec.action === 'none' || rec.load == null || load == null || !last) return rec;
  if (last.by === 'engine' || Math.abs(last.to - load) >= 0.01 || Math.abs(rec.load - load) < 0.01) return rec;
  const at = Date.parse(last.at);
  if (Number.isNaN(at) || (lastReadAt != null && at <= lastReadAt.getTime())) return rec;
  const { targetReps: _t, predictedReps: _p, ...rest } = rec;
  return { ...rest, action: 'hold', load, reason: { kind: 'lifter-load', load, engineLoad: rec.load } };
}


/**
 * The engine options for one template row — the prescription (cluster or
 * not, increment) from the template; the equipment (steps, assisted), the
 * effort standard and the rep-range configuration from the catalog exercise.
 * Both apps build options through this so they cannot disagree about which
 * field means what.
 */
export function recommendOptionsFor(
  templateExercise: {
    name?: string;
    plannedSets: readonly { kind: string }[];
    progression?: Partial<ProgressionRule>;
    setStructure?: SetStructure;
    baseline?: ProgressionBaseline;
  } | null | undefined,
  catalogExercise: (EngineCatalogFields & {
    targetRepBand?: RepBand;
    setStructure?: SetStructure;
  }) | null | undefined,
  /** The logged sets to infer from when there is no template row — an ad-hoc
   *  exercise, where the log is the only statement of intent there is. Never
   *  consulted when a template states a structure (ADR-0040). */
  fallbackSets?: readonly { kind: string }[],
): RecommendOptions {
  const expectsCluster = (templateExercise?.plannedSets ?? []).some((p) => p.kind === 'activation');
  const structure = structureOf(
    templateExercise ?? undefined,
    catalogExercise ?? undefined,
    templateExercise?.plannedSets ?? fallbackSets,
  );
  return {
    expectsCluster,
    structure,
    ...(templateExercise?.progression ? { progression: templateExercise.progression } : {}),
    ...(templateExercise?.baseline ? { baseline: templateExercise.baseline } : {}),
    ...(catalogExercise?.availableLoads ? { availableLoads: catalogExercise.availableLoads } : {}),
    ...(catalogExercise?.assisted != null ? { assisted: catalogExercise.assisted } : {}),
    ...(catalogExercise?.effortStandard ? { effortStandard: catalogExercise.effortStandard } : {}),
    config: resolveEngineConfig(catalogExercise, templateExercise),
  };
}

/** The storable subset of a recommendation (`SessionExercise.recommendation`). */
export function toRecommendationSnapshot(
  rec: Recommendation,
  basedOn?: Date,
): { action: string; load?: number; basedOn?: string; targetReps?: number; predictedReps?: number } {
  return {
    action: rec.action,
    ...(rec.load != null ? { load: rec.load } : {}),
    ...(basedOn ? { basedOn: basedOn.toISOString() } : {}),
    ...(rec.targetReps != null ? { targetReps: rec.targetReps } : {}),
    ...(rec.predictedReps != null ? { predictedReps: rec.predictedReps } : {}),
  };
}

/**
 * Whether a finished session followed its frozen recommendation. `null` when
 * there was no recommendation with a load, or no loaded activation to compare.
 * The audit trail the spec asks for: every override is visible from the data.
 */
export function followedRecommendation(exercise: SessionExercise): boolean | null {
  const rec = exercise.recommendation;
  if (!rec || rec.load == null) return null;
  const used = exercise.sets.find((s) => s.kind === 'activation' && s.weight != null)?.weight;
  if (used == null) return null;
  return Math.abs(used - rec.load) < 0.01;
}
