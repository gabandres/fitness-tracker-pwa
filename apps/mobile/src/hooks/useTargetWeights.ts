import { useEffect, useRef, useState } from 'react';
import type { DateKey } from '@macrolog/core';
import { useCachedState } from '@/hooks/useCachedState';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { getWeightEdges, subscribeDailyWeightsSince, weightsWindowStart } from '@/lib/ledger';

type Weights = Record<string, number>;

/** Keys of `map` strictly before `sinceKey` — the part a window does not cover. */
function olderThan(map: Weights, sinceKey: string): Weights {
  const out: Weights = {};
  for (const k in map) if (k < sinceKey) out[k] = map[k];
  return out;
}

export interface TargetWeights {
  /**
   * Every weigh-in from {@link weightsWindowStart} on, live, plus the first
   * and the newest reading before it — the map `dailyTargets`,
   * `measurementProgress`, `recalibrationDigest`, `currentWeight` and the share
   * stats each read the WHOLE collection for, and give the same answer from.
   */
  weights: Weights;
  /** The `weights` cache slice painted from disk. */
  fromCache: boolean;
  /**
   * The live window AND both edge readings have come from the server for the
   * CURRENT window. What a per-day target record may be written from: a target
   * computed while the window is re-keying, or before the edges landed, can
   * differ from the real one and would be announced as a change.
   */
  authoritative: boolean;
}

/**
 * The daily weights a TDEE consumer needs, date-bounded (2026-10-21).
 *
 * Today had THREE unbounded `subscribeDailyWeights` listeners open (its own,
 * `useReminderSync`'s and `useRecalibration`'s via `useCoreSnapshot`) — a
 * four-year scale history is ~1,400 documents converted per listener per focus,
 * for a screen whose estimator never looks past the oldest row of its 400-row
 * log window. Body fixed the same thing with a 400-day window plus
 * `getEarliestDailyWeight` (Pf1); this is that fix with the window placed by
 * the logs themselves, which is what makes it EXACT rather than "close enough"
 * — the argument is at {@link weightsWindowStart}.
 *
 * A hook so that the two consumers on Today (`useToday`, `useRecalibration`)
 * state the bound once. It is **not a shared subscription** (ADR-0016): each
 * call opens and owns its own listener through its own `useLedgerFeed`,
 * focus-gated like every other.
 *
 * ## Why the edges ride INTO the cached map
 *
 * The first-ever and newest-before-window readings are two one-document reads
 * (`getWeightEdges`, per open, memoized for minutes), and they are merged into the `weights` slice rather than
 * held beside it. Held beside it, an OFFLINE cold start — where neither read can
 * answer — would paint share stats from the window's first weigh-in and, for an
 * account with no weigh-in inside the window, a formula target from the goal
 * weight. Merged, disk carries them. Until a fresh edge read lands, the older
 * part of whatever is held is carried forward as-is: it came from disk or from
 * the last edge read, and a superset there is harmless (every extra key is
 * before the window, which the estimator ignores, and neither first nor newest).
 *
 * The slice is the same `weights` slice History and `useCoreSnapshot` write
 * their whole-collection map to, the precedent `useBody` set: whichever wrote
 * last paints the next cold start, and every reader recomputes from its own
 * listener a moment later. A whole map painted here is a superset — identical
 * answers, per the argument above.
 */
export function useTargetWeights(opts: {
  /** The account to LISTEN as — only ever a confirmed Firebase user. */
  uid: string | undefined;
  /** The account whose disk slice paints. Defaults to `uid`; Today passes its
   *  presumed-session uid here (see `auth.tsx` `paintUid`). */
  cacheUid?: string;
  /** The rows the caller computes its targets from, oldest first. */
  logs: readonly { date: Date }[];
  todayKey: DateKey;
  label: string;
}): TargetWeights {
  const { uid, logs, todayKey, label } = opts;
  const cacheUid = opts.cacheUid ?? uid;
  const sinceKey = weightsWindowStart(logs, todayKey);
  const [weights, setWeights, fromCache] = useCachedState<Weights>(cacheUid, 'weights', {});

  // Read inside listener callbacks and the edge read, never in render.
  const held = useRef(weights);
  useEffect(() => {
    held.current = weights;
  });
  /** The window's last delivery, tagged with the account and window it was for. */
  const live = useRef<{ tag: string; value: Weights; authoritative: boolean } | null>(null);
  /** The two edge readings, tagged the same way. */
  const edges = useRef<{ tag: string; value: Weights } | null>(null);
  /** Which `uid:since` the server has answered for, per half. */
  const [liveServer, setLiveServer] = useState<string | null>(null);
  const [edgesServer, setEdgesServer] = useState<string | null>(null);
  const tag = uid ? `${uid}:${sinceKey}` : null;

  /** The window's delivery for `t` over the older part. Called only once the
   *  window has delivered for `t` — from its `apply`, or from an edge read
   *  that checked. */
  const compose = (t: string, since: string): Weights => {
    const win = live.current?.tag === t ? live.current.value : {};
    const older = edges.current?.tag === t ? edges.current.value : olderThan(held.current, since);
    return Object.keys(older).length === 0 ? win : { ...older, ...win };
  };

  useLedgerFeed({
    uid,
    label: `${label} weights`,
    gate: 'focus',
    channels: () =>
      uid && tag
        ? [
            // No `fail`, as on every weights channel Today has had: a dropped
            // weights listener must not put the screen into the error state
            // that belongs to its logs channel.
            feedChannel<Weights, 'weights'>({
              key: 'weights',
              settles: 'none',
              open: (deliver) => subscribeDailyWeightsSince(uid, sinceKey, deliver),
              apply: (v, p) => {
                live.current = { tag, value: v, authoritative: p.authoritative };
                setWeights(compose(tag, sinceKey), p);
                if (p.authoritative) setLiveServer(tag);
              },
            }),
          ]
        : [],
    deps: [uid, sinceKey],
    onOpen: ({ uid: u, alive }) => {
      const t = `${u}:${sinceKey}`;
      // Per open, through a few-minute memo (`getWeightEdges`) — so this hook
      // in `useToday` and in `useRecalibration` share one pair of reads, and a
      // run of tab switches is not a run of reads. A weight write drops the
      // memo, so an edit to an old weigh-in from Body is seen on the next
      // visit. A failure (offline) keeps whatever older part is held and
      // leaves `authoritative` false.
      getWeightEdges(u, sinceKey)
        .then(({ first, newest }) => {
          if (!alive()) return;
          const value: Weights = {};
          // The first-ever reading can sit INSIDE the window (a recent first
          // weigh-in); the window owns it then, and a stale copy here would
          // outlive its deletion.
          if (first && first.dateKey < sinceKey) value[first.dateKey] = first.weight;
          if (newest) value[newest.dateKey] = newest.weight;
          edges.current = { tag: t, value };
          setEdgesServer(t);
          const l = live.current;
          if (l?.tag === t) setWeights(compose(t, sinceKey), { authoritative: l.authoritative });
        })
        .catch(() => {});
    },
  });

  return {
    weights,
    fromCache,
    authoritative: tag != null && liveServer === tag && edgesServer === tag,
  };
}
