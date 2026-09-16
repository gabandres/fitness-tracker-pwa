/**
 * Layer 6 of the progression engine: the recommendation as sentences.
 *
 * Core decides (`@macrolog/core` `recommend`); this renders the decision in
 * the user's language and load unit. Pure — takes `t` and the unit system,
 * returns strings — so the exact wording the lifter reads is unit-testable
 * without a renderer, and the three locales are forced to carry every key.
 *
 * The shape is fixed by the spec: load, action, one line of reason citing the
 * numbers, and last session's activation reps + RIR. A stall adds its own
 * lines under that. Since ADR-0039 two more lines can appear: the
 * calibration count while the lift has no band yet ("Calibrating — n of 3
 * valid sessions logged"), and a soft warning when a 1-in-reserve lift was
 * taken to failure. Nothing here invents a number: every figure comes off
 * the `Recommendation` object.
 */
import {
  type InvalidReason,
  type Recommendation,
  type RecommendWarning,
  type StallReport,
  type UnitSystem,
  formatLoad,
} from '@macrolog/core';
import type { SetStructure } from '@/lib/workout';
import type { I18nKey, TFn } from '@/i18n';

export interface RecommendationText {
  /** "20 lb · HOLD AND BUILD" — load first when there is one. */
  headline: string;
  /** The action alone, for a chip. */
  action: string;
  /** The formatted load, or null when the engine has no number to give. */
  load: string | null;
  /** One sentence citing the numbers. */
  reason: string;
  /** "Last: 11 reps @ RIR 1" (per cluster when there are several), or null. */
  last: string | null;
  /** The calibration count when the lift has no band yet AND the reason line
   *  did not already say so (an invalid read during calibration). */
  calibration: string | null;
  /** Soft warnings, in order; empty when there are none. */
  warnings: string[];
  /** Stall diagnosis lines, in order; empty when there is no stall. */
  stall: string[];
  /** Whether the action is an actionable load change (a chip the user can tap). */
  tappable: boolean;
}

/** Reason kinds that are NOT on the myo-reps path, and for which the derived
 *  band / calibration count is meaningless (ADR-0040). */
