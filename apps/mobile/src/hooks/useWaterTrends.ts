import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type Profile,
  type WaterWindow,
  WATER_CARD_MIN_DAYS,
  WATER_WINDOW_DAYS,
  dayBoundaryOf,
  trailingDateKeys,
  waterWindow,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { trackSubs } from '@/lib/sub-debug';
import { subscribeDailyWaterSince } from '@/lib/ledger';

/**
 * Water for the Trends card (#115 §3).
 *
 * ## Its own listener, bounded and focus-gated
 *
 * Today already subscribes `dailyWater` through `useToday`, and this does not
 * reuse it. Per [ADR-0016](../../../../docs/adr/0016-mobile-per-hook-subscriptions-intentional.md)
 * the second consumer of a collection opens its own channel rather than widening
 * `useCoreSnapshot` — three screens would otherwise pay for a listener one screen
 * reads. What bounds the duplication is focus-gating, which this hook does, and
 * `subscribeDailyWaterSince` is range-bounded on top of that.
 *
 * ## Three states, and the common one is the row
 *
 * Measured across all 43 accounts on 2026-08-30
 * (`scripts/trends-water-states.mjs`): **34 (79%) have no water in a fourteen-day
 * window at all**, 5 more are short of the bar, and 4 clear it. So the state this
 * hook returns most often is `empty`, and the row is the feature for nine users
 * in ten. That is the same finding #115 §0 produced for sleep and fasting, and it
 * is why the stub row's copy got the care it did rather than the chart getting
 * all of it.
 *
 * `recorded` separates the two empty states, because they are two different
 * sentences and one of them must not be written. A user with one or two days is
 * told how many and what the bar is — the progress shape the sleep card already
 * uses. **A user with zero is NOT told they need three.** Naming an unearned
 * target to someone who has earned nothing is the forward-pressure pattern
 * `UX_AUDIT.md` §S12 rejects and #108 went on to ban in code, and it is the
 * specific fix that was proposed for §0 and rightly killed.
 */
export type WaterTrends =
  /** The listener has not answered yet. Render nothing — not a header, not a
   *  skeleton — rather than a row that becomes a card a frame later. */
  | { kind: 'pending' }
  /** Fewer than {@link WATER_CARD_MIN_DAYS} days with water in the window. */
  | { kind: 'empty'; recorded: number }
  | { kind: 'card'; window: WaterWindow };

export function useWaterTrends(profile: Profile | null): WaterTrends {
  const { user } = useAuth();
  const uid = user?.uid;
  const [waterByDay, setWaterByDay] = useState<Record<string, number>>({});
  const [answered, setAnswered] = useState(false);

  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);

  const dateKeys = useMemo(
    // Boundary-aware, like every other window on this screen. Trends keyed the
    // sleep card and the insight cards to two different calendars once; a new
    // window that is midnight-only would be adding that bug back on purpose.
    () => trailingDateKeys(WATER_WINDOW_DAYS, new Date(), boundary),
    [boundary],
  );

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const unsubs = [
        subscribeDailyWaterSince(
          uid,
          dateKeys[0] ?? '',
          (next) => {
            setWaterByDay(next);
            setAnswered(true);
          },
          // A listener error is not evidence of "no water". Leaving `answered`
          // false renders nothing at all, rather than inviting someone to start
          // logging because their history failed to load.
          () => {},
        ),
      ];
      return trackSubs('Trends/water', unsubs);
    }, [uid, dateKeys]),
  );

  const window = useMemo(() => waterWindow(waterByDay, dateKeys), [waterByDay, dateKeys]);

  if (!answered) return { kind: 'pending' };
  if (window.daysLogged < WATER_CARD_MIN_DAYS) {
    return { kind: 'empty', recorded: window.daysLogged };
  }
  return { kind: 'card', window };
}
