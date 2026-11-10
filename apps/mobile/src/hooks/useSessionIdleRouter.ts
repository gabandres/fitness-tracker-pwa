import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useRouter, useSegments } from 'expo-router';
import { STALE_OPEN_MIN } from '@macrolog/core';
import { useActiveWorkout } from '@/lib/active-workout-signal';
import { idleTapOf, stashIdleTap } from '@/lib/session-idle-notify';

/**
 * The app-wide half of the timer's auto-stop (core `session-idle.ts`). Mount
 * once on the tab layout, beside `useWorkoutIntentRouter`.
 *
 * - A tap on "Still training?" (the body, "Keep going" or "End session") is
 *   stashed for the Train screen and the user is sent there — the app may
 *   reopen on any tab, and Train holds the session.
 * - Opening the app on a workout open longer than 2 h sends the user to Train,
 *   which asks "End session at last set (HH:MM)?" (`useSessionIdle`). Once per
 *   launch and session start, so a "Keep going" is not followed by a yank back
 *   on every foreground.
 */
export function useSessionIdleRouter(): void {
  const router = useRouter();
  const segments = useSegments();
  const onTrain = (segments as readonly string[]).includes('train');
  const workout = useActiveWorkout();
  const latest = useRef({ router, onTrain, workout });
  useEffect(() => {
    latest.current = { router, onTrain, workout };
  });
  const routed = useRef(new Set<number>());
  /** Once per launch and session start (see above). */
  const checkStale = useRef(() => {
    const w = latest.current.workout;
    if (!w.active || w.startedAt == null || routed.current.has(w.startedAt)) return;
    if (Date.now() - w.startedAt <= STALE_OPEN_MIN * 60_000) return;
    routed.current.add(w.startedAt);
    if (!latest.current.onTrain) latest.current.router.navigate('/train');
  }).current;
  // The cached hint lands after mount (`hydrateActiveWorkout` is async).
  useEffect(() => {
    checkStale();
  }, [workout.active, workout.startedAt, checkStale]);

  useEffect(() => {
    const toTrain = () => {
      if (!latest.current.onTrain) latest.current.router.navigate('/train');
    };
    const take = (r: Notifications.NotificationResponse | null | undefined) => {
      const tap = idleTapOf(r);
      if (!tap) return;
      stashIdleTap(tap);
      toTrain();
    };
    // Cold start from the notification.
    void Notifications.getLastNotificationResponseAsync().then(take, () => {});
    const sub = Notifications.addNotificationResponseReceivedListener(take);

    const appState = AppState.addEventListener('change', (s) => {
      if (s === 'active') checkStale();
    });
    return () => {
      sub.remove();
      appState.remove();
    };
  }, [checkStale]);
}
