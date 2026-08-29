import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type DateKey,
  type Fast,
  type DayBoundary,
  dayRange,
  fastsEndingOn,
  sortFastsByEndDesc,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { trackSubs } from '@/lib/sub-debug';
import { addFast, deleteFast, subscribeFastsAround, updateFast } from '@/lib/ledger';

/**
 * The fasts one History day can edit (ADR-0032 decision 3, issue #97).
 *
 * ## Two lists, and they are not the same list
 *
 * - **`fasts`** — everything in the subscribed window, a few days either side
 *   of this one. Nothing renders it. It exists so the editor can check a
 *   proposed interval against its NEIGHBOURS, which by definition sit outside
 *   the day being edited: the fast you are about to collide with is the one
 *   that ended yesterday.
 * - **`dayFasts`** — the fasts this day owns, by the end-day attribution rule
 *   `completedFastHours` uses. This is what the screen lists.
 *
 * Keeping them separate is what makes the overlap check work at all. Filtering
 * first and checking overlap against the filtered list would only ever find
 * collisions with fasts that already ended on the same day, which is the one
 * case a user is least likely to create.
 *
 * ## Its own listener, focus-gated
 *
 * Per ADR-0016 the second consumer of a collection opens its own channel rather
 * than widening `useCoreSnapshot` — Trends reads a trailing fortnight, this
 * reads a few days around one date, and one hook serving both would make every
 * screen pay for the wider window. `useFocusEffect` + `trackSubs` is what
 * bounds the duplication, and it matters more here than on a tab: a History day
 * is a pushed route, so without focus-gating a user who opened seven days would
 * be holding seven listeners.
 *
 * ## Writes are `manual`, and the hook does not decide that
 *
 * `addFast` / `updateFast` stamp `source: 'manual'` themselves. This hook
 * deliberately exposes no way to write `'timer'` — that source belongs to
 * `breakFast` and to nothing else, or the distinction stops meaning anything.
 */
export interface DayFasts {
  /** False once the listener has answered at least once. */
  loading: boolean;
  /** Every fast in the overlap window. Not for rendering — see the note above. */
  fasts: readonly Fast[];
  /** The fasts that ENDED on this day, newest first. What the screen lists. */
  dayFasts: readonly Fast[];
  addFast: (startedAt: Date, endedAt: Date) => Promise<void>;
  updateFast: (fastId: string, startedAt: Date, endedAt: Date) => Promise<void>;
  deleteFast: (fastId: string) => Promise<void>;
}

/**
 * @param enabled when false the listener is never opened, and `fasts` stays
 * empty. Today passes the fasting sheet's own visibility here: that screen
 * needs neighbours only while somebody is actually editing an interval, and a
 * permanent listener on the app's most-visited tab — for a guard that fires
 * almost never — is exactly the "one more small listener" that ADR-0033 §9
 * says to refuse. History passes nothing, because its list is the screen.
 */
export function useDayFasts(
  dateKey: string,
  boundary: DayBoundary,
  enabled = true,
): DayFasts {
  // The route param arrives as an unvalidated URL string and `DateKey` has no
  // constructor that validates one — `calendarDateKey` only brands a Date. The
  // cast is the same one every consumer of this route already makes implicitly;
  // a malformed key yields an empty day, never a wrong one, because `dayRange`
  // and `fastsEndingOn` both fail closed on an unparseable key.
  const key = dateKey as DateKey;
  const { user } = useAuth();
  const uid = user?.uid;
  const [fasts, setFasts] = useState<Fast[]>([]);
  const [loading, setLoading] = useState(true);

  // `dayRange` rather than a naive midnight pair: on a 3 AM boundary the day
  // this screen shows runs 03:00 → 03:00, and the listener has to be bounded to
  // the same day the attribution below uses or the two disagree about which
  // fasts exist.
  const { start, end } = useMemo(() => dayRange(key, boundary), [key, boundary]);

  useFocusEffect(
    useCallback(() => {
      if (!uid || !enabled) return;
      const unsubs = [
        subscribeFastsAround(
          uid,
          start,
          end,
          (next) => {
            setFasts(next);
            setLoading(false);
          },
          // A failed listener must not render as "no fasts on this day" — that
          // invites the user to add a duplicate of a fast that is already
          // there. Staying in `loading` shows the spinner instead.
          () => {},
        ),
      ];
      return trackSubs('History/day-fasts', unsubs);
    }, [uid, enabled, start, end]),
  );

  const dayFasts = useMemo(
    () => sortFastsByEndDesc(fastsEndingOn(fasts, key, boundary)),
    [fasts, key, boundary],
  );

  return {
    loading,
    fasts,
    dayFasts,
    addFast: useCallback(
      async (startedAt: Date, endedAt: Date) => {
        if (uid) await addFast(uid, startedAt, endedAt);
      },
      [uid],
    ),
    updateFast: useCallback(
      async (fastId: string, startedAt: Date, endedAt: Date) => {
        if (uid) await updateFast(uid, fastId, startedAt, endedAt);
      },
      [uid],
    ),
    deleteFast: useCallback(
      async (fastId: string) => {
        if (uid) await deleteFast(uid, fastId);
      },
      [uid],
    ),
  };
}
