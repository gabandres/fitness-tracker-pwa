import { useCallback, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type DailyLog,
  LOG_WINDOW_ROWS,
  computeStreak,
  dayBoundaryOf,
  dayKeyAt,
  isMaintaining,
  parseYmd,
  type DayBoundary,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { useT } from '@/i18n';
import { subscribeDailyWeights, subscribeRecentLogs } from '@/lib/ledger';
import { trackSubs } from '@/lib/sub-debug';
import { syncReminders } from '@/lib/reminders';

/** Whole days since the most recent weigh-in (dailyWeights or a log's weight),
 *  or null when there's never been one. */
function daysSinceWeighIn(
  logs: DailyLog[],
  weights: Record<string, number>,
  boundary: DayBoundary,
): number | null {
  const wKeys = Object.keys(weights);
  let latestKey: string | null = wKeys.length ? wKeys.sort()[wKeys.length - 1] : null;
  for (const l of logs) {
    if (l.weight != null) {
      const k = dayKeyAt(l.date, boundary);
      if (latestKey == null || k > latestKey) latestKey = k;
    }
  }
  if (!latestKey) return null;
  return daysSinceKey(latestKey);
}

/** Whole days since the newest FOOD log's day key, or null with no logs in
 *  the window. Weigh-ins do not count: the lapsed nudge is about the food
 *  habit, and a weight-only day is exactly the day it should still fire. */
function daysSinceLastLog(logs: DailyLog[], boundary: DayBoundary): number | null {
  let latestKey: string | null = null;
  for (const l of logs) {
    const k = dayKeyAt(l.date, boundary);
    if (latestKey == null || k > latestKey) latestKey = k;
  }
  return latestKey ? daysSinceKey(latestKey) : null;
}

function daysSinceKey(key: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const then = parseYmd(key);
  return Math.max(0, Math.floor((today.getTime() - then.getTime()) / 86_400_000));
}

/**
 * Drives the on-device smart reminders (core `planReminders` → expo-notifications
 * via `syncReminders`). Mounted on Today, so it re-runs on app-open / tab focus
 * and after every log (the logs `onSnapshot` fires). Focus-gated + trackSubs'd
 * like the other hooks (ADR-0016) — no permanent listener. A signature guard
 * skips redundant reschedules when the inputs haven't changed.
 *
 * Keeps its own two subscriptions rather than taking `useCoreSnapshot`'s three:
 * it needs no profile, and it holds its inputs in refs precisely so a snapshot
 * does not re-render the screen it is mounted on. It does share the window
 * constant, which it used to restate as a local 400.
 */
export function useReminderSync(): void {
  const { user, profile } = useAuth();
  const uid = user?.uid;
  const t = useT();
  const logsRef = useRef<DailyLog[]>([]);
  const weightsRef = useRef<Record<string, number>>({});
  const lastSig = useRef<string>('');
  // In a ref like every other input here: this hook deliberately keeps its
  // state out of render so a snapshot cannot re-render the screen it is
  // mounted on, and the boundary is read inside `recompute` for the same
  // reason. `profile` itself comes from the already-shared auth context, so
  // this adds no subscription.
  const profileRef = useRef(profile);
  profileRef.current = profile;

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const recompute = () => {
        const logs = logsRef.current;
        const weights = weightsRef.current;
        const boundary = dayBoundaryOf(profileRef.current);
        const todayKey = dayKeyAt(new Date(), boundary);
        const loggedToday =
          weights[todayKey] != null || logs.some((l) => dayKeyAt(l.date, boundary) === todayKey);
        const streak = computeStreak(logs, { freezeMaxGap: 0, boundary }).streak;
        const sinceWeigh = daysSinceWeighIn(logs, weights, boundary);
        const sinceLog = daysSinceLastLog(logs, boundary);
        // Read here, off the ref, like the boundary: a goal change re-plans on
        // the next snapshot rather than re-rendering Today.
        const maintaining = isMaintaining(profileRef.current);

        const sig = `${loggedToday}|${streak}|${sinceWeigh}|${sinceLog}|${maintaining}`;
        if (sig === lastSig.current) return;
        lastSig.current = sig;
        void syncReminders(
          { loggedToday, streak, daysSinceWeighIn: sinceWeigh, daysSinceLastLog: sinceLog, maintaining },
          t,
        );
      };

      const unsubs = [
        subscribeRecentLogs(uid, LOG_WINDOW_ROWS, (l) => {
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
