/**
 * The progression engine — what the next session should do with each lift,
 * derived from logged sets and nothing else.
 *
 * ## The order is the design
 *
 * Layer 1 (validity) runs FIRST and blocks everything after it. Self-reported
 * RIR is unreliable (Steele 2017, Halperin, Refalo 2024 — see
 * `activation-validity.ts`); the mini-set rep count is objective. In myo-reps
 * an activation set at RIR 1-2 is followed by mini-sets after 5-10 s, and the
 * published rule reads the FIRST mini as a measurement of the activation:
 *
 *     first mini > 5 reps  → the activation was too easy   → read INVALID
 *     first mini < 2 reps  → the activation was too hard   → read INVALID
 *     first mini 2-5 reps  → read VALID
 *
 * An invalid read never produces a load recommendation. It produces "repeat
 * <load> — read invalid" and the specific reason. That is the single most
 * important rule in this module: advancing load off a read that cannot support
 * the claim corrupts every session that follows it.
 *
 * Layer 2 (progression) reads the ACTIVATION SET ONLY. Minis never drive load.
 * A multi-cluster lift advances only when EVERY activation lands in band
 * (`keySets` in `workout-progression.ts` closed the half-evidence bug this
 * generalises), and the blocking cluster is named.
 *
 * Layer 3 (increments) refuses to recommend a load the equipment cannot be
 * set to, or a jump over {@link MAX_JUMP_PCT} — except on a lift that is
 * plainly under-loaded, where the cap would be the engine protecting a number
 * the lifter has already left behind.
 *
 * Layer 4 (stalls) counts consecutive sessions at one load and, at three,
 * says WHY rather than just that.
 *
 * ## What it deliberately does not do
 *
 * No soreness/pump prompts, no %1RM, no velocity, no deload scheduling, and it
 * NEVER mutates a template. It recommends; the lifter accepts or overrides,
 * and the recommendation is frozen on the session (`SessionExercise.
 * recommendation`) so the override can be audited later.
 *
 * ## Straight sets
 *
 * Everything above is a property of the cluster protocol. An exercise logged
 * as plain working sets has no activation to read, so the engine returns
 * `action: 'none'` and the caller keeps whatever it did before (double
 * progression via `suggestProgression`). Applying the RIR band or the mini
 * rule to a straight set would invert the rule for every straight-set user in
 * the app — the same boundary `activation-validity.ts` draws.
 *
 * Pure, framework-free, shared by both apps (ADR-0012).
 */
import type { LogStyle, ProgressionRule, SessionExercise, WorkoutSet } from './workout';
import { DEFAULT_LOG_STYLE } from './workout';
import { ACTIVATION_RIR_MAX, ACTIVATION_RIR_MIN } from './activation-validity';
import { DEFAULT_INCREMENT_LB } from './load-units';

// ─── Constants (stated once; the tests pin them) ────────────────

/** The first mini-set's readable band, inclusive. */
export const FIRST_MINI_MIN = 2;
export const FIRST_MINI_MAX = 5;
/** Rep target when the template carries no `progression.targetReps`. The band
 *  is `[target - 1, target]` — 11-12 by default. */
export const DEFAULT_TARGET_REPS = 12;
// The fallback load step is `DEFAULT_INCREMENT_LB` from ./load-units — the
// same 5 lb the weight stepper assumes, one number for "the smallest step we
// assume exists" when neither the equipment nor the template says.
/** A load step larger than this fraction of the current load is not
 *  recommended; the engine asks for two more reps first. */
export const MAX_JUMP_PCT = 0.15;
/** Extra reps to build before taking a too-large step. */
export const BUILD_REPS_EXTRA = 2;
/** Consecutive same-load sessions that make a stall. */
export const STALL_SESSIONS = 3;
/** Consecutive same-load sessions that earn an intervention list. */
export const INTERVENTION_SESSIONS = 5;

// ─── Layer 1: validity ──────────────────────────────────────────

export type InvalidReason =
  /** The activation has no rep count. */
  | 'reps-missing'
  /** No RIR on the activation. Blocks only in strict mode (clustered lifts). */
  | 'rir-missing'
  /** Activation at RIR 0 — taken to failure; the minis are not the protocol's. */
  | 'rir-to-failure'
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
  /** Load differed between clusters of the same exercise. */
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
}

