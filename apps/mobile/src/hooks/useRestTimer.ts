import { useCallback, useEffect, useRef, useState } from 'react';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as haptics from '@/lib/haptics';
import { useT, type I18nKey, type TFn } from '@/i18n';
import { REST_DONE_ID_PREFIX } from '@/lib/rest-notification-id';

export interface RestTimer {
  /**
   * When the running rest ends, epoch ms; `null` = idle (the rest bar hides).
   *
   * Changes on start, stop and run-out ONLY — never once a second. The
   * per-second number is {@link useRestCountdown}'s, called by the rest bar
   * itself: this hook lives in `ActiveSession`, and a `remaining` that ticked
   * here re-rendered the whole live workout every second of every rest
   * (Train re-score, performance).
   */
  endsAt: number | null;
  /** Seconds left right now, read off the clock — for event handlers (the
   *  ±30 s buttons). 0 when idle. */
  remainingNow: () => number;
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

export interface RestTimerOptions {
  /**
   * A rest RAN OUT (never called for a stop, a skip or a replace). `late` is
   * true when the deadline passed more than {@link LATE_END_MS} before the app
   * saw it — the phone was locked or the app was in the background — and the
   * caller should then stay quiet: the notification already said it, and a
   * "Rest over" spoken a minute after the fact is noise.
   */
  onElapsed?: (info: { late: boolean }) => void;
}

/** How far past its deadline a rest may be noticed and still buzz. */
export const LATE_END_MS = 2000;

export function formatMMSS(s: number): string {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

/** Whole seconds from `now` to `endsAt`, never negative. */
const secondsLeft = (endsAt: number | null, now: number) =>
  endsAt == null ? 0 : Math.max(0, Math.ceil((endsAt - now) / 1000));

export { REST_DONE_ID_PREFIX } from '@/lib/rest-notification-id';
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
    await cancelStaleRestNotifications();
    return await Notifications.scheduleNotificationAsync({
      identifier: `${REST_DONE_ID_PREFIX}${at.getTime()}.${++restDoneSeq}`,
      content: {
        title: t('train.restDoneTitle' as I18nKey),
        body: t('train.restDoneBody' as I18nKey),
        // Through a gym Focus mode, which is where this buzz is wanted most.
        // Honoured only once the binary carries the time-sensitive
        // entitlement (`com.apple.developer.usernotifications.time-sensitive`);
        // without it iOS delivers at the default level, so this line is safe
        // on every binary an OTA can reach. Ignored on Android.
        interruptionLevel: 'timeSensitive',
      },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
    });
  } catch {
    // A notification that fails to schedule is a lost buzz, not a lost set.
    return null;
  }
}

/**
 * Cancel EVERY pending rest notification, whoever scheduled it.
 *
 * The hook cancels by the id it remembers, and there are two ways to lose that
 * id while the request is still pending: the Lock Screen's "+30 s" moves the
 * request natively (same id) after the in-app tick has already forgotten it,
 * and a JS restart forgets everything. Either way the next rest scheduled a
 * second request beside the first and the phone buzzed "rest over" twice
 * (Train re-score bug 4). One rest is ever running, so anything carrying the
 * prefix when a new one is scheduled is stale by definition.
 *
 * Exported for the test. Swallows its own failures: a sweep that cannot list
 * is no worse than the per-id cancel it backs up.
 */
export async function cancelStaleRestNotifications(): Promise<void> {
  try {
    const pending = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      pending
        .filter((n) => n.identifier.startsWith(REST_DONE_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => {})),
    );
  } catch {
    // Not listable here (an older binary, a test double): the per-id cancel
    // still runs.
  }
}

/**
 * Between-sets rest countdown. Mirrors the PWA rest-timer state machine
 * (start replaces, never stacks; auto-stops at 0; idempotent stop). Local
 * only — no Firestore. A single interval watches for the deadline once a
 * second; it sets state only when the rest runs out.
 *
 * The deadline also schedules a LOCAL notification (when permission is already
 * granted), because the in-app haptic only fires if the JS timer is running —
 * and a lifter who locked the phone or switched to music gets no timer tick
 * until they come back. Start schedules, stop/replace/unmount cancel.
 */
