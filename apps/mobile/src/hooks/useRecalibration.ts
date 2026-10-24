import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  LOG_WINDOW_ROWS,
  MIDNIGHT,
  type RecalibrationAck,
  type RecalibrationDigest,
  recalibrationDigest,
} from '@macrolog/core';
import { useCachedState } from '@/hooks/useCachedState';
import { useDayKey } from '@/hooks/useDayKey';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useTargetWeights } from '@/hooks/useTargetWeights';
import { useAuth } from '@/lib/auth';
import { subscribeDailyLogged, subscribeRecentLogs } from '@/lib/ledger';

const ACK_KEY = 'ignia.tdee-recal-ack';

/**
 * Adaptive-TDEE recalibration digest (v1.1 retention loop) — the mobile twin
 * of the web FitnessStore.recalibration signal. Read-only over the shared
 * `recalibrationDigest`; makes the silent measured-mode TDEE adaptation
 * visible. The "last acknowledged" reference is persisted per-device in
 * AsyncStorage (mirrors the whatsNew dismiss key), so there's no Firestore
 * field to write. Subscribes to its own logs/weights snapshots — the
 * intentional per-hook duplication (ADR-0016).
 *
 * Not through `useCoreSnapshot` since 2026-10-21. That hook's weights listener
 * is the WHOLE collection, and this one is mounted on Today — so Today held an
 * unbounded weights listener for a digest whose estimator never reads a weight
 * before the oldest row of its log window. It now takes the same bounded
 * weights Today's own targets do (`useTargetWeights`, exact by the argument at
 * `weightsWindowStart`), and the profile from the auth context — the one
 * listener the whole app already shares, as `useReminderSync` does — instead of
 * a third profile listener on the same screen.
 */
/** What the card can say the numbers moved FROM: the maintenance last
 *  acknowledged and, for acks written since 2026-10-06, the target that was on
 *  screen then. Null before any acknowledgement. */
export interface RecalibrationPrevious {
  tdee: number;
  target: number | null;
}

/** The persisted ack. `target` rides alongside the core's `{ value, at }` so
 *  the card can show old → new; an older ack without it still parses. */
type StoredAck = RecalibrationAck & { target?: number };

export function useRecalibration(): {
  digest: RecalibrationDigest;
  acknowledge: () => void;
  previous: RecalibrationPrevious | null;
} {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useCachedState<DailyLog[]>(uid, 'logs', []);
  // "Day fully logged?" answers: the digest must describe the estimate the
  // target is built from, and that estimate reads them (2026-10-24).
  const [dayComplete, setDayComplete] = useCachedState<Record<string, boolean>>(uid, 'dayLogged', {});
  useLedgerFeed({
    uid,
    label: 'Recalibration',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'logs',
              settles: 'none',
              open: (deliver) => subscribeRecentLogs(uid, LOG_WINDOW_ROWS, deliver),
              apply: setLogs,
            }),
            feedChannel({
              key: 'dayComplete',
              settles: 'none',
              open: (deliver) => subscribeDailyLogged(uid, deliver),
              apply: setDayComplete,
            }),
          ]
        : [],
    deps: [uid],
  });
  // Calendar today only places an EMPTY log window (`weightsWindowStart`);
  // with rows the window starts at the oldest one whatever the boundary.
  const todayKey = useDayKey(MIDNIGHT);
  const { weights } = useTargetWeights({ uid, logs, todayKey, label: 'Recalibration' });
  const [ack, setAck] = useState<StoredAck | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACK_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p?.value === 'number' && typeof p?.at === 'number') {
          setAck({ value: p.value, at: p.at, ...(typeof p.target === 'number' ? { target: p.target } : {}) });
        }
      })
      .catch(() => {
        /* no prior ack / unreadable — treat as never acknowledged */
      });
  }, []);

  const digest = useMemo(
    () => recalibrationDigest(profile, logs, weights, { now: Date.now(), ack, dayComplete }),
    [profile, logs, weights, ack, dayComplete],
  );

  const acknowledge = useCallback(() => {
    if (!digest.available) return;
    const next: StoredAck = { value: digest.trueTdee, at: Date.now(), target: digest.calorieTarget };
    setAck(next);
    AsyncStorage.setItem(ACK_KEY, JSON.stringify(next)).catch(() => {
      /* best-effort; a failed persist just re-surfaces next launch */
    });
  }, [digest]);

  const previous = useMemo<RecalibrationPrevious | null>(
    () => (ack ? { tdee: ack.value, target: ack.target ?? null } : null),
    [ack],
  );

  return { digest, acknowledge, previous };
}
