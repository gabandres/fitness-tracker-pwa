import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type RecalibrationAck,
  type RecalibrationDigest,
  recalibrationDigest,
} from '@macrolog/core';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';

const ACK_KEY = 'ignia.tdee-recal-ack';

/**
 * Adaptive-TDEE recalibration digest (v1.1 retention loop) — the mobile twin
 * of the web FitnessStore.recalibration signal. Read-only over the shared
 * `recalibrationDigest`; makes the silent measured-mode TDEE adaptation
 * visible. The "last acknowledged" reference is persisted per-device in
 * AsyncStorage (mirrors the whatsNew dismiss key), so there's no Firestore
 * field to write. Subscribes to its own profile/logs/weights snapshots — the
 * intentional per-hook duplication (ADR-0016) — through the shared
 * `useCoreSnapshot` wiring, same as useDailyTargets.
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
  const { logs, weights, profile } = useCoreSnapshot('Recalibration');
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
    () => recalibrationDigest(profile, logs, weights, { now: Date.now(), ack }),
    [profile, logs, weights, ack],
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
