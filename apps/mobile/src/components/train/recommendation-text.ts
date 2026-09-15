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
 * lines under that. Nothing here invents a number: every figure comes off the
 * `Recommendation` object.
 */
import {
  type InvalidReason,
  type Recommendation,
  type StallReport,
  type UnitSystem,
  formatLoad,
} from '@macrolog/core';
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
  /** Stall diagnosis lines, in order; empty when there is no stall. */
  stall: string[];
  /** Whether the action is an actionable load change (a chip the user can tap). */
  tappable: boolean;
}

const INVALID_KEYS: Record<InvalidReason, I18nKey> = {
  'reps-missing': 'train.rec.invalid.repsMissing',
  'rir-missing': 'train.rec.invalid.rirMissing',
  'rir-to-failure': 'train.rec.invalid.rirToFailure',
  'rir-too-easy': 'train.rec.invalid.rirTooEasy',
  'minis-missing': 'train.rec.invalid.minisMissing',
  'first-mini-too-many': 'train.rec.invalid.firstMiniTooMany',
  'first-mini-too-few': 'train.rec.invalid.firstMiniTooFew',
  'mini-exceeds-activation': 'train.rec.invalid.miniExceeds',
  'load-changed': 'train.rec.invalid.loadChanged',
  'not-clustered': 'train.rec.invalid.notClustered',
};

function actionKey(rec: Recommendation): I18nKey {
  switch (rec.action) {
    case 'add-load': return rec.assisted ? 'train.rec.action.reduceAssist' : 'train.rec.action.addLoad';
    case 'hold': return 'train.rec.action.hold';
    case 'build-reps': return 'train.rec.action.buildReps';
    case 'repeat-invalid': return 'train.rec.action.repeat';
    case 'calibrate': return 'train.rec.action.calibrate';
    case 'none': return 'train.rec.action.calibrate';
  }
}

function reasonText(rec: Recommendation, unitSystem: UnitSystem, t: TFn): string {
  const r = rec.reason;
  const load = rec.currentLoad != null ? formatLoad(rec.currentLoad, unitSystem) : '';
  const { lo, hi } = rec.band;
  switch (r.kind) {
    case 'no-history':
      return t('train.rec.reason.noHistory');
    case 'straight-sets':
      return '';
    case 'invalid': {
      const body = t(INVALID_KEYS[r.reason], {
        n: r.firstMini ?? '', reps: r.reps ?? '', rir: r.rir ?? '',
      });
      return r.group != null && rec.last.length > 1
        ? `${t('train.rec.clusterPrefix', { group: r.group })}${body}`
        : body;
    }
    case 'in-band':
      if (rec.currentLoad == null) return t('train.rec.reason.bodyweightAdd', { reps: r.reps });
      return r.rir != null
        ? t('train.rec.reason.inBand', { reps: r.reps, rir: r.rir, load })
        : t('train.rec.reason.inBandNoRir', { reps: r.reps, load });
    case 'over-band':
      return t('train.rec.reason.overBand', { reps: r.reps, lo, hi });
    case 'below-band':
      return r.group != null
        ? t('train.rec.reason.belowBandCluster', { group: r.group, reps: r.reps, lo, hi })
        : t('train.rec.reason.belowBand', { reps: r.reps, lo, hi });
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
  if (rec.action === 'none') return null;
  const action = t(actionKey(rec));
  const load = rec.load != null ? formatLoad(rec.load, unitSystem) : null;
  return {
    headline: load ? `${load} · ${action}` : action,
    action,
    load,
    reason: reasonText(rec, unitSystem, t),
    last: lastText(rec, t),
    stall: rec.stall ? stallLines(rec.stall, unitSystem, t) : [],
    tappable: rec.action === 'add-load' && rec.load != null,
  };
}