export function useRestTimer(opts: RestTimerOptions = {}): RestTimer {
  const t = useT();
  /** When the rest ends, epoch ms — the one piece of render state. The
   *  interval only CHECKS it; it never counts. JS timers are suspended while
   *  the screen is locked, and a lifter locks the phone between sets: a
   *  tick-counting timer that slept 60 s of a 90 s rest woke up still showing
   *  ~90 s, and buzzed a minute late. */
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const handle = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Mirror of `endsAt` for the interval and the handlers. */
  const deadline = useRef<number | null>(null);
  /** The scheduled notification for the current countdown, once known. */
  const notifId = useRef<string | null>(null);
  /** Bumped on every start/stop so a schedule that resolves AFTER the
   *  countdown it belonged to was cancelled is itself cancelled, not kept. */
  const generation = useRef(0);
  /** Read through a ref so the interval set up by `start` calls the latest. */
  const onElapsed = useRef(opts.onElapsed);
  useEffect(() => {
    onElapsed.current = opts.onElapsed;
  });

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
    setEndsAt(null);
  }, [cancelNotification]);

  const start = useCallback(
    (seconds: number) => {
      if (handle.current) clearInterval(handle.current);
      cancelNotification();
      if (!(seconds > 0)) {
        handle.current = null;
        deadline.current = null;
        setEndsAt(null);
        return;
      }
      const secs = Math.round(seconds);
      const end = Date.now() + secs * 1000;
      deadline.current = end;
      setEndsAt(end);

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
        const at = deadline.current;
        const now = Date.now();
        if (secondsLeft(at, now) > 0) return;
        if (handle.current) clearInterval(handle.current);
        handle.current = null;
        deadline.current = null;
        // The notification has fired (or is about to) by now; the app is in
        // the foreground for this tick to run, so the buzz is the signal.
        // Forget the id rather than cancel — cancelling a delivered
        // notification is a no-op, and the JS tick can land a beat early.
        // (A request the Lock Screen moved later is swept by the next start;
        // see `cancelStaleRestNotifications`.)
        notifId.current = null;
        // Buzz on natural completion (time to lift) — skip/stop stays silent.
        // Not when it ran out while the phone was locked: the lifter is
        // looking at the screen because they came back, and a buzz a minute
        // late reads as a second, wrong "rest over" (Train re-score bug 8).
        const late = at != null && now - at > LATE_END_MS;
        if (!late) haptics.success();
        setEndsAt(null);
        onElapsed.current?.({ late });
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

  const remainingNow = useCallback(() => secondsLeft(deadline.current, Date.now()), []);

  // Clear the interval — and the pending notification — if the component
  // unmounts mid-countdown (the workout was finished or discarded).
  useEffect(() => () => {
    if (handle.current) clearInterval(handle.current);
    cancelNotification();
  }, [cancelNotification]);

  return { endsAt, remainingNow, start, stop, rearm };
}

/**
 * The per-second face of a rest: seconds left and the `m:ss` label, for the
 * component that DRAWS the countdown (the rest bar, the pill). Its own state
 * and its own interval, so the tick re-renders that one component — the same
 * split `ElapsedClock` makes for the session's elapsed time.
 *
 * Re-reads the clock as soon as `endsAt` moves (a ±30 s, a replace), so the
 * label does not wait a whole tick to catch up with a retarget.
 */
export function useRestCountdown(endsAt: number | null): { remaining: number; label: string } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (endsAt == null) return;
    const tick = () => setNow(Date.now());
    // The first read is a macrotask, not the effect body: a synchronous
    // setState here would render twice per retarget for nothing.
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [endsAt]);
  const remaining = secondsLeft(endsAt, now);
  return { remaining, label: formatMMSS(remaining) };
}
