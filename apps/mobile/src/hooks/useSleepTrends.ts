import { useCallback, useMemo, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type DailyLog,
  type Profile,
  type SleepContrast,
  type SleepEntry,
  type SleepWindow,
  SLEEP_CARD_MIN_NIGHTS,
  SLEEP_WINDOW_DAYS,
  dayBoundaryOf,
  sleepIntakeContrast,
  sleepWindow,
  summarizeDays,
  trailingDateKeys,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { trackSubs } from '@/lib/sub-debug';
import { subscribeDailySleepSince } from '@/lib/ledger';
import { isHealthConnected } from '@/lib/health-sync';
import { isOuraConnectedOnce } from '@/lib/oura';

/**
 * Sleep for the Trends card (ADR-0033, issue #81).
 *
 * ## Why this is its own hook and its own listener
 *
 * `useCoreSnapshot` carries logs, weights and profile — the three things every
 * derivation in `@macrolog/core` reads. Sleep is not among them, and it is
 * deliberately not being added: three screens would then pay for a listener one
 * screen reads. Per [ADR-0016](../../../../docs/adr/0016-mobile-per-hook-subscriptions-intentional.md)
 * the second consumer opens **its own** channel; the duplication is the model,
 * and what bounds it is focus-gating, which this hook does.
 *
 * The listener is `subscribeDailySleepSince`, not `subscribeDailySleep` — the
 * latter has no range bound and a two-year account has ~700 documents in that
 * collection.
 *
 * ## The card has three states and the common one is the smallest
 *
 * Most people have no sleep data at all: it arrives with a wearable or with a
 * habit of typing it, and neither is common. So below
 * {@link SLEEP_CARD_MIN_NIGHTS} nights there is no card and no section header —
 * one row, which is what `kind: 'empty'` renders. From the third night the card
 * is present and never changes shape again; what arrives at the evidence bar is
 * one sentence (`contrast`).
 *
 * `connectedTo` is why the empty row is not always the same sentence. A source
 * that is connected and has produced nothing is a fact about the integration,
 * not about the user's sleep — the Oura app can have its export switched off,
 * and Android before vc 38 could not read workouts at all — so "you have no
 * sleep" would be a lie. That is ADR-0026's empty-state rule applied verbatim.
 */
export type SleepTrends =
  /** The listener has not answered yet. Render nothing rather than an empty
   *  row that turns into a card a frame later. */
  | { kind: 'pending' }
  /** Fewer than {@link SLEEP_CARD_MIN_NIGHTS} nights: one row, no card. */
  | { kind: 'empty'; connectedTo: 'oura' | 'health' | null }
  | { kind: 'card'; window: SleepWindow; contrast: SleepContrast | null };

/**
 * @param logs Oldest-first logs from `useCoreSnapshot` — the intake half of the
 *   pairing. Passed in rather than re-subscribed, because Trends already holds
 *   this exact stream and a second copy of it would be the duplication ADR-0016
 *   does NOT sanction.
 */
export function useSleepTrends(
  logs: readonly DailyLog[],
  weights: Readonly<Record<string, number>>,
  profile: Profile | null,
): SleepTrends {
  const { user } = useAuth();
  const uid = user?.uid;
  const [sleepByDay, setSleepByDay] = useState<Record<string, SleepEntry>>({});
  const [answered, setAnswered] = useState(false);
  const [connectedTo, setConnectedTo] = useState<'oura' | 'health' | null>(null);

  const boundary = useMemo(() => dayBoundaryOf(profile), [profile]);

  // The window's keys, and the `since` bound the query needs. Recomputed per
  // render is fine and per focus is what matters — a card left open across
  // midnight should move on, and this screen re-derives on refocus anyway.
  const dateKeys = useMemo(
    // Boundary-aware, like every other window on this screen. It was the ONLY
    // boundary-aware one for a while, which meant Trends keyed the sleep card
    // and the insight/budget cards to two different calendars; `useTrends`
    // now threads the same boundary through all of them.
    // Writing a NEW pairing midnight-only would be adding a latent bug on
    // purpose; the pairing between a night and the day's eating is the entire
    // claim this card makes.
    () => trailingDateKeys(SLEEP_WINDOW_DAYS, new Date(), boundary),
    [boundary],
  );

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      let alive = true;

      // One-shot reads, not listeners: this only decides which sentence the
      // EMPTY row shows, and a permanent listener for a string is exactly what
      // ADR-0016's focus-gating rule exists to prevent.
      void (async () => {
        const [oura, health] = await Promise.all([
          isOuraConnectedOnce(uid).catch(() => false),
          isHealthConnected().catch(() => false),
        ]);
        if (alive) setConnectedTo(oura ? 'oura' : health ? 'health' : null);
      })();

      const unsubs = [
        subscribeDailySleepSince(
          uid,
          dateKeys[0] ?? '',
          (sleep) => {
            setSleepByDay(sleep);
            setAnswered(true);
          },
          // A listener error is not evidence of "no sleep". Leave `answered`
          // false so the card renders nothing at all rather than an invitation
          // to connect a source the user has already connected.
          () => {},
        ),
      ];
      return () => {
        alive = false;
        trackSubs('Trends/sleep', unsubs)();
      };
    }, [uid, dateKeys]),
  );

  const window = useMemo(() => sleepWindow(sleepByDay, dateKeys), [sleepByDay, dateKeys]);

  const contrast = useMemo(() => {
    if (window.nightsWithReading < SLEEP_CARD_MIN_NIGHTS) return null;
    return sleepIntakeContrast(sleepByDay, summarizeDays(dateKeys, logs, weights, boundary));
  }, [sleepByDay, dateKeys, logs, weights, boundary, window.nightsWithReading]);

  if (!answered) return { kind: 'pending' };
  if (window.nightsWithReading < SLEEP_CARD_MIN_NIGHTS) return { kind: 'empty', connectedTo };
  return { kind: 'card', window, contrast };
}
