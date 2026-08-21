import { useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type DailyTargets,
  type Profile,
  LOG_WINDOW_ROWS,
  dailyTargets,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

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
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  // All three feed `dailyTargets`, so all three must have answered before the
  // result means anything. A profile that comes back `null` still counts —
  // that is an answer ("this user has no profile"), not silence.
  const [answered, setAnswered] = useState({ logs: false, weights: false, profile: false });

  useEffect(() => {
    if (!uid) return;
    setError(null);
    setAnswered({ logs: false, weights: false, profile: false });
    const mark = (k: 'logs' | 'weights' | 'profile') =>
      setAnswered((prev) => (prev[k] ? prev : { ...prev, [k]: true }));
    const unsubs = [
      subscribeRecentLogs(
        uid,
        LOG_WINDOW_ROWS,
        (l) => {
          setLogs(l);
          mark('logs');
        },
        setError,
      ),
      subscribeDailyWeights(
        uid,
        (w) => {
          setWeights(w);
          mark('weights');
        },
        setError,
      ),
      subscribeProfile(
        uid,
        (p) => {
          setProfile(p);
          mark('profile');
        },
        setError,
      ),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const loaded = !error && answered.logs && answered.weights && answered.profile;
  const targets = useMemo(() => dailyTargets(profile, logs, weights), [profile, logs, weights]);

  return useMemo(
    () => (loaded ? { loaded: true, error: null, targets } : { loaded: false, error }),
    [loaded, error, targets],
  );
}
