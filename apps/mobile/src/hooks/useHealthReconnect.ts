import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { useHealthSync } from '@/lib/health-sync';
import {
  RECONNECT_SNOOZE_KEY,
  RECONNECT_SNOOZE_MS,
  SAW_APPLE_WATCH_KEY,
  shouldPromptReconnect,
} from '@/lib/health-reconnect-rule';

/**
 * The Today prompt to reconnect Apple Health (owner, 2026-10-20): heart rate
 * arrived as a NEW read scope, and HealthKit asks for a new scope only when
 * the app requests it again — so nobody connected before it gets workout HR
 * until they reconnect, and nothing on Today said so. Shown to iOS users with
 * Apple Watch workouts (`shouldPromptReconnect`); "Later" snoozes it 3 days.
 */
export function useHealthReconnect(uid: string | undefined) {
  const hs = useHealthSync(uid);
  const [sawWatch, setSawWatch] = useState(false);
  const [snoozedUntil, setSnoozedUntil] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void AsyncStorage.multiGet([SAW_APPLE_WATCH_KEY, RECONNECT_SNOOZE_KEY]).then((rows) => {
      if (!alive) return;
      const get = (k: string) => rows.find(([key]) => key === k)?.[1] ?? null;
      setSawWatch(get(SAW_APPLE_WATCH_KEY) === '1');
      const until = Number(get(RECONNECT_SNOOZE_KEY));
      setSnoozedUntil(Number.isFinite(until) && until > 0 ? until : null);
    });
    return () => {
      alive = false;
    };
  }, [hs.lastSync]);

  const visible = shouldPromptReconnect({
    ios: Platform.OS === 'ios',
    connected: hs.connected,
    needsReauth: hs.needsReauth,
    sawWatch,
    snoozedUntil,
  });

  const reconnect = useCallback(async () => {
    setBusy(true);
    await hs.connect().finally(() => setBusy(false));
  }, [hs]);

  const later = useCallback(async () => {
    const until = Date.now() + RECONNECT_SNOOZE_MS;
    setSnoozedUntil(until);
    await AsyncStorage.setItem(RECONNECT_SNOOZE_KEY, String(until));
  }, []);

  return { visible, busy, reconnect, later };
}
