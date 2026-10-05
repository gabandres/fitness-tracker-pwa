import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as haptics from '@/lib/haptics';
import { useT, type I18nKey, type TFn } from '@/i18n';

export interface RestTimer {
  /** Seconds left; 0 = idle (the rest bar hides). */
  remaining: number;
  /** `m:ss` display of `remaining`. */
  label: string;
  /** Start (or replace) a countdown for `seconds`. No-op for ≤ 0. */
  start: (seconds: number) => void;
  /** Cancel the countdown and go idle. Idempotent. */
  stop: () => void;
  /**
   * Schedule the "rest over" notification for the countdown already running,
   * if none is scheduled yet. For the priming sheet (`RestNotifySheet`): the
   * countdown that surfaced it started BEFORE permission existed, so its
   * schedule resolved null; once the OS says yes this arms it without
   * restarting the clock. No-op when idle or already armed.
   */
  rearm: () => void;
}

function formatMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/**
 * Every rest notification's id starts with this, then a per-rest suffix.
 *
 * **Must equal `RestDoneNotification.idPrefix` in
 * `targets/_shared/RestActivity.swift`.** The rest Live Activity's "+30 s" and
 * "Skip" buttons run natively while JS may be suspended, and they move or
 * cancel this notification by matching the prefix — otherwise the phone buzzes
 * "rest over" 30 s early, or for a rest the lifter skipped. A prefix rather than
 * one fixed id because each rest still needs its OWN id: the stale-schedule
 * guard below cancels by id, and a shared one would cancel the next rest's.
 */
export const REST_DONE_ID_PREFIX = 'ignia.restDone.';
/** Makes two rests with the same deadline (a replace inside one millisecond)
 *  still get distinct ids. */
let restDoneSeq = 0;

/**
 * Schedule the "rest is over" local notification for `at`, or resolve null
 * when it must not be scheduled.
 *
 * Only when permission is ALREADY granted — `getPermissionsAsync`, never
 * `requestPermissionsAsync`. The app asks in two places, both explained
 * first: the reminders opt-in (`reminders.ts`) and the one-time priming sheet
 * Train shows when the first rest starts (`rest-notify-priming.ts`). A bare
 * OS dialog popping mid-countdown is exactly the wrong moment, so this never
 * asks. No permission, no notification, no prompt.
 *
 * Exported for the test; the hook is the only production caller.
 */
export async function scheduleRestDoneNotification(at: Date, t: TFn): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;
    return await Notifications.scheduleNotificationAsync({
      identifier: `${REST_DONE_ID_PREFIX}${at.getTime()}.${++restDoneSeq}`,
      content: {
        title: t('train.restDoneTitle' as I18nKey),
        body: t('train.restDoneBody' as I18nKey),
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // A notification that fails to schedule is a lost buzz, not a lost set.
    return null;
  }
}

/**
 * Between-sets rest countdown. Mirrors the PWA rest-timer state machine
 * (start replaces, never stacks; auto-stops at 0; idempotent stop). Local
 * only — no Firestore. A single interval ticks once a second.
 *
 * The deadline also schedules a LOCAL notification (when permission is already
 * granted), because the in-app haptic only fires if the JS timer is running —
 * and a lifter who locked the phone or switched to music gets no timer tick
 * until they come back. Start schedules, stop/replace/unmount cancel.
 */
export function useRestTimer(): RestTimer {
  const t = useT();
  const [remaining, setRemaining] = useState(0);
  const handle = useRef<ReturnType<typeof setInterval> | null>(null);
  /** When the rest ends, epoch ms. The interval only REDRAWS from this — it
   *  never counts. JS timers are suspended while the screen is locked, and a
   *  lifter locks the phone between sets: a tick-counting timer that slept 60 s
   *  of a 90 s rest woke up still showing ~90 s, and buzzed a minute late. */
  const deadline = useRef<number | null>(null);
  /** The scheduled notification for the current countdown, once known. */
  const notifId = useRef<string | null>(null);
  /** Bumped on every start/stop so a schedule that resolves AFTER the
   *  countdown it belonged to was cancelled is itself cancelled, not kept. */
  const generation = useRef(0);

  const cancelNotification = useCallback(() => {
    generation.current += 1;
    const id = notifId.current;
    notifId.current = null;
    if (id) void Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
  }, []);

  const stop = useCallback(() => {
    if (handle.current) {
      clearInterval(handle.current);
      handle.current = null;
    }
    deadline.current = null;
    cancelNotification();
    setRemaining(0);
  }, [cancelNotification]);

  const start = useCallback(
    (seconds: number) => {
      if (handle.current) clearInterval(handle.current);
      cancelNotification();
      if (!(seconds > 0)) {
        handle.current = null;
        deadline.current = null;
        setRemaining(0);
        return;
      }
      const secs = Math.round(seconds);
      const end = Date.now() + secs * 1000;
      deadline.current = end;
      setRemaining(secs);

      const gen = generation.current;
      void scheduleRestDoneNotification(new Date(end), t).then((id) => {
        if (!id) return;
        if (generation.current !== gen) {
          // Stopped or replaced while this was in flight.
          void Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
          return;
        }
        notifId.current = id;
      });

      handle.current = setInterval(() => {
        const end = deadline.current;
        const left = end == null ? 0 : Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (left <= 0) {
          if (handle.current) clearInterval(handle.current);
          handle.current = null;
          deadline.current = null;
          // The notification has fired (or is about to) by now; the app is in
          // the foreground for this tick to run, so the buzz is the signal.
          // Forget the id rather than cancel — cancelling a delivered
          // notification is a no-op, and the JS tick can land a beat early.
          notifId.current = null;
          // Buzz on natural completion (time to lift) — skip/stop stays silent.
          haptics.success();
          setRemaining(0);
          return;
        }
        setRemaining(left);
      }, 1000);
    },
    [t, cancelNotification],
  );

  const rearm = useCallback(() => {
    const end = deadline.current;
    if (end == null || notifId.current) return;
    const gen = generation.current;
    void scheduleRestDoneNotification(new Date(end), t).then((id) => {
      if (!id) return;
      if (generation.current !== gen || deadline.current !== end) {
        void Notifications.cancelScheduledNotificationAsync(id).catch(() => {});
        return;
      }
      notifId.current = id;
    });
  }, [t]);

  // Clear the interval — and the pending notification — if the component
  // unmounts mid-countdown (the workout was finished or discarded).
  useEffect(() => () => {
    if (handle.current) clearInterval(handle.current);
    cancelNotification();
  }, [cancelNotification]);

  return { remaining, label: formatMMSS(remaining), start, stop, rearm };
}
