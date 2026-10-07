/**
 * Layer 6 of the progression engine: the recommendation as sentences.
 *
 * Core decides (`@macrolog/core` `recommend`); this renders the decision in
 * the user's language and load unit. Pure — takes `t` and the unit system,
 * returns strings — so the exact wording the lifter reads is unit-testable
 * without a renderer, and the three locales are forced to carry every key.
 *
 * The shape is fixed by the spec: load, action, "Target: ≥ N reps", one line
 * of reason citing the numbers, and last session's activation reps + RIR. An
 * increase adds what to expect at the new load — an Epley estimate, so it is
 * worded "expected", never as a promise. A few notes can follow (the
 * prediction is approximate, the stack steps are a guess, the techniques to
 * try at the rep cap), then a soft warning when a 1-in-reserve lift was taken
 * to failure, then the stall diagnosis. Nothing here invents a number: every
 * figure comes off the `Recommendation` object.
 *
 * The derived band (ADR-0039) and its calibration count are gone (2026-10-07):
 * each lift has a rep range now, and the reasons cite it.
 */
import {
  type CapTechnique,
  type InvalidReason,
  type ProgressionCall,
  type Recommendation,
  type RecommendWarning,
  type StallCheck,
  type StallReport,
  type UnitSystem,
  formatLoad,
  loadUnit,
  progressionCall,
  toDisplayLoad,
} from '@macrolog/core';
import type { SetStructure } from '@/lib/workout';
import type { I18nKey, TFn } from '@/i18n';

export interface RecommendationText {
  /** "20 lb · HOLD" — load first when there is one. */
  headline: string;
  /** The action alone, for a chip. */
  action: string;
  /** The finish sheet's name for the call (core `progressionCall`). */
  call: ProgressionCall;
  /** The formatted load, or null when the engine has no number to give. */
  load: string | null;
  /** "Target: ≥ 11 reps", or null when the call carries no rep target. */
  target: string | null;
  /** One sentence citing the numbers. */
  reason: string;
  /** On an increase: "Expected: about 8 reps" — an estimate, said as one. */
  expect: string | null;
  /** Short qualifiers on the call (approximate, guessed step, techniques). */
  notes: string[];
  /** "Last: 11 reps @ RIR 1" (per cluster when there are several), or null. */
  last: string | null;
  /** Soft warnings, in order; empty when there are none. */
  warnings: string[];
  /** Stall diagnosis lines, in order; empty when there is no stall. */
  stall: string[];
  /** Whether the call moves the load (a chip the user can tap to take it). */
  tappable: boolean;
}

/** Reason kinds that are NOT on the myo-reps path. Their `none` still speaks
 *  (ADR-0040): a refusal the user cannot see reads as a broken engine. */
const NON_MYOREPS_REASONS = new Set<string>([
  'straight-sets', 'rest-pause', 'cluster-sets', 'hit',
  'no-rule', 'nothing-to-read', 'unsupported-structure',
]);

/** Display name per set structure — the user picked it, so name it back. */
const STRUCTURE_KEYS: Record<SetStructure, I18nKey> = {
  straight: 'train.structure.straight',
  myoreps: 'train.structure.myoreps',
  'rest-pause': 'train.structure.restPause',
  cluster: 'train.structure.cluster',
  drop: 'train.structure.drop',
  superset: 'train.structure.superset',
  hit: 'train.structure.hit',
};

const INVALID_KEYS: Record<InvalidReason, I18nKey> = {
  'reps-missing': 'train.rec.invalid.repsMissing',
  'rir-missing': 'train.rec.invalid.rirMissing',
  'rir-too-easy': 'train.rec.invalid.rirTooEasy',
  'minis-missing': 'train.rec.invalid.minisMissing',
  'first-mini-too-many': 'train.rec.invalid.firstMiniTooMany',
  'first-mini-too-few': 'train.rec.invalid.firstMiniTooFew',
  'mini-exceeds-activation': 'train.rec.invalid.miniExceeds',
  'load-changed': 'train.rec.invalid.loadChanged',
  'not-clustered': 'train.rec.invalid.notClustered',
};

const WARNING_KEYS: Record<RecommendWarning, I18nKey> = {
  'failure-on-rir1': 'train.rec.warn.failureOnRir1',
};

