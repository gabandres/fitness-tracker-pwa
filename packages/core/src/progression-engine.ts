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
 * That rule holds under any effort standard, which is why it is the primary
 * gate. The activation's RIR only invalidates at the top (RIR 4+); RIR 0 is
 * the intended standard since ADR-0039 — the owner's 85 logged clusters showed
 * only the RIR-0 activations passed the mini rule.
 *
 * An invalid read never produces a load recommendation. It produces "repeat
 * <load> — read invalid" and the specific reason. That is the single most
 * important rule in this module: advancing load off a read that cannot support
 * the claim corrupts every session that follows it.
 *
 * Layer 2 (progression) reads the ACTIVATION SET ONLY, against a rep band
 * that is DERIVED PER EXERCISE, not hardcoded. Thresholds calibrated to a
 * RIR 1-2 standard (11-12 / 9-10 / under 9) do not transfer to failure sets,
 * so the band is computed from what the lifter actually did: after
 * {@link CALIBRATION_SESSIONS} valid sessions at one load,
 *
 *     addLoadAt = max observed activation reps
 *     hold      = max-2 .. max-1
 *     build     = under max-2
 *
 * and it is recomputed whenever the load changes (the calibration run is the
 * consecutive sessions at the CURRENT load). Until then the engine says
 * "Calibrating — n of 3 valid sessions logged" and recommends NO load. A
 * manual `Exercise.targetRepBand` overrides the derivation. Minis never drive
 * load. A multi-cluster lift advances only when EVERY activation clears the
 * mark, and the blocking cluster is named.
 *
 * Sets flagged `legacyEffortStandard` (logged on or before 2026-09-15, under
 * an inconsistent RIR standard) are EXCLUDED from the band derivation and are
 * never judged as the latest read; they remain history.
 *
 * Layer 3 (increments) refuses to recommend a load the equipment cannot be
 * set to, or a jump over {@link MAX_JUMP_PCT} — except on a lift that is
 * plainly under-loaded, where the cap would be the engine protecting a number
 * the lifter has already left behind.
 *
 * Layer 4 (stalls) counts consecutive sessions at one load and, at three,
 * says WHY rather than just that.
 *
 * ## Effort standard per lift
 *
 * `Exercise.effortStandard` is `failure` by default; `rir1` marks a lift that
 * deliberately stops one rep short (a restriction). On a `rir1` lift an
 * activation logged at RIR 0 is a WARNING on the recommendation, not an
 * invalid read — the mini rule still decides validity.
 *
 * ## What it deliberately does not do
 *
 * No soreness/pump prompts, no %1RM, no velocity, no deload scheduling, and it
 * NEVER mutates a template or a catalog exercise. It recommends; the lifter
 * accepts or overrides, and the recommendation is frozen on the session
 * (`SessionExercise.recommendation`) so the override can be audited later.
 * The derived band is computed on read and never written anywhere.
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
import type {
  EffortStandard,
  LogStyle,
  ProgressionRule,
  RepBand,
  SessionExercise,
  SetStructure,
  WorkoutSet,
} from './workout';
import { DEFAULT_EFFORT_STANDARD, DEFAULT_LOG_STYLE } from './workout';
import { ACTIVATION_RIR_MAX } from './activation-validity';
import { DEFAULT_INCREMENT_LB } from './load-units';
import { inferStructure, structureOf } from './set-structure';

// ─── Constants (stated once; the tests pin them) ────────────────

/** The first mini-set's readable band, inclusive. */
export const FIRST_MINI_MIN = 2;
export const FIRST_MINI_MAX = 5;
/** Valid (non-legacy) sessions at one load before a rep band is derived. */
export const CALIBRATION_SESSIONS = 3;
/** The hold band sits this many reps under the add-load mark: `max-2 .. max-1`. */
export const HOLD_BAND_WIDTH = 2;
/** Sets logged on or before this date (inclusive) carry
 *  `legacyEffortStandard: true` — see `WorkoutSet`. Informational here; the
 *  engine reads the flag, never the date. */
