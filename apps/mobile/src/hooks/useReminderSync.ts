import { useCallback, useEffect, useRef } from 'react';
import { useFocusEffect } from 'expo-router';
import {
  type DailyLog,
  LOG_WINDOW_ROWS,
  type MealKey,
  calendarDateKey,
  computeStreak,
  isMealRow,
  slotForTime,
  dayBoundaryOf,
  dayKeyAt,
  isMaintaining,
  parseYmd,
  type DayBoundary,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { FEATURES, isFeatureOn } from '@/lib/features';
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
  return daysSinceKey(latestKey, boundary);
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
  return latestKey ? daysSinceKey(latestKey, boundary) : null;
}

/**
 * The meal windows with a food log on today's CALENDAR date, so today's nudge
 * for each can be skipped (owner, 2026-10-08: "when I log a breakfast, lunch
 * or dinner, I shouldn't get a notification").
 *
 * Calendar date, not the boundary-aware day key: the nudges fire at wall-clock
 * times on calendar days. Between midnight and a 3 AM day start the day key is
 * still yesterday's, and yesterday's breakfast must not silence this morning's.
 * Keying each log by `dayKeyAt` and comparing to the calendar date gets both
 * sides right — a 1 AM log belongs to yesterday and matches nothing.
 *
 * An untagged row is slotted by its time, the same default the write path
 * applies (`withDefaultMealSlot`) — the widget's quick-add writes none. Snacks
 * have no reminder and are not counted.
 */
function mealsLoggedOn(logs: DailyLog[], boundary: DayBoundary, now: Date): MealKey[] {
  const today = calendarDateKey(now);
  const meals = new Set<MealKey>();
  for (const l of logs) {
    if (!isMealRow(l) || dayKeyAt(l.date, boundary) !== today) continue;
    const slot = l.mealType ?? slotForTime(l.date);
    if (slot === 'breakfast' || slot === 'lunch' || slot === 'dinner') meals.add(slot);
  }
  return [...meals].sort();
}

/**
 * Whole days between a day key and TODAY — the user's today (ADR-0030), not
 * calendar midnight: `key` is a boundary-aware `dayKeyAt` key, and at 01:00
 * under a 3 AM start a log from 23:00 is the SAME day, not one day ago.
 *
 * `round`, not `floor`: both ends are local midnights, so the span is a whole
 * number of days except across a DST change, where it is an hour short or
 * long. `floor` turned "an hour short" into a day too few, and the lapsed
 * nudges (+3/+7 days) fired a day late for the week after clocks went forward.
 */
function daysSinceKey(key: string, boundary: DayBoundary): number {
  const today = parseYmd(dayKeyAt(new Date(), boundary));
  const then = parseYmd(key);
  return Math.max(0, Math.round((today.getTime() - then.getTime()) / 86_400_000));
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
  const { user, profile, isAdmin } = useAuth();
  const uid = user?.uid;
  // The tape reminder's gate (ADR-0043): its only switch is on a card that
  // goes away with the flag, so the flag has to reach the scheduler from here.
  const tapeAllowed = isFeatureOn(FEATURES.compositionMaintenance, { isAdmin });
  const tapeAllowedRef = useRef(tapeAllowed);
  const recomputeRef = useRef<(() => void) | null>(null);
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
  // Both mirrors are written here rather than during render (a render-time ref
  // write made the React Compiler skip this hook). Declared BEFORE the focus
  // effect and the flag effect below, so in any one commit it has run before
  // either of them reads the refs.
  useEffect(() => {
    tapeAllowedRef.current = tapeAllowed;
    profileRef.current = profile;
  });

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      const recompute = () => {
        const logs = logsRef.current;
        const weights = weightsRef.current;
        const boundary = dayBoundaryOf(profileRef.current);
        const now = new Date();
        const todayKey = dayKeyAt(now, boundary);
        const loggedToday =
          weights[todayKey] != null || logs.some((l) => dayKeyAt(l.date, boundary) === todayKey);
        const streak = computeStreak(logs, { freezeMaxGap: 0, boundary }).streak;
        const sinceWeigh = daysSinceWeighIn(logs, weights, boundary);
        const sinceLog = daysSinceLastLog(logs, boundary);
        // Read here, off the ref, like the boundary: a goal change re-plans on
        // the next snapshot rather than re-rendering Today.
        const maintaining = isMaintaining(profileRef.current);
        const tape = { allowed: tapeAllowedRef.current, female: profileRef.current?.sex === 'female' };
        const mealsLoggedToday = mealsLoggedOn(logs, boundary, now);

        // The calendar date is in the signature because the meal windows are
        // one-shots counted from today: the first open of a new day re-arms
        // them even when nothing else moved.
        const sig = `${calendarDateKey(now)}|${loggedToday}|${mealsLoggedToday.join(',')}|${streak}|${sinceWeigh}|${sinceLog}|${maintaining}|${tape.allowed}|${tape.female}`;
        if (sig === lastSig.current) return;
        lastSig.current = sig;
        void syncReminders(
          { loggedToday, mealsLoggedToday, streak, daysSinceWeighIn: sinceWeigh, daysSinceLastLog: sinceLog, maintaining, tape },
          t,
        );
      };

      const unsubs = [
        subscribeRecentLogs(uid, LOG_WINDOW_ROWS, (l) => {
          logsRef.current = l;
          recomputeRef.current = recompute;
          recompute();
        }),
        subscribeDailyWeights(uid, (w) => {
          weightsRef.current = w;
          recomputeRef.current = recompute;
          recompute();
        }),
      ];
      const release = trackSubs('ReminderSync', unsubs);
      return () => {
        recomputeRef.current = null;
        release();
      };
    }, [uid, t]),
  );

  // The admin claim lands after the first snapshots (`getIdTokenResult` is not
  // awaited before routing), so a flag change re-plans here rather than
  // waiting for the next log. Only once a snapshot has armed `recompute`: a
  // plan from empty refs would be the wrong plan.
  useEffect(() => {
    recomputeRef.current?.();
  }, [tapeAllowed]);
}