/** One label per call — the same five words on the card and the finish sheet. */
const CALL_KEYS: Record<ProgressionCall, I18nKey> = {
  increase: 'train.rec.call.increase',
  hold: 'train.rec.call.hold',
  drop: 'train.rec.call.drop',
  'repeat-invalid': 'train.rec.call.repeatInvalid',
  stalled: 'train.rec.call.stalled',
  start: 'train.rec.call.start',
  // ADR-0040: a refusal is labelled as one, never as "first session".
  none: 'train.rec.action.noCall',
};

const TECHNIQUE_KEYS: Record<CapTechnique, I18nKey> = {
  tempo: 'train.rec.technique.tempo',
  microplates: 'train.rec.technique.microplates',
  'add-cluster': 'train.rec.technique.addCluster',
};

const CHECK_KEYS: Record<StallCheck['check'], I18nKey> = {
  sleep: 'train.rec.stall.checkSleep',
  intake: 'train.rec.stall.checkIntake',
  'mini-rest': 'train.rec.stall.checkMiniRest',
};

const STATUS_KEYS: Record<StallCheck['status'], I18nKey> = {
  flag: 'train.rec.stall.flag',
  ok: 'train.rec.stall.ok',
  unknown: 'train.rec.stall.unknown',
};

/** The action label. An assisted lift's increase is LESS assistance, and
 *  "INCREASE" over a smaller number would read as a typo. */
export function callLabel(rec: Pick<Recommendation, 'action' | 'stall' | 'assisted'>, t: TFn): string {
  const call = progressionCall(rec);
  if (call === 'increase' && rec.assisted) return t('train.rec.action.reduceAssist');
  return t(CALL_KEYS[call]);
}

const pct = (jump: number) => Math.round(jump * 100);

/** The one-line reason — also what a template's `loadLog` stores for an
 *  applied call, so the lift's history reads the sentence the lifter saw. */