export const LEGACY_EFFORT_CUTOFF = '2026-09-15';
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

/** The band a lift earns from its highest valid activation rep count. */
export function repBandFrom(maxReps: number): RepBand {
  const max = Math.max(1, Math.round(maxReps));
  return {
    addLoadAt: max,
    holdLo: Math.max(1, max - HOLD_BAND_WIDTH),
    holdHi: Math.max(1, max - 1),
  };
}

// ─── Layer 1: validity ──────────────────────────────────────────

export type InvalidReason =
  /** The activation has no rep count. */
  | 'reps-missing'
  /** No RIR on the activation. Blocks only in strict mode (clustered lifts). */
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
  /** The activation carries `legacyEffortStandard`. */
  legacy: boolean;
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
   *  Such a read is history, not evidence: excluded from band derivation. */
  legacy: boolean;
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
    const read: ClusterRead = {
      group, load: a.weight, reps: a.reps, rir: a.rir, minis, issue: null,
      legacy: a.legacyEffortStandard === true,
    };
    read.issue = clusterIssue(read, strict);
    clusters.push(read);
  }
  if (clusters.length === 0) return none(null, true);
  const legacy = clusters.some((c) => c.legacy);

  const loads = new Set(clusters.map((c) => c.load).filter((w): w is number => w != null));
  const load = loads.size === 1 ? [...loads][0] : undefined;
  if (loads.size > 1) {
    return { clusters, issue: 'load-changed', valid: false, clustered: true, legacy };
  }
  const bad = clusters.find((c) => c.issue);
  return {
    clusters,
    issue: bad?.issue ?? null,
    ...(bad ? { issueGroup: bad.group } : {}),
    valid: !bad,
    load,
    clustered: true,
    legacy,
  };
}

function clusterIssue(c: ClusterRead, strict: boolean): InvalidReason | null {
  if (c.reps == null) return 'reps-missing';
  if (c.rir == null) {
    if (strict) return 'rir-missing';
  } else if (c.rir > ACTIVATION_RIR_MAX) {
    // RIR 0 is the standard, not an error (ADR-0039); only the top edge blocks.
    return 'rir-too-easy';
  }
  if (c.minis.length === 0) return 'minis-missing';
  const first = c.minis[0];
  if (first > FIRST_MINI_MAX) return 'first-mini-too-many';
  if (first < FIRST_MINI_MIN) return 'first-mini-too-few';
  if (c.minis.some((m) => m > (c.reps as number))) return 'mini-exceeds-activation';
  return null;
}

// ─── Layer 2a: the band — calibration ───────────────────────────

export interface Calibration {
  /** The load being calibrated: the most recent clustered read's load. */
  load?: number;
  /** Valid, non-legacy sessions in the consecutive run at that load. */
  validSessions: number;
  needed: number;
  /** Highest activation reps across those sessions, once there is one. */
  maxReps?: number;
  /** The band in force, or null while calibrating. */
  band: RepBand | null;
  /** Where the band came from. */
  source: 'override' | 'derived' | null;
}

/**
 * The calibration state for one exercise. `history` is most-recent-first.
 *
 * The run is the consecutive clustered reads at the CURRENT load, so a load
 * change restarts calibration by construction ("recalculate whenever the
 * load changes"). Legacy reads are skipped without breaking the run — they
 * are invisible to calibration, at any load. Reads whose load is unknown
 * (`load-changed`, a bodyweight cluster) neither count nor break the run.
 */
export function calibrationFor(history: readonly SessionExercise[], opts: RecommendOptions = {}): Calibration {
  return calibrationFrom(history.map((h) => readExercise(h, opts)), opts);
}

/** The load a read calibrates under: a bodyweight cluster (no weight on any
 *  set) is one load, "none", and calibrates like any other; a read whose
 *  clusters disagree about the load has no key at all. */