export interface ReadOptions {
  /** The template prescribed a cluster for this exercise. Turns a straight-set
   *  log into `not-clustered` and makes a missing RIR blocking. */
  expectsCluster?: boolean;
  /** Override for the missing-RIR policy. Defaults to `expectsCluster`. */
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
  const strict = opts.strictRir ?? opts.expectsCluster ?? false;
  const none = (issue: InvalidReason | null, clustered = false): ExerciseRead => ({
    clusters: [], issue, valid: false, clustered,
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
    const read: ClusterRead = { group, load: a.weight, reps: a.reps, rir: a.rir, minis, issue: null };
    read.issue = clusterIssue(read, strict);
    clusters.push(read);
  }
  if (clusters.length === 0) return none(null, true);

  const loads = new Set(clusters.map((c) => c.load).filter((w): w is number => w != null));
  const load = loads.size === 1 ? [...loads][0] : undefined;
  if (loads.size > 1) {
    return { clusters, issue: 'load-changed', valid: false, clustered: true };
  }
  const bad = clusters.find((c) => c.issue);
  return {
    clusters,
    issue: bad?.issue ?? null,
    ...(bad ? { issueGroup: bad.group } : {}),
    valid: !bad,
    load,
    clustered: true,
  };
}

function clusterIssue(c: ClusterRead, strict: boolean): InvalidReason | null {
  if (c.reps == null) return 'reps-missing';
  if (c.rir == null) {
    if (strict) return 'rir-missing';
  } else {
    if (c.rir < ACTIVATION_RIR_MIN) return 'rir-to-failure';
    if (c.rir > ACTIVATION_RIR_MAX) return 'rir-too-easy';
  }
  if (c.minis.length === 0) return 'minis-missing';
  const first = c.minis[0];
  if (first > FIRST_MINI_MAX) return 'first-mini-too-many';
  if (first < FIRST_MINI_MIN) return 'first-mini-too-few';
  if (c.minis.some((m) => m > (c.reps as number))) return 'mini-exceeds-activation';
  return null;
}

// ─── Layer 2 + 3: the recommendation ────────────────────────────

export type RecommendAction =
  /** Every activation landed in band (or over it): take the next load. On an
   *  `assisted` lift this means LESS assistance. */
  | 'add-load'
  /** Below band on at least one cluster: same load, build reps. */
  | 'hold'
  /** In band, but the next available load is too big a step: same load,
   *  build {@link BUILD_REPS_EXTRA} more reps first. */
  | 'build-reps'
  /** The last read was invalid: repeat the load, fix the read. */
  | 'repeat-invalid'
  /** No readable history: the first session is a calibration, not a read. */
  | 'calibrate'
  /** Not a clustered lift; the engine has nothing to say. */
  | 'none';

export type RecommendReason =
  | { kind: 'no-history' }
  | { kind: 'straight-sets' }
  | { kind: 'invalid'; reason: InvalidReason; group?: number; firstMini?: number; rir?: number; reps?: number }
  | { kind: 'in-band'; reps: number; rir?: number }
  | { kind: 'over-band'; reps: number; rir?: number }
  | { kind: 'below-band'; reps: number; group?: number; clusters: number }
  | { kind: 'jump-too-big'; nextLoad: number; jumpPct: number; repsGoal: number };

export interface ActivationSummary {
  group: number;
  reps?: number;
  rir?: number;
  firstMini?: number;
}

export interface Recommendation {
  action: RecommendAction;
  /** The load to use next session, pounds. Equals `currentLoad` on hold /
   *  repeat / build-reps; the next step on add-load. Absent when unknown. */
  load?: number;
  /** The load the last session used. */
  currentLoad?: number;
  /** The last session's activation sets, one per cluster. */
  last: ActivationSummary[];
  reason: RecommendReason;
  /** True when the exercise's weight is assistance (less is progress). */
  assisted: boolean;
  /** The rep band the activation is judged against, inclusive. */
  band: { lo: number; hi: number };
  /** Layer 4, when there is enough history. */
  stall?: StallReport;
}

export interface RecommendOptions extends ReadOptions {
  /** From the template's `progression`; the band is `[targetReps-1, targetReps]`. */
  progression?: Partial<ProgressionRule>;
  /** From the catalog exercise. */
  availableLoads?: number[];
  assisted?: boolean;
}

/** The activation reps that bind a multi-cluster read: the lowest. */
function bindingReps(read: ExerciseRead): number | undefined {
  const reps = read.clusters.map((c) => c.reps).filter((r): r is number => r != null);
  return reps.length ? Math.min(...reps) : undefined;
}

/**
 * Layer 3. The next load the equipment offers, and how big a step it is.
 *
 * `availableLoads` wins when present (a rack, a stack); otherwise the
 * template's increment; otherwise {@link DEFAULT_INCREMENT_LB}. On an
 * assisted lift "next" is the next LOWER assistance, floored at 0.
 */
export function nextLoad(
  current: number,
  opts: { availableLoads?: number[]; incrementLb?: number; assisted?: boolean },
): { load: number; jumpPct: number } {
  const step = opts.incrementLb ?? DEFAULT_INCREMENT_LB;
  const steps = (opts.availableLoads ?? []).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  let load: number;
  if (opts.assisted) {
    const lower = steps.filter((x) => x < current);
    load = lower.length ? lower[lower.length - 1] : Math.max(0, current - step);
  } else {
    const higher = steps.filter((x) => x > current);
    load = higher.length ? higher[0] : current + step;
  }
  load = +load.toFixed(2);
  const jumpPct = current > 0 ? Math.abs(load - current) / current : 0;
  return { load, jumpPct };
}

/**
 * Layers 1-4 for one exercise. `history` is the SAME exercise across recent
 * COMPLETED sessions, most-recent-first (what `exerciseHistory` returns).
 */
export function recommend(history: readonly SessionExercise[], opts: RecommendOptions = {}): Recommendation {
  const target = opts.progression?.targetReps ?? DEFAULT_TARGET_REPS;
  const band = { lo: target - 1, hi: target };
  const assisted = opts.assisted ?? false;
  const last = history[0];
  const base = { last: [] as ActivationSummary[], assisted, band };

  if (!last) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const read = readExercise(last, opts);
  const summaries: ActivationSummary[] = read.clusters.map((c) => ({
    group: c.group, reps: c.reps, rir: c.rir, firstMini: c.minis[0],
  }));
  const currentLoad = read.load ?? read.clusters.find((c) => c.load != null)?.load;
  const stall = detectStall(history, opts);
  const withStall = stall ? { stall } : {};

  if (!read.clustered) {
    if (read.issue === 'not-clustered') {
      return {
        ...base, ...withStall, action: 'repeat-invalid', load: currentLoad, currentLoad, last: summaries,
        reason: { kind: 'invalid', reason: 'not-clustered' },
      };
    }
    return { ...base, action: 'none', currentLoad, reason: { kind: 'straight-sets' } };
  }

  if (!read.valid) {
    const bad = read.clusters.find((c) => c.group === read.issueGroup);
    return {
      ...base, ...withStall, action: 'repeat-invalid', load: currentLoad, currentLoad, last: summaries,
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

  // Layer 2 — activation reps only; every cluster must clear the band.
  const below = read.clusters.find((c) => (c.reps as number) < band.lo);
  if (below) {
    return {
      ...base, ...withStall, action: 'hold', load: currentLoad, currentLoad, last: summaries,
      reason: {
        kind: 'below-band', reps: below.reps as number, clusters: read.clusters.length,
        ...(read.clusters.length > 1 ? { group: below.group } : {}),
      },
    };
  }
  const reps = bindingReps(read) as number;
  const over = read.clusters.every((c) => (c.reps as number) > band.hi);
  const lead = read.clusters[0];
  const inBand: RecommendReason = over
    ? { kind: 'over-band', reps: Math.max(...read.clusters.map((c) => c.reps as number)), ...(lead.rir != null ? { rir: lead.rir } : {}) }
    : { kind: 'in-band', reps, ...(lead.rir != null ? { rir: lead.rir } : {}) };

  if (currentLoad == null) {
    // Bodyweight cluster with no logged load: the call is still "add load",
    // and what that means (a plate, a band) is the lifter's to decide.
    return { ...base, ...withStall, action: 'add-load', last: summaries, reason: inBand };
  }

  // Layer 3 — does the next step exist, and is it a step or a leap?
  const next = nextLoad(currentLoad, {
    availableLoads: opts.availableLoads, incrementLb: opts.progression?.incrementLb, assisted,
  });
  // The cap protects a lifter from a 100% Smith jump; it must not cap a lift
  // that already reads over the band — that one is under-loaded and the cap
  // would freeze it there (the calf raise that returned 15-20 at three loads).
  if (next.jumpPct > MAX_JUMP_PCT && !over) {
    return {
      ...base, ...withStall, action: 'build-reps', load: currentLoad, currentLoad, last: summaries,
      reason: { kind: 'jump-too-big', nextLoad: next.load, jumpPct: next.jumpPct, repsGoal: reps + BUILD_REPS_EXTRA },
    };
  }
  return { ...base, ...withStall, action: 'add-load', load: next.load, currentLoad, last: summaries, reason: inBand };
}

// ─── Layer 4: stalls ────────────────────────────────────────────

export type StallIntervention =
  | 'shorten-mini-rest'
  | 'reduce-blocking-cluster'
  | 'reduce-load-10pct';

export interface StallReport {
  /** Consecutive most-recent sessions at {@link load}. */
  sessions: number;
  load: number;
  /** Binding activation reps per session, most-recent-first. */
  reps: number[];
  /** How many of those sessions were invalid reads — if most, that is the cause. */
  invalidSessions: number;
  /** Sessions whose first mini exceeded {@link FIRST_MINI_MAX}: activation too easy. */
  easyActivations: number;
  /** On a multi-cluster lift, the cluster that sat below band in EVERY session
   *  while another cleared it at least once. */
  blockingGroup?: number;
  /** Ranked, present from {@link INTERVENTION_SESSIONS} sessions on. */
  interventions: StallIntervention[];
}

/**
 * Layer 4. Three consecutive sessions at one load with the binding activation
 * reps not rising on the latest step is a stall; the report says why.
 *
 * "Not increasing" is judged on the most recent step (`reps[0] <= reps[1]`),
 * which is what a lifter means by it: a run of 10, 11, 11 has stopped moving
 * even though it once moved.
 */
export function detectStall(history: readonly SessionExercise[], opts: RecommendOptions = {}): StallReport | null {
  const target = opts.progression?.targetReps ?? DEFAULT_TARGET_REPS;
  const lo = target - 1;
  const reads = history.map((h) => readExercise(h, opts));
  const first = reads[0];
  if (!first?.clustered || first.load == null) return null;
  const load = first.load;

  const run: ExerciseRead[] = [];
  for (const r of reads) {
    if (!r.clustered || r.load !== load) break;
    if (bindingReps(r) == null) break;
    run.push(r);
  }
  if (run.length < STALL_SESSIONS) return null;
  const reps = run.map((r) => bindingReps(r) as number);
  if (reps[0] > reps[1]) return null;

  const invalidSessions = run.filter((r) => !r.valid).length;
  const easyActivations = run.filter((r) => r.clusters.some((c) => (c.minis[0] ?? 0) > FIRST_MINI_MAX)).length;

  let blockingGroup: number | undefined;
  const groups = new Set(run.flatMap((r) => r.clusters.map((c) => c.group)));
  if (groups.size > 1) {
    for (const g of groups) {
      const alwaysBelow = run.every((r) => {
        const c = r.clusters.find((x) => x.group === g);
        return c?.reps != null && c.reps < lo;
      });
      const otherCleared = run.some((r) => r.clusters.some((c) => c.group !== g && (c.reps ?? 0) >= lo));
      if (alwaysBelow && otherCleared) { blockingGroup = g; break; }
    }
  }

  const interventions: StallIntervention[] = [];
  if (run.length >= INTERVENTION_SESSIONS) {
    interventions.push('shorten-mini-rest');
    if (blockingGroup != null) interventions.push('reduce-blocking-cluster');
    interventions.push('reduce-load-10pct');
  }
  return {
    sessions: run.length, load, reps, invalidSessions, easyActivations,
    ...(blockingGroup != null ? { blockingGroup } : {}),
    interventions,
  };
}

// ─── Wiring helpers ─────────────────────────────────────────────

/**
 * The engine options for one template row — the prescription (cluster or
 * not, rep target, increment) from the template, the equipment (steps,
 * assisted) from the catalog exercise. Both apps build options through this
 * so they cannot disagree about which field means what.
 */
export function recommendOptionsFor(
  templateExercise: { plannedSets: readonly { kind: string }[]; progression?: Partial<ProgressionRule> } | null | undefined,
  catalogExercise: { availableLoads?: number[]; assisted?: boolean } | null | undefined,
): RecommendOptions {
  const expectsCluster = (templateExercise?.plannedSets ?? []).some((p) => p.kind === 'activation');
  return {
    expectsCluster,
    ...(templateExercise?.progression ? { progression: templateExercise.progression } : {}),
    ...(catalogExercise?.availableLoads ? { availableLoads: catalogExercise.availableLoads } : {}),
    ...(catalogExercise?.assisted != null ? { assisted: catalogExercise.assisted } : {}),
  };
}

/** The storable subset of a recommendation (`SessionExercise.recommendation`). */
export function toRecommendationSnapshot(
  rec: Recommendation,
  basedOn?: Date,
): { action: string; load?: number; basedOn?: string } {
  return {
    action: rec.action,
    ...(rec.load != null ? { load: rec.load } : {}),
    ...(basedOn ? { basedOn: basedOn.toISOString() } : {}),
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
