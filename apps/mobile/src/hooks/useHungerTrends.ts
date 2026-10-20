import { useMemo, useState } from 'react';
import {
  type HungerWeek,
  type Profile,
  HUNGER_WINDOW_DAYS,
  dayBoundaryOf,
  hungerWeek,
  trailingDateKeys,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useFocusDay } from '@/hooks/useFocusDay';
import { subscribeDailyHungerSince } from '@/lib/ledger';

/**
 * Evening hunger for the Trends card: the trailing 7-day average (core
 * `hungerWeek`). Its own focus-gated listener per ADR-0016, range-bounded to
 * the window like `useSleepTrends`. Display only — the card prints the rule,
 * nothing here writes a target.
 *
 * `null` until the listener answers, so the card never draws "no ratings" a
 * frame before the ratings arrive.
 */
export function useHungerTrends(profile: Profile | null): HungerWeek | null {
  const { user } = useAuth();
  const uid = user?.uid;
  const [byDay, setByDay] = useState<Record<string, number>>({});
  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);
  const focusDay = useFocusDay(boundary);
  const dateKeys = useMemo(() => trailingDateKeys(HUNGER_WINDOW_DAYS, focusDay, boundary), [focusDay, boundary]);
  const feed = useLedgerFeed({
    uid,
    label: 'Trends/hunger',
    gate: 'focus',
    channels: () =>
      uid
        ? [feedChannel({ key: 'hunger', open: (deliver) => subscribeDailyHungerSince(uid, dateKeys[0] ?? '', deliver), apply: setByDay })]
        : [],
    deps: [uid, dateKeys],
  });
  const week = useMemo(() => hungerWeek(byDay, dateKeys), [byDay, dateKeys]);
  return feed.ready ? week : null;
}