function loadKey(r: ExerciseRead): number | undefined {
  if (!r.clustered || r.issue === 'load-changed') return undefined;
  return r.load ?? 0;
}

function calibrationFrom(reads: readonly ExerciseRead[], opts: RecommendOptions): Calibration {
  const needed = CALIBRATION_SESSIONS;
  const current = reads.find((r) => loadKey(r) != null && !r.legacy)
    ?? reads.find((r) => loadKey(r) != null);
  const key = current ? loadKey(current) : undefined;
  const load = current?.load;
  let validSessions = 0;
  let maxReps: number | undefined;
  if (key != null) {
    for (const r of reads) {
      if (!r.clustered || r.legacy) continue;
      const k = loadKey(r);
      if (k == null) continue;
      if (k !== key) break;
      if (!r.valid) continue;
      const reps = r.clusters.map((c) => c.reps).filter((x): x is number => x != null);
      if (reps.length === 0) continue;
      validSessions += 1;
      const m = Math.max(...reps);
      maxReps = maxReps == null ? m : Math.max(maxReps, m);
    }
  }
  if (opts.targetRepBand) {
    return { load, validSessions, needed, maxReps, band: opts.targetRepBand, source: 'override' };
  }
  const derived = validSessions >= needed && maxReps != null;
  return {
    load, validSessions, needed, maxReps,
    band: derived ? repBandFrom(maxReps as number) : null,
    source: derived ? 'derived' : null,
  };
}

// ─── Layer 2 + 3: the recommendation ────────────────────────────

export type RecommendAction =
  /** Every activation reached the add-load mark (or passed it): take the next
   *  load. On an `assisted` lift this means LESS assistance. */
  | 'add-load'
  /** In the hold band on at least one cluster: same load, build reps. */
  | 'hold'
  /** Same load, build reps first — either under the hold band on at least one
   *  cluster, or the next available load is too big a step. */
  | 'build-reps'
  /** The last read was invalid: repeat the load, fix the read. */
  | 'repeat-invalid'
  /** No band yet: the session is a calibration, not a read. Also the state
   *  before any history, and after a legacy latest read. */
  | 'calibrate'
  /** Not a clustered lift; the engine has nothing to say. */
  | 'none';

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
  /** Band not yet derived: `valid` of `needed` sessions at the current load. */
  | { kind: 'calibrating'; valid: number; needed: number }
  | { kind: 'invalid'; reason: InvalidReason; group?: number; firstMini?: number; rir?: number; reps?: number }
  /** Every cluster at the add-load mark. */
  | { kind: 'at-target'; reps: number; rir?: number }
  /** Every cluster OVER the add-load mark — only possible under an override. */
  | { kind: 'over-band'; reps: number; rir?: number }
  /** At least one cluster in the hold band. */
  | { kind: 'below-band'; reps: number; group?: number; clusters: number }
  /** At least one cluster UNDER the hold band; `goal` is the band's floor. */
  | { kind: 'under-band'; reps: number; group?: number; clusters: number; goal: number }
  | { kind: 'jump-too-big'; nextLoad: number; jumpPct: number; repsGoal: number };

export type RecommendWarning =
  /** A `rir1` lift logged its activation at RIR 0. Soft: the read stands. */
  | 'failure-on-rir1';

export interface ActivationSummary {
  group: number;
  reps?: number;
  rir?: number;
  firstMini?: number;
}

export interface Recommendation {
  action: RecommendAction;
  /** The load to use next session, pounds. Equals `currentLoad` on hold /
   *  repeat / build-reps / calibrate; the next step on add-load. Absent when
   *  unknown. */
  load?: number;
  /** The load the last session used. */
  currentLoad?: number;
  /** The last session's activation sets, one per cluster. */
  last: ActivationSummary[];
  reason: RecommendReason;
  /** True when the exercise's weight is assistance (less is progress). */
  assisted: boolean;
  /** The rep band in force, or null while calibrating. */
  band: RepBand | null;
  /** Where the band stands: valid sessions so far, its source, its max. */
  calibration: Calibration;
  /** Soft flags that do not change the action. */
  warnings: RecommendWarning[];
  /** Layer 4, when there is enough history. */
  stall?: StallReport;
}

