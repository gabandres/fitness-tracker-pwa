import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  planReminders,
  planTapeReminder,
  resolveMealReminders,
  type MealReminderSettings,
  type ReminderPlan,
  type TapeReminderSetting,
} from '@macrolog/core';
import type { I18nKey, TFn } from '@/i18n';
import { track } from './analytics';
import { REST_DONE_ID_PREFIX } from '@/lib/rest-notification-id';

// Local, on-device smart reminders. The *decision* of what to schedule lives in
// the shared core `planReminders` (meal windows + streak-at-risk + weigh-in);
// this adapter is the dumb expo-notifications layer that cancels everything and
// (re)schedules exactly what the planner returns. Scheduled LOCAL notifications
// work in Expo Go (only REMOTE push needs a dev build + FCM token — that's the
// server CF path). State lives in AsyncStorage because it's per-device.

const ENABLED_KEY = 'reminder.enabled';
/** Legacy single-hour key (shipped in 1.0). Read once to migrate, never written
 *  again — see {@link getReminderSettings}. */
const HOUR_KEY = 'reminder.hour';
const MEALS_KEY = 'reminder.meals';

export interface ReminderState {
  enabled: boolean;
  meals: MealReminderSettings;
}

/** Live signals the smart planner needs, gathered by `useReminderSync`. */
export interface ReminderLiveState {
  loggedToday: boolean;
  streak: number;
  daysSinceWeighIn: number | null;
  /** Whole days since the newest food log; null when none in the window. */
  daysSinceLastLog: number | null;
  /** Holding weight rather than moving it — the quieter plan (core
   *  `planReminders`, `maintaining`). Optional: the Settings permission probe
   *  passes a stub state and has no profile to read it from. */
  maintaining?: boolean;
  /** The weekly tape reminder's live gate (ADR-0043). Absent → the last gate
   *  a sync passed, see {@link TapeGate}. */
  tape?: TapeGate;
}

/**
 * Whether the weekly tape reminder may fire, and for which body, from LIVE
 * state rather than from what was stored when it was turned on.
 * - `allowed`: `FEATURES.compositionMaintenance` for this user. False cancels
 *   the notification but KEEPS the setting — the switch lives on a card that
 *   disappears with the flag, so a rollback must silence it and a re-enable
 *   must bring it back without asking again.
 * - `female`: names the hip from the profile as it is now.
 */
export interface TapeGate {
  allowed: boolean;
  female: boolean;
}

const isNative = Platform.OS !== 'web';

// Present the reminder as a banner even with the app foregrounded.
if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async (notification) => {
      // The rest-over buzz is for a phone in a pocket. With Ignia open, the
      // rest bar already says it and plays its own haptic; a banner on top
      // was the same news twice (Train re-score bug 8).
      const restDone = notification.request.identifier.startsWith(REST_DONE_ID_PREFIX);
      return {
        shouldShowBanner: !restDone,
        shouldShowList: !restDone,
        shouldPlaySound: false,
        shouldSetBadge: false,
      };
    },
  });
}

/**
 * Read the master switch plus the per-meal schedule. The 1.0 → per-meal
 * upgrade decision is pure and lives in core `resolveMealReminders` (tested
 * there); this only fetches the two raw stored values.
 */
export async function getReminderSettings(): Promise<ReminderState> {
  const [enabled, mealsRaw, legacyHour] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY),
    AsyncStorage.getItem(MEALS_KEY),
    AsyncStorage.getItem(HOUR_KEY),
  ]);

  return {
    enabled: enabled === '1',
    meals: resolveMealReminders(mealsRaw, legacyHour == null ? null : Number(legacyHour)),
  };
}

/** Persist the per-meal schedule. Does NOT schedule — the caller follows with
 *  `syncReminders(...)`, which needs live streak/weigh-in state. */
export async function setMealReminders(meals: MealReminderSettings): Promise<void> {
  await AsyncStorage.setItem(MEALS_KEY, JSON.stringify(meals));
}

