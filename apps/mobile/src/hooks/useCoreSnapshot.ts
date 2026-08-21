import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { type DailyLog, type Profile, LOG_WINDOW_ROWS } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { trackSubs } from '@/lib/sub-debug';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

/**
 * The three collections every derivation in `@macrolog/core` reads — recent
 * logs, per-day weights, the profile — behind one subscription discipline.
 *
 * **This is not a shared subscription cache and ADR-0016 still holds.** Every
 * caller opens its own `onSnapshot` channels, focus-gated, exactly as before;
 * the listener count is unchanged. What is shared is the *wiring*, which had
 * drifted into four incompatible policies across eight hooks: the 400-row
 * window was restated in five files (twice as a bare literal) beside a
 * `LOG_WINDOW_ROWS` that core already exports; three hooks subscribed on mount
 * rather than on focus, holding listeners awake behind a blurred tab; and the
 * error policy ranged from "surface it" through "swallow it" to "pass no
 * `onError` at all", which is how `useDailyTargets` came to render a seed
 * calorie target forever after a failed listener.
 *
 * Focus-gating is not an option here. ADR-0016 makes it the rule that bounds
 * the per-hook duplication, so it is a property of this module rather than a
 * decision each caller re-makes.
 */
export interface CoreSnapshot {
  /** Oldest-first, per the ledger seam's contract. */
  logs: DailyLog[];
  weights: Record<string, number>;
  profile: Profile | null;
  /**
   * True once all three channels have delivered at least one snapshot and none
   * has errored. A profile that comes back `null` counts — that is an answer
   * ("this user has no profile doc"), not silence.
   *
   * The raw fields above are safe to read either way: empty is an honest
   * reading of "nothing seen yet". What is NOT safe is a *derivation* over
   * them, because `dailyTargets` turns empty inputs into a plausible-looking
   * seed target. Any hook computing one must gate it on this flag — see
   * `useDailyTargets`, which discriminates its whole return type on it.
   */
  loaded: boolean;
  error: Error | null;
}

/**
 * @param label Screen name for the dev listener counter (`trackSubs`). Use the
 *   surface the hook belongs to, so a leak names itself in the console.
 */
export function useCoreSnapshot(label: string): CoreSnapshot {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [answered, setAnswered] = useState({ logs: false, weights: false, profile: false });

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      setError(null);
      // `answered` is deliberately NOT reset here. It is keyed to the account,
      // not to the subscription cycle: re-subscribing on every refocus would
      // otherwise flip `loaded` false for a frame and flash a "—" over a number
      // the user was already looking at. Firestore answers a refocus from its
      // own cache anyway.
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
      return trackSubs(label, unsubs);
    }, [uid, label]),
  );

  return {
    logs,
    weights,
    profile,
    loaded: !error && answered.logs && answered.weights && answered.profile,
    error,
  };
}
