import { useState } from 'react';
import { type DailyLog, type Profile, LOG_WINDOW_ROWS } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
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
 * decision each caller re-makes — and since 2026-09-14 of `useLedgerFeed`,
 * which this hook now states its three channels to rather than re-wiring the
 * gate, the `trackSubs` label, the readiness record and the error sink itself.
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

  // The gate, the `trackSubs` wrapping, the readiness record and the error
  // policy are `useLedgerFeed`'s; the three `subscribe*` calls stay this hook's
  // own, which is the half ADR-0016 is about.
  const feed = useLedgerFeed({
    uid,
    label,
    gate: 'focus',
    // A refocus is a retry here, uniquely: `loaded` is gated on `!error`, so a
    // standing error would otherwise strand every derivation on this screen
    // until the tab unmounts.
    retryOnOpen: true,
    channels: () =>
      uid
        ? [
            // `settles: 'any'` throughout: a profile that comes back `null`
            // counts, and so does a cache answer. That is an answer ("this user
            // has no profile doc"), not silence — and requiring a server answer
            // would hang a cold-cache offline start.
            feedChannel({
              key: 'logs',
              open: (deliver, fail) => subscribeRecentLogs(uid, LOG_WINDOW_ROWS, deliver, fail),
              apply: setLogs,
            }),
            feedChannel({
              key: 'weights',
              open: (deliver, fail) => subscribeDailyWeights(uid, deliver, fail),
              apply: setWeights,
            }),
            feedChannel({
              key: 'profile',
              open: (deliver, fail) => subscribeProfile(uid, deliver, fail),
              apply: setProfile,
            }),
          ]
        : [],
    deps: [uid],
  });

  return {
    logs,
    weights,
    profile,
    loaded: !feed.error && feed.ready,
    error: feed.error,
  };
}