/**
 * Flip the master switch. Enabling requests permission first; if denied,
 * returns false and stays off. Disabling clears every scheduled nudge EXCEPT
 * the weekly tape reminder, which is its own opt-in (ADR-0043).
 * Does NOT itself schedule — see {@link setMealReminders}.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');

  if (!isNative) return enabled;

  if (!enabled) {
    try {
      await enqueue(
        async () => {
          const scheduled = await Notifications.getAllScheduledNotificationsAsync();
          await Promise.all(
            scheduled
              .filter((n) => n.identifier !== TAPE_NOTIFICATION_ID)
              .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)),
          );
        },
        { rethrow: true },
      );
    } catch (e) {
      // The nudges are still scheduled, so the switch must still say so —
      // put the flag back and let the caller keep it on.
      await AsyncStorage.setItem(ENABLED_KEY, '1');
      throw e;
    }
    return false;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    return false;
  }
  // Counted HERE, after the OS said yes, and nowhere else: this is the one
  // line both the onboarding step and the Settings switch pass through, and
  // it is the only point where "reminders are on" is actually true. Every
  // notification-shaped retention lever reaches exactly the users who hit
  // this line — `config/retention` could not see how many until 2026-09-10.
  track('reminders_on');
  return true;
}

/**
 * Ask the OS for notification permission and answer whether it is granted.
 *
 * The one prompt helper for surfaces OTHER than the reminders switch (which
 * keeps its own inline call because it also flips the stored flag): the
 * rest-timer priming sheet on Train reuses this so the app has exactly one
 * spelling of "request, then read `status`". Never throws — a bridge error
 * reads as "not granted", which is the only honest fallback.
 */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { status } = await Notifications.requestPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

/**
 * Cancel and reschedule the full smart plan from core `planReminders`. Called
 * on Today focus, after every log, and after a settings change. No-op on web or
 * when reminders are disabled. The meal windows come straight from the user's
 * saved per-meal schedule — this adapter makes no scheduling decisions of its
 * own; that is entirely `planReminders`' job.
 */
export function syncReminders(state: ReminderLiveState, t: TFn): Promise<void> {
  if (!isNative) return Promise.resolve();
  // Serialised. `useReminderSync` recomputes once per snapshot, and on a
  // cold start the logs and weights snapshots land a beat apart, so two syncs
  // used to interleave: cancel, cancel, schedule, schedule — and every nudge
  // fired TWICE. Measured on the LG VS988 (2026-09-02): four alarms for a
  // two-item plan after one launch. A chain makes the last caller's plan the
  // one that survives, and a failed sync never blocks the next.
  return enqueue(() => syncOnce(state, t));
}

let syncQueue: Promise<void> = Promise.resolve();

/** Every cancel/schedule goes through this one chain — the sync, the master
 *  switch and the tape toggle — so none of them can undo another mid-flight.
 *  A failure never blocks the chain; `rethrow` hands it to a caller that has
 *  a switch to keep honest, everyone else gets it swallowed. */
function enqueue(work: () => Promise<void>, { rethrow = false } = {}): Promise<void> {
  const run = syncQueue.then(work);
  syncQueue = run.catch(() => undefined);
  return rethrow ? run : run.catch(() => undefined);
}

async function syncOnce(state: ReminderLiveState, t: TFn): Promise<void> {
  const { enabled, meals } = await getReminderSettings();

  await Notifications.cancelAllScheduledNotificationsAsync();
  // The weekly tape reminder is its own opt-in (Trends recomp card), so it is
  // re-armed BEFORE the master-switch return: cancel-all just took it too.
  // Isolated: a failure here must never cost the user their meal reminders.
  if (state.tape) tapeGate = state.tape;
  await scheduleTapeReminder(t).catch(() => undefined);
  if (!enabled) return;

  const plans = planReminders({
    now: new Date(),
    meals,
    loggedToday: state.loggedToday,
    streak: state.streak,
    daysSinceWeighIn: state.daysSinceWeighIn,
    daysSinceLastLog: state.daysSinceLastLog,
    maintaining: state.maintaining,
  });

  await Promise.all(plans.map((plan) => scheduleOne(plan, t)));
}

