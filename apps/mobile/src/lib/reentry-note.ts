import { REENTRY_RIR, type ReentryRule } from '@macrolog/core';
import type { TFn } from '@/i18n';

/**
 * The line a re-entry session shows (core `reentry.ts`). A session that froze
 * a rule (`WorkoutSession.reentryRule`, 2026-11-18) says that rule — its own
 * banner when the trip named one ("Re-entry — legs: −10%, RIR 2"); one without
 * says the default −10 %, RIR 2.
 */
export function reentryNote(t: TFn, kind: 'travel' | 'post-travel', rule?: ReentryRule): string {
  if (!rule) return t(kind === 'travel' ? 'train.reentry.travelNote' : 'train.reentry.postTravelNote', { rir: REENTRY_RIR });
  if (rule.label) return rule.label;
  return rule.rir != null
    ? t('train.reentry.ruleNote', { pct: rule.loadPct, rir: rule.rir })
    : t('train.reentry.ruleNoteNormal', { pct: rule.loadPct });
}

/** The RIR a re-entry set aims at: the rule's, else the lift's own standard
 *  (`normal`) when the rule says normal effort, else the default RIR 2. */
export function reentryTargetRir(rule: ReentryRule | undefined, normal: number): number {
  if (!rule) return REENTRY_RIR;
  return rule.rir ?? normal;
}
