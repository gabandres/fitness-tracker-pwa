import { useMemo } from 'react';
import { type DailyTargets, dailyTargets } from '@macrolog/core';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';

/**
 * The effective daily targets, or an explicit "not yet".
 *
 * Discriminated for the same reason `HistoryWindow` is (ADR-0004): the inputs
 * arrive over three independent `onSnapshot` channels, and "no data yet" is
 * indistinguishable from "no data" once it has been fed through `dailyTargets`.
 * With empty inputs that call returns a **seed** result — `calorieTarget` 1800,
 * `tdee.source` `'seed'` — which is a real-looking number the UI used to render
 * as the user's target while the listeners were still silent or had failed
 * outright. A caller cannot reach `targets` without saying what it does when
 * they are not there.
 */
export type DailyTargetsView =
  | { loaded: false; error: Error | null }
  | { loaded: true; error: null; targets: DailyTargets };

/** The EFFECTIVE daily targets (calorie + protein), computed through the full
 *  TDEE chain — measured → formula → manual heuristic. Use this anywhere that
 *  needs to *display* the target a user is actually held to, rather than the
 *  raw `manualCaloriesTarget` profile field (which is deleted once the user
 *  refines into formula mode — reading it directly shows a stale "—"). */
export function useDailyTargets(): DailyTargetsView {
  const { logs, weights, profile, loaded, error } = useCoreSnapshot('DailyTargets');
  const targets = useMemo(() => dailyTargets(profile, logs, weights), [profile, logs, weights]);

  return useMemo(
    () => (loaded ? { loaded: true, error: null, targets } : { loaded: false, error }),
    [loaded, error, targets],
  );
}