function scheduleOne(plan: ReminderPlan, t: TFn): Promise<string> {
  const title = t(plan.titleKey as I18nKey);
  const body =
    plan.kind === 'daily'
      ? t(plan.bodyKey as I18nKey)
      : t(plan.bodyKey as I18nKey, plan.bodyParams);

  const trigger: Notifications.NotificationTriggerInput =
    plan.kind === 'daily'
      ? {
          type: Notifications.SchedulableTriggerInputTypes.DAILY,
          hour: plan.hour,
          minute: plan.minute,
        }
      : { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.fireAt };

  return Notifications.scheduleNotificationAsync({ content: { title, body }, trigger });
}

// ─── Weekly tape reminder (ADR-0043) ────────────────────────────

const TAPE_KEY = 'reminder.tape';
/** Fixed identifier: scheduling again under it REPLACES, so turning the
 *  reminder on twice never fires twice. */
const TAPE_NOTIFICATION_ID = 'tape-weekly';

/** The last {@link TapeGate} a sync passed (Today's `useReminderSync`), so a
 *  sync without one — Settings' — cannot re-arm what the flag turned off.
 *  Undefined until the first gated sync, and again after sign-out: the stored
 *  setting is then armed as stored, the behaviour before the gate existed. */
let tapeGate: TapeGate | undefined;

export async function getTapeReminder(): Promise<TapeReminderSetting | null> {
  try {
    const raw = await AsyncStorage.getItem(TAPE_KEY);
    return raw ? (JSON.parse(raw) as TapeReminderSetting) : null;
  } catch {
    return null;
  }
}

/**
 * Turn the weekly tape reminder on (with its schedule) or off. Asks for
 * notification permission when turning it on: `'denied'` stores nothing.
 * `'failed'` when storing or scheduling threw — the switch must not claim a
 * reminder the OS does not hold.
 */
export async function setTapeReminder(
  setting: TapeReminderSetting | null,
  t: TFn,
): Promise<'ok' | 'denied' | 'failed'> {
  if (setting && isNative && !(await requestNotificationPermission())) return 'denied';
  // Only the Trends card turns it on, and only while the flag is on there.
  if (setting) tapeGate = { allowed: true, female: setting.hip === true };
  try {
    await enqueue(
      async () => {
        if (setting) await AsyncStorage.setItem(TAPE_KEY, JSON.stringify(setting));
        else await AsyncStorage.removeItem(TAPE_KEY);
        await scheduleTapeReminder(t);
      },
      { rethrow: true },
    );
    return 'ok';
  } catch {
    return 'failed';
  }
}

/**
 * Forget and cancel the tape reminder — on sign-out. It is stored per device
 * but belongs to the account (and to a flag the next account may not have),
 * so it must not keep firing for whoever signs in next. Never throws.
 */
export function clearTapeReminder(): Promise<void> {
  tapeGate = undefined;
  return enqueue(async () => {
    await AsyncStorage.removeItem(TAPE_KEY);
    if (isNative) await Notifications.cancelScheduledNotificationAsync(TAPE_NOTIFICATION_ID);
  });
}

// `async`, so even a synchronous throw inside becomes a rejection the caller's
// `.catch` can isolate.
async function scheduleTapeReminder(t: TFn): Promise<void> {
  if (!isNative) return;
  const stored = await getTapeReminder();
  const plan =
    tapeGate?.allowed === false ? null : planTapeReminder(stored && tapeGate ? { ...stored, hip: tapeGate.female } : stored);
  if (!plan) {
    await Notifications.cancelScheduledNotificationAsync(TAPE_NOTIFICATION_ID).catch(() => undefined);
    return;
  }
  await Notifications.scheduleNotificationAsync({
    identifier: TAPE_NOTIFICATION_ID,
    content: { title: t(plan.titleKey as I18nKey), body: t(plan.bodyKey as I18nKey) },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: plan.weekday,
      hour: plan.hour,
      minute: plan.minute,
    },
  });
}