export function reasonText(rec: Recommendation, unitSystem: UnitSystem, t: TFn): string {
  const r = rec.reason;
  const load = rec.currentLoad != null ? formatLoad(rec.currentLoad, unitSystem) : '';
  const fmt = (lb: number) => formatLoad(lb, unitSystem);
  switch (r.kind) {
    case 'no-history':
      return t('train.rec.reason.noHistory');
    case 'straight-sets': {
      // ADR-0040: this was the empty string, so a straight-sets lift showed
      // nothing at all and the user could not tell the engine from a bug.
      if (r.targetReps == null) return t('train.rec.reason.straightSets.noTarget');
      if (r.sessionsAtTarget >= r.holdSessions) {
        return t('train.rec.reason.straightSets.hit', { target: r.targetReps, n: r.sessionsAtTarget });
      }
      return t('train.rec.reason.straightSets.building', {
        reps: r.reps ?? '', target: r.targetReps,
        n: r.sessionsAtTarget, needed: r.holdSessions,
      });
    }
    case 'rest-pause':
      return r.sessionsAtTarget >= r.holdSessions
        ? t('train.rec.reason.restPause.hit', { total: r.total, target: r.targetReps, n: r.sessionsAtTarget })
        : t('train.rec.reason.restPause.building', {
            total: r.total, target: r.targetReps, n: r.sessionsAtTarget, needed: r.holdSessions,
          });
    case 'cluster-sets':
      return r.sessionsAtTarget >= r.holdSessions
        ? t('train.rec.reason.clusterSets.hit', { blocks: r.blocks, n: r.sessionsAtTarget })
        : t('train.rec.reason.clusterSets.building', {
            done: r.completed, blocks: r.blocks, n: r.sessionsAtTarget, needed: r.holdSessions,
          });
    case 'hit':
      return r.sessionsAtTarget >= r.holdSessions
        ? t('train.rec.reason.hitSet.held', { reps: r.reps, target: r.targetReps, n: r.sessionsAtTarget })
        : t('train.rec.reason.hitSet.building', {
            reps: r.reps, target: r.targetReps, n: r.sessionsAtTarget, needed: r.holdSessions,
          });
    case 'no-rule':
      return t('train.rec.reason.noRule');
    case 'nothing-to-read':
      return t('train.rec.reason.nothingToRead');
    case 'unsupported-structure':
      return t('train.rec.reason.unsupportedStructure', {
        structure: t(STRUCTURE_KEYS[r.structure]),
      });
    case 'invalid': {
      const body = t(INVALID_KEYS[r.reason], {
        n: r.firstMini ?? '', reps: r.reps ?? '', rir: r.rir ?? '',
      });
      return r.group != null && rec.last.length > 1
        ? `${t('train.rec.clusterPrefix', { group: r.group })}${body}`
        : body;
    }
    case 'jump-too-big':
      return t('train.rec.reason.jumpTooBig', {
        next: fmt(r.nextLoad), pct: pct(r.jumpPct), reps: r.repsGoal, load,
      });
    // ── myo-reps, the rep-range rules ──
    case 'increase':
      return t('train.rec.reason.increase', {
        reps: r.reps, max: r.max, next: fmt(r.nextLoad), pct: pct(r.jumpPct),
      });
    case 'below-max':
      return r.group != null
        ? t('train.rec.reason.belowMaxCluster', { group: r.group, reps: r.reps, max: r.max, clusters: r.clusters })
        : t('train.rec.reason.belowMax', { reps: r.reps, max: r.max });
    case 'step-too-big': {
      const line = t('train.rec.reason.stepTooBig', {
        reps: r.reps, next: fmt(r.nextLoad), pct: pct(r.jumpPct), predicted: r.predictedReps, min: r.min,
      });
      return r.repsForStep != null
        ? `${line} ${t('train.rec.reason.stepTooBigNeed', { need: r.repsForStep, next: fmt(r.nextLoad) })}`
        : line;
    }
    case 'no-next-step':
      return t('train.rec.reason.noNextStep', { reps: r.reps, cap: r.cap });
    case 'at-rep-cap':
      return r.nextLoad != null && r.predictedReps != null
        ? t('train.rec.reason.atRepCap', {
            reps: r.reps, cap: r.cap, next: fmt(r.nextLoad), pct: pct(r.jumpPct ?? 0), predicted: r.predictedReps,
          })
        : t('train.rec.reason.atRepCapNoStep', { reps: r.reps, cap: r.cap });
    case 'drop-back':
      return t('train.rec.reason.dropBack', { reps: r.reps, min: r.min, load: fmt(r.previousLoad) });
    case 'bodyweight-build':
      return t('train.rec.reason.bodyweightBuild', { reps: r.reps, max: r.max });
    case 'bodyweight-add-load': {
      // "5–10 lb" in the training unit: one unit, after the range.
      const n = (lb: number) => toDisplayLoad(lb, unitSystem);
      return t('train.rec.reason.bodyweightAddLoad', {
        reps: r.reps, max: r.max, range: `${n(r.startLb[0])}–${n(r.startLb[1])} ${loadUnit(unitSystem)}`,
      });
    }
    case 'bodyweight-variation':
      return t('train.rec.reason.bodyweightVariation', { reps: r.reps, max: r.max });
  }
}

/** "Target: ≥ 11 reps" — LOGGED reps, so a `rir1` lift says where to stop. */
function targetText(rec: Recommendation, t: TFn): string | null {
  if (rec.targetReps == null) return null;
  return rec.config?.effortStandard === 'rir1'
    ? t('train.rec.targetRir1', { n: rec.targetReps })
    : t('train.rec.target', { n: rec.targetReps });
}

/** On an increase, the reps Epley expects at the new load. The prediction is
 *  to failure; a `rir1` lift also gets the number it should log. */
function expectText(rec: Recommendation, t: TFn): string | null {
  if (rec.predictedReps == null) return null;
  if (rec.config?.effortStandard === 'rir1') {
    return t('train.rec.expectRir1', { n: rec.predictedReps, logged: Math.max(1, rec.predictedReps - 1) });
  }
  return t('train.rec.expect', { n: rec.predictedReps });
}

/** Whether the reason reasons about the NEXT load — the only calls a guessed
 *  step or a bar-less Smith prediction can make wrong. On a hold neither
 *  number is read, and saying "approximate" there would be noise. */