export interface RecommendOptions extends ReadOptions {
  /** From the template's `progression`; only `incrementLb` is read now that
   *  the band is derived. */
  progression?: Partial<ProgressionRule>;
  /** From the catalog exercise. */
  availableLoads?: number[];
  assisted?: boolean;
  /** From the catalog exercise; defaults to {@link DEFAULT_EFFORT_STANDARD}. */
  effortStandard?: EffortStandard;
  /** From the catalog exercise: a manual band that skips calibration. */
  targetRepBand?: RepBand;
  /** What the exercise is PROGRAMMED as (ADR-0040), resolved by `structureOf`
   *  from the template, then the catalog. Absent means "infer with the
   *  pre-0040 rule" from the latest session's set list, which is exactly what
   *  the engine did before this option existed — so an undeclared myo-reps
   *  lift still reads as myo-reps and history is not reinterpreted. */
  structure?: SetStructure;
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

/** The calibration state for a structure that does not calibrate. The derived
 *  band is a myo-reps concept (ADR-0039); straight sets progress against the
 *  template's rep target, and an unreadable structure has no state at all. */
const EMPTY_CALIBRATION: Calibration = { validSessions: 0, needed: CALIBRATION_SESSIONS, band: null, source: null };

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
function bindingStraight(ex: SessionExercise): { reps?: number; load?: number; rir?: number } {
  const sets = workingReps(ex);
  if (sets.length === 0) return {};
  const reps = Math.min(...sets.map((s) => s.reps as number));
  const loads = sets.map((s) => s.weight).filter((w): w is number => w != null);
  const rirs = sets.map((s) => s.rir).filter((r): r is number => r != null);
  return {
    reps,
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
 * Shared so the jump ceiling and the assisted/steps handling cannot diverge
 * between structures.
 */
function loadCall(
  base: Pick<Recommendation, 'last' | 'assisted' | 'band' | 'calibration' | 'warnings'>,
  opts: RecommendOptions,
  currentLoad: number | undefined,
  sessionsAtTarget: number,
  holdSessions: number,
  reason: RecommendReason,
  repsGoal: number,
): Recommendation {
  if (sessionsAtTarget >= holdSessions && currentLoad != null) {
    const { load, jumpPct } = nextLoad(currentLoad, {
      availableLoads: opts.availableLoads,
      incrementLb: opts.progression?.incrementLb,
      assisted: base.assisted,
    });
    if (jumpPct > MAX_JUMP_PCT) {
      return {
        ...base, action: 'build-reps', load: currentLoad, currentLoad,
        reason: { kind: 'jump-too-big', nextLoad: load, jumpPct, repsGoal },
      };
    }
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
    last: [] as ActivationSummary[], assisted, band: null,
    calibration: EMPTY_CALIBRATION, warnings: [] as RecommendWarning[],
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
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason, targetReps);
}

function recommendCluster(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, band: null,
    calibration: EMPTY_CALIBRATION, warnings: [] as RecommendWarning[],
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
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason, latest.blocks as number);
}

function recommendStraight(history: readonly SessionExercise[], opts: RecommendOptions): Recommendation {
  const assisted = opts.assisted ?? false;
  const base = {
    last: [] as ActivationSummary[], assisted, band: null,
    calibration: EMPTY_CALIBRATION, warnings: [] as RecommendWarning[],
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

  const sessionsAtTarget = heldRun(history, currentLoad, (h) => {
    const r = bindingStraight(h);
    return { load: r.load, held: r.reps != null && r.reps >= targetReps };
  });

  const reason: RecommendReason = {
    kind: 'straight-sets', targetReps, sessionsAtTarget, holdSessions,
    ...(latest.reps != null ? { reps: latest.reps } : {}),
  };
  return loadCall(base, opts, currentLoad, sessionsAtTarget, holdSessions, reason, targetReps);
  return { ...base, action: 'build-reps', load: currentLoad, currentLoad, reason };
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
  if (structure !== 'myoreps') {
    return {
      last: [], assisted: opts.assisted ?? false, band: null,
      calibration: EMPTY_CALIBRATION, warnings: [],
      action: 'none', reason: { kind: 'unsupported-structure', structure },
    };
  }

  // ─── myo-reps: ADR-0038/0039, unchanged below this line ───────────
  const assisted = opts.assisted ?? false;
  // A declared myo-reps lift DOES expect a cluster, which is what makes a
  // straight-set log of it read as `not-clustered` instead of being ignored.
  // An explicit caller value still wins.
  const readOpts: RecommendOptions = { ...opts, expectsCluster: opts.expectsCluster ?? true };
  const reads = history.map((h) => readExercise(h, readOpts));
  const calibration = calibrationFrom(reads, opts);
  const band = calibration.band;
  const base = { last: [] as ActivationSummary[], assisted, band, calibration, warnings: [] as RecommendWarning[] };
  const read = reads[0];

  if (!read) return { ...base, action: 'calibrate', reason: { kind: 'no-history' } };

  const summaries: ActivationSummary[] = read.clusters.map((c) => ({
    group: c.group, reps: c.reps, rir: c.rir, firstMini: c.minis[0],
  }));
  const currentLoad = read.load ?? read.clusters.find((c) => c.load != null)?.load;
  const stall = stallFrom(reads, band);
  const withStall = stall ? { stall } : {};

  if (!read.clustered) {
    if (read.issue === 'not-clustered') {
      return {
        ...base, ...withStall, action: 'repeat-invalid', load: currentLoad, currentLoad, last: summaries,
        reason: { kind: 'invalid', reason: 'not-clustered' },
      };
    }
    // Reached only when there is no cluster to read AND no straight-set log
    // to fault: a myo-reps lift whose latest session is a timed hold (the
    // engine is a rep engine — wrong instrument, not a bad log), or one with
    // nothing performed yet. Before ADR-0040 this returned `straight-sets`,
    // which was a lie about a lift programmed as myo-reps, and it rendered as
    // the empty string so nobody could see the lie.
    return { ...base, action: 'none', currentLoad, reason: { kind: 'nothing-to-read' } };
  }

  // A `rir1` lift taken to failure: say so, but the mini rule decides validity.
  const standard = opts.effortStandard ?? DEFAULT_EFFORT_STANDARD;
  const warnings: RecommendWarning[] =
    standard === 'rir1' && read.clusters.some((c) => c.rir === 0) ? ['failure-on-rir1'] : [];
  const judged = { ...base, warnings, last: summaries, currentLoad, ...withStall };

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

  // A legacy latest read is history, not evidence — and no band means the
  // engine has nothing to judge against yet. Both are "calibrate": repeat the
  // load, log a clean session, and the count moves.
  if (read.legacy || band == null) {
    return {
      ...judged, action: 'calibrate', load: currentLoad,
      reason: { kind: 'calibrating', valid: calibration.validSessions, needed: calibration.needed },
    };
  }

  // Layer 2 — activation reps only; every cluster must clear the mark. The
  // cluster named is the BINDING one (fewest reps), which on a two-cluster
  // lift is the one the lifter has to move.
  const multi = read.clusters.length > 1;
  const lowest = [...read.clusters].sort((a, b) => (a.reps as number) - (b.reps as number))[0];
  const under = (lowest.reps as number) < band.holdLo ? lowest : undefined;
  if (under) {
    return {
      ...judged, action: 'build-reps', load: currentLoad,
      reason: {
        kind: 'under-band', reps: under.reps as number, clusters: read.clusters.length, goal: band.holdLo,
        ...(multi ? { group: under.group } : {}),
      },
    };
  }
  const below = (lowest.reps as number) < band.addLoadAt ? lowest : undefined;
  if (below) {
    return {
      ...judged, action: 'hold', load: currentLoad,
      reason: {
        kind: 'below-band', reps: below.reps as number, clusters: read.clusters.length,
        ...(multi ? { group: below.group } : {}),
      },
    };
  }
  const reps = bindingReps(read) as number;
  const over = read.clusters.every((c) => (c.reps as number) > band.addLoadAt);
  const lead = read.clusters[0];
  const atMark: RecommendReason = over
    ? { kind: 'over-band', reps: Math.max(...read.clusters.map((c) => c.reps as number)), ...(lead.rir != null ? { rir: lead.rir } : {}) }
    : { kind: 'at-target', reps, ...(lead.rir != null ? { rir: lead.rir } : {}) };

  if (currentLoad == null) {
    // Bodyweight cluster with no logged load: the call is still "add load",
    // and what that means (a plate, a band) is the lifter's to decide.
    return { ...judged, action: 'add-load', reason: atMark };
  }

  // Layer 3 — does the next step exist, and is it a step or a leap?
  const next = nextLoad(currentLoad, {
    availableLoads: opts.availableLoads, incrementLb: opts.progression?.incrementLb, assisted,
  });
  // The cap protects a lifter from a 100% Smith jump; it must not cap a lift
  // that already reads over the mark — that one is under-loaded and the cap
  // would freeze it there (the calf raise that returned 15-20 at three loads).
  if (next.jumpPct > MAX_JUMP_PCT && !over) {
    return {
      ...judged, action: 'build-reps', load: currentLoad,
      reason: { kind: 'jump-too-big', nextLoad: next.load, jumpPct: next.jumpPct, repsGoal: reps + BUILD_REPS_EXTRA },
    };
  }
  return { ...judged, action: 'add-load', load: next.load, reason: atMark };
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
  /** On a multi-cluster lift, the cluster that sat under the add-load mark in
   *  EVERY session while another reached it at least once. Needs a band. */
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
 * even though it once moved. Legacy sessions count toward the run — a stall
 * is about the load not moving, whatever the effort standard was.
 */
export function detectStall(history: readonly SessionExercise[], opts: RecommendOptions = {}): StallReport | null {
  const reads = history.map((h) => readExercise(h, opts));
  return stallFrom(reads, calibrationFrom(reads, opts).band);
}

function stallFrom(reads: readonly ExerciseRead[], band: RepBand | null): StallReport | null {
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
  if (band && groups.size > 1) {
    const mark = band.addLoadAt;
    for (const g of groups) {
      const alwaysBelow = run.every((r) => {
        const c = r.clusters.find((x) => x.group === g);
        return c?.reps != null && c.reps < mark;
      });
      const otherCleared = run.some((r) => r.clusters.some((c) => c.group !== g && (c.reps ?? 0) >= mark));
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
 * not, increment) from the template; the equipment (steps, assisted), the
 * effort standard and any band override from the catalog exercise. Both apps
 * build options through this so they cannot disagree about which field means
 * what.
 */
export function recommendOptionsFor(
  templateExercise: {
    plannedSets: readonly { kind: string }[];
    progression?: Partial<ProgressionRule>;
    setStructure?: SetStructure;
  } | null | undefined,
  catalogExercise: {
    availableLoads?: number[];
    assisted?: boolean;
    effortStandard?: EffortStandard;
    targetRepBand?: RepBand;
    setStructure?: SetStructure;
  } | null | undefined,
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
    ...(catalogExercise?.availableLoads ? { availableLoads: catalogExercise.availableLoads } : {}),
    ...(catalogExercise?.assisted != null ? { assisted: catalogExercise.assisted } : {}),
    ...(catalogExercise?.effortStandard ? { effortStandard: catalogExercise.effortStandard } : {}),
    ...(catalogExercise?.targetRepBand ? { targetRepBand: catalogExercise.targetRepBand } : {}),
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
