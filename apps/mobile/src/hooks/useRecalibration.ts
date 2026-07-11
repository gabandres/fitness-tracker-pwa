import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type Profile,
  type RecalibrationAck,
  type RecalibrationDigest,
  recalibrationDigest,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

const LOG_WINDOW = 400;
const ACK_KEY = 'ignia.tdee-recal-ack';

/**
 * Adaptive-TDEE recalibration digest (v1.1 retention loop) — the mobile twin
 * of the web FitnessStore.recalibration signal. Read-only over the shared
 * `recalibrationDigest`; makes the silent measured-mode TDEE adaptation
 * visible. The "last acknowledged" reference is persisted per-device in
 * AsyncStorage (mirrors the whatsNew dismiss key), so there's no Firestore
 * field to write. Subscribes to its own profile/logs/weights snapshots — the
 * intentional per-hook duplication (ADR-0016), same shape as useDailyTargets.
 */
export function useRecalibration(): { digest: RecalibrationDigest; acknowledge: () => void } {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [ack, setAck] = useState<RecalibrationAck | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(ACK_KEY)
      .then((raw) => {
        if (!raw) return;
        const p = JSON.parse(raw);
        if (typeof p?.value === 'number' && typeof p?.at === 'number') {
          setAck({ value: p.value, at: p.at });
        }
      })
      .catch(() => {
        /* no prior ack / unreadable — treat as never acknowledged */
      });
  }, []);

  useEffect(() => {
    if (!uid) return;
    const unsubs = [
      subscribeRecentLogs(uid, LOG_WINDOW, setLogs),
      subscribeDailyWeights(uid, setWeights),
      subscribeProfile(uid, setProfile),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

  const digest = useMemo(
    () => recalibrationDigest(profile, logs, weights, { now: Date.now(), ack }),
    [profile, logs, weights, ack],
  );

  const acknowledge = useCallback(() => {
    if (!digest.available) return;
    const next: RecalibrationAck = { value: digest.trueTdee, at: Date.now() };
    setAck(next);
    AsyncStorage.setItem(ACK_KEY, JSON.stringify(next)).catch(() => {
      /* best-effort; a failed persist just re-surfaces next launch */
    });
  }, [digest]);

  return { digest, acknowledge };
}