function citesNextStep(rec: Recommendation): boolean {
  const k = rec.reason.kind;
  if (k === 'increase' || k === 'step-too-big') return true;
  return k === 'at-rep-cap' && rec.reason.nextLoad != null;
}

function notesText(rec: Recommendation, unitSystem: UnitSystem, t: TFn): string[] {
  const out: string[] = [];
  if (rec.approximate && citesNextStep(rec)) out.push(t('train.rec.approximate'));
  if (rec.config?.stepsUnknown && citesNextStep(rec)) {
    out.push(t('train.rec.stepsUnknown', { step: formatLoad(rec.config.stepLb, unitSystem) }));
  }
  if (rec.reason.kind === 'at-rep-cap' && rec.reason.techniques.length > 0) {
    out.push(t('train.rec.techniques', {
      list: rec.reason.techniques.map((x) => t(TECHNIQUE_KEYS[x])).join(' · '),
    }));
  }
  return out;
}

function lastText(rec: Recommendation, t: TFn): string | null {
  const done = rec.last.filter((a) => a.reps != null);
  if (done.length === 0) return null;
  if (done.length === 1) {
    const a = done[0];
    return a.rir != null
      ? t('train.rec.last', { reps: a.reps as number, rir: a.rir })
      : t('train.rec.lastNoRir', { reps: a.reps as number });
  }
  const parts = done.map((a) =>
    a.rir != null
      ? t('train.rec.lastCluster', { group: a.group, reps: a.reps as number, rir: a.rir })
      : t('train.rec.lastClusterNoRir', { group: a.group, reps: a.reps as number }),
  );
  return `${t('train.last')}: ${parts.join(' · ')}`;
}

/** One stall check as "Sleep under 7 h: flagged (6.2 h)". An absent fact is
 *  "no data" — never "ok". */
function checkLine(c: StallCheck, t: TFn): string {
  const check = t(CHECK_KEYS[c.check]);
  const status = t(STATUS_KEYS[c.status]);
  if (c.value == null) return t('train.rec.stall.check', { check, status });
  const value = c.check === 'sleep'
    ? t('train.rec.stall.hours', { n: Math.round(c.value * 10) / 10 })
    : t('train.rec.stall.seconds', { n: Math.round(c.value) });
  return t('train.rec.stall.checkValue', { check, status, value });
}

export function stallLines(stall: StallReport, unitSystem: UnitSystem, t: TFn): string[] {
  const lines = [t('train.rec.stall.head', { n: stall.sessions, load: formatLoad(stall.load, unitSystem) })];
  for (const c of stall.checks) lines.push(checkLine(c, t));
  if (stall.suggestSwap) lines.push(t('train.rec.stall.swap'));
  return lines;
}

/**
 * The recommendation as text, or `null` when the engine has nothing to say
 * (a myo-reps `none` — a straight-set lift keeps the existing ghost + bump).
 */
export function recommendationText(
  rec: Recommendation,
  unitSystem: UnitSystem,
  t: TFn,
): RecommendationText | null {
  // ADR-0040. `action: 'none'` used to mean "render nothing", which is the
  // second half of why a straight-sets lift was silent: the copy was the empty
  // string AND the note never mounted. A refusal the user cannot see is
  // indistinguishable from a broken engine, so these reasons speak.
  if (rec.action === 'none' && !NON_MYOREPS_REASONS.has(rec.reason.kind)) return null;
  const action = callLabel(rec, t);
  // A bodyweight lift's "load" of 0 is no load, not "0 lb". Assisted 0 is
  // different — no assistance — and keeps its number.
  const load = rec.load != null && (rec.load !== 0 || rec.assisted) ? formatLoad(rec.load, unitSystem) : null;
  return {
    headline: load ? `${load} · ${action}` : action,
    action,
    call: progressionCall(rec),
    load,
    target: targetText(rec, t),
    reason: reasonText(rec, unitSystem, t),
    expect: expectText(rec, t),
    notes: notesText(rec, unitSystem, t),
    last: lastText(rec, t),
    warnings: rec.warnings.map((w) => t(WARNING_KEYS[w])),
    stall: rec.stall ? stallLines(rec.stall, unitSystem, t) : [],
    tappable: (rec.action === 'add-load' || rec.action === 'drop-back') && rec.load != null,
  };
}