const NON_MYOREPS_REASONS = new Set<string>([
  'straight-sets', 'rest-pause', 'cluster-sets',
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

function actionKey(rec: Recommendation): I18nKey {
  switch (rec.action) {
    case 'add-load': return rec.assisted ? 'train.rec.action.reduceAssist' : 'train.rec.action.addLoad';
    case 'hold': return 'train.rec.action.hold';
    case 'build-reps': return 'train.rec.action.buildReps';
    case 'repeat-invalid': return 'train.rec.action.repeat';
    case 'calibrate': return 'train.rec.action.calibrate';
    // ADR-0040. Previously unreachable: `recommendationText` returned null for
    // every `none`, so this label was never rendered. It is reachable now, and
    // "Calibrating" would be a lie about a refusal.
    case 'none': return 'train.rec.action.noCall';
  }
}

function reasonText(rec: Recommendation, unitSystem: UnitSystem, t: TFn): string {
  const r = rec.reason;
  const load = rec.currentLoad != null ? formatLoad(rec.currentLoad, unitSystem) : '';
  // The band is non-null on every reason kind that cites it; the fallbacks
  // keep the renderer total rather than trusting that invariant.
  const lo = rec.band?.holdLo ?? '';
  const hi = rec.band?.holdHi ?? '';
  const at = rec.band?.addLoadAt ?? '';
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
    case 'no-rule':
      return t('train.rec.reason.noRule');
    case 'nothing-to-read':
      return t('train.rec.reason.nothingToRead');
    case 'unsupported-structure':
      return t('train.rec.reason.unsupportedStructure', {
        structure: t(STRUCTURE_KEYS[r.structure]),
      });
    case 'calibrating':
      return t('train.rec.calibrating', { n: r.valid, needed: r.needed });
    case 'invalid': {
      const body = t(INVALID_KEYS[r.reason], {
        n: r.firstMini ?? '', reps: r.reps ?? '', rir: r.rir ?? '',
      });
      return r.group != null && rec.last.length > 1
        ? `${t('train.rec.clusterPrefix', { group: r.group })}${body}`
        : body;
    }
    case 'at-target':
      if (rec.currentLoad == null) return t('train.rec.reason.bodyweightAdd', { reps: r.reps });
      return r.rir != null
        ? t('train.rec.reason.atTarget', { reps: r.reps, rir: r.rir, load, at })
        : t('train.rec.reason.atTargetNoRir', { reps: r.reps, load, at });
    case 'over-band':
      return t('train.rec.reason.overBand', { reps: r.reps, at });
    case 'below-band':
      return r.group != null
        ? t('train.rec.reason.belowBandCluster', { group: r.group, reps: r.reps, at })
        : t('train.rec.reason.belowBand', { reps: r.reps, lo, hi, at });
    case 'under-band':
      return r.group != null
        ? t('train.rec.reason.underBandCluster', { group: r.group, reps: r.reps, lo, hi, goal: r.goal, load })
        : t('train.rec.reason.underBand', { reps: r.reps, lo, hi, goal: r.goal, load });
    case 'jump-too-big':
      return t('train.rec.reason.jumpTooBig', {
        next: formatLoad(r.nextLoad, unitSystem),
        pct: Math.round(r.jumpPct * 100),
        reps: r.repsGoal,
        load,
      });
  }
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

/** The calibration count, shown when no band is in force and the reason line
 *  is about something else (an invalid read). Null otherwise. */
function calibrationText(rec: Recommendation, t: TFn): string | null {
  if (rec.band != null) return null;
  if (rec.reason.kind === 'calibrating' || rec.reason.kind === 'no-history') return null;
  // The derived-band calibration is a myo-reps concept (ADR-0039). Off that
  // path there is nothing calibrating, so counting sessions toward a band the
  // lift will never use would be noise at best and a lie at worst.
  if (NON_MYOREPS_REASONS.has(rec.reason.kind)) return null;
  return t('train.rec.calibrating', { n: rec.calibration.validSessions, needed: rec.calibration.needed });
}

export function stallLines(stall: StallReport, unitSystem: UnitSystem, t: TFn): string[] {
  const lines = [t('train.rec.stall', { n: stall.sessions, load: formatLoad(stall.load, unitSystem) })];
  if (stall.invalidSessions > 0) {
    lines.push(t('train.rec.stallInvalid', { n: stall.invalidSessions, total: stall.sessions }));
  }
  if (stall.easyActivations > 0) {
    lines.push(t('train.rec.stallEasy', { n: stall.easyActivations, total: stall.sessions }));
  }
  if (stall.blockingGroup != null) {
    lines.push(t('train.rec.stallBlocked', { group: stall.blockingGroup }));
  }
  stall.interventions.forEach((fix, i) => {
    const n = i + 1;
    if (fix === 'shorten-mini-rest') lines.push(t('train.rec.fix.shortenMiniRest', { n }));
    else if (fix === 'reduce-blocking-cluster') lines.push(t('train.rec.fix.reduceBlockingCluster', { n, group: stall.blockingGroup ?? '' }));
    else lines.push(t('train.rec.fix.reduceLoad', { n }));
  });
  return lines;
}

/**
 * The recommendation as text, or `null` when the engine has nothing to say
 * (`action: 'none'` — a straight-set lift keeps the existing ghost + bump).
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
  const action = t(actionKey(rec));
  const load = rec.load != null ? formatLoad(rec.load, unitSystem) : null;
  return {
    headline: load ? `${load} · ${action}` : action,
    action,
    load,
    reason: reasonText(rec, unitSystem, t),
    last: lastText(rec, t),
    calibration: calibrationText(rec, t),
    warnings: rec.warnings.map((w) => t(WARNING_KEYS[w])),
    stall: rec.stall ? stallLines(rec.stall, unitSystem, t) : [],
    tappable: rec.action === 'add-load' && rec.load != null,
  };
}
