import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type Fast,
  type FastingWindow,
  type Profile,
  FASTING_CARD_MIN_FASTS,
  FASTING_WINDOW_DAYS,
  dayBoundaryOf,
  dayRange,
  fastingWindow,
  fastsInWindow,
  trailingDateKeys,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { trackSubs } from '@/lib/sub-debug';
import { subscribeFastsSince } from '@/lib/ledger';

/**
 * Fasting for the Trends card (ADR-0034, issue #98).
 *
 * ## The order this depends on, and why it could not have been built first
 *
 * Until #97 shipped, ending a fast DELETED it — `breakFast` nulled
 * `fastStartedAt` and nothing else recorded anything. A card built before that
 * would have had exactly one scalar to draw, the running timer, which is
 * already on Today. ADR-0034's main job was to state that this order is forced,
 * and this hook is the second half of it.
 *
 * ## Its own listener, bounded
 *
 * Per [ADR-0016](../../../../docs/adr/0016-mobile-per-hook-subscriptions-intentional.md)
 * the second consumer of a collection opens its own channel rather than
 * widening `useCoreSnapshot` — three screens would otherwise pay for a listener
 * one screen reads. What bounds the duplication is focus-gating, which this
 * hook does, and `subscribeFastsSince` is range-bounded on top of that: a
 * two-year daily faster has ~700 documents here and the card reads fourteen
 * days of them.
 *
 * ## Three states, and the stub row must not lie about which one it is in
 *
 * ADR-0034's card contract: absent, stub row, card. The distinction that takes
 * the work is inside the stub, because "no completed fasts" has three different
 * causes and they are three different sentences:
 *
 * - **A fast is running right now.** Saying "no fasts yet" to someone who is
 *   sixteen hours into one is simply false, and it is the state a first-time
 *   user is most likely to be in when they come looking.
 * - **One or two fasts recorded.** The card needs three before a strip is a
 *   chart rather than a broken one, so the row says how many and what it is
 *   waiting for — naming the threshold, the way the sleep card's progress line
 *   does, because a silent wait reads as "nothing happened".
 * - **Nothing at all.** And here the row carries the sentence ADR-0032 asks
 *   for: Ignia keeps fasts *from now on*. A user who has fasted for months
 *   before #97 shipped will find an empty card, and without that phrasing it
 *   reads as data loss rather than as a feature that just started.
 */
export type FastingTrends =
  /** The listener has not answered yet. Render nothing — not a header, not a
   *  skeleton — rather than a row that becomes a card a frame later. */
  | { kind: 'pending' }
  /** Fewer than {@link FASTING_CARD_MIN_FASTS} completed fasts in the window. */
  | { kind: 'empty'; recorded: number; fastRunning: boolean }
  | { kind: 'card'; window: FastingWindow; fastCount: number };

export function useFastingTrends(profile: Profile | null): FastingTrends {
  const { user } = useAuth();
  const uid = user?.uid;
  const [fasts, setFasts] = useState<Fast[]>([]);
  const [answered, setAnswered] = useState(false);

  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);

  const dateKeys = useMemo(
    // Boundary-aware, like every other window on this screen. Trends keyed the
    // sleep card and the insight cards to two different calendars once; a new
    // window that is midnight-only would be adding that bug back on purpose.
    () => trailingDateKeys(FASTING_WINDOW_DAYS, new Date(), boundary),
    [boundary],
  );

  // The query bound is the START of the window's first day, not a naive
  // "now minus 14 days" — on a 3 AM boundary those differ by three hours, and a
  // fast that ended at 01:00 on the oldest day belongs to the window while
  // sitting outside a naive bound. `dayRange` is the same function the
  // attribution uses, so the listener and the maths cannot disagree.
  const since = useMemo(() => {
    const first = dateKeys[0];
    return first ? dayRange(first, boundary).start : new Date(0);
  }, [dateKeys, boundary]);

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const unsubs = [
        subscribeFastsSince(
          uid,
          since,
          (next) => {
            setFasts(next);
            setAnswered(true);
          },
          // A listener error is not evidence of "no fasts". Leaving `answered`
          // false renders nothing at all, rather than inviting someone to start
          // a fast because their history failed to load.
          () => {},
        ),
      ];
      return trackSubs('Trends/fasting', unsubs);
    }, [uid, since]),
  );

  const window = useMemo(
    () => fastingWindow(fasts, dateKeys, boundary),
    [fasts, dateKeys, boundary],
  );
  const fastCount = useMemo(
    () => fastsInWindow(fasts, dateKeys, boundary),
    [fasts, dateKeys, boundary],
  );

  if (!answered) return { kind: 'pending' };
  if (fastCount < FASTING_CARD_MIN_FASTS) {
    return { kind: 'empty', recorded: fastCount, fastRunning: !!profile?.fastStartedAt };
  }
  return { kind: 'card', window, fastCount };
}
