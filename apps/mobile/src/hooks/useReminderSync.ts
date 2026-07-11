import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import { type DailyLog, computeStreak, localDateKey, parseYmd } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useT } from '@/i18n';
import { subscribeDailyWeights, subscribeRecentLogs } from '@/lib/ledger';
import { trackSubs } from '@/lib/sub-debug';
import { syncReminders } from '@/lib/reminders';

const LOG_WINDOW = 400;

/** Whole days since the most recent weigh-in (dailyWeights or a log's weight),
 *  or null when there's never been one. */
function daysSinceWeighIn(
  logs: DailyLog[],
  weights: Record<string, number>,
): number | null {
  const wKeys = Object.keys(weights);
  let latestKey: string | null = wKeys.length ? wKeys.sort()[wKeys.length - 1] : null;
  for (const l of logs) {
    if (l.weight != null) {
      const k = localDateKey(l.date);
      if (latestKey == null || k > latestKey) latestKey = k;
    }
  }
  if (!latestKey) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = parseYmd(latestKey);
  return Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86_400_000));
}

/**
 * Drives the on-device smart reminders (core `planReminders` → expo-notifications
 * via `syncReminders`). Mounted on Today, so it re-runs on app-open / tab focus
 * and after every log (the logs `onSnapshot` fires). Focus-gated + trackSubs'd
 * like the other hooks (ADR-0016) — no permanent listener. A signature guard
 * skips redundant reschedules when the inputs haven't changed.
 */
export function useReminderSync(): void {
  const { user } = useAuth();
  const uid = user?.uid;
  const t = useT();
  const logsRef = useRef<DailyLog[]>([]);
  const weightsRef = useRef<Record<string, number>>({});
  const lastSig = useRef<string>('');

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const recompute = () => {
        const logs = logsRef.current;
        const weights = weightsRef.current;
        const todayKey = localDateKey(new Date());
        const loggedToday =
          weights[todayKey] != null || logs.some((l) => localDateKey(l.date) === todayKey);
        const streak = computeStreak(logs, { freezeMaxGap: 0 }).streak;
        const sinceWeigh = daysSinceWeighIn(logs, weights);

        const sig = `${loggedToday}|${streak}|${sinceWeigh}`;
        if (sig === lastSig.current) return;
        lastSig.current = sig;
        void syncReminders({ loggedToday, streak, daysSinceWeighIn: sinceWeigh }, t);
      };

      const unsubs = [
        subscribeRecentLogs(uid, LOG_WINDOW, (l) => {
          logsRef.current = l;
          recompute();
        }),
        subscribeDailyWeights(uid, (w) => {
          weightsRef.current = w;
          recompute();
        }),
      ];
      return trackSubs('ReminderSync', unsubs);
    }, [uid, t]),
  );
}
