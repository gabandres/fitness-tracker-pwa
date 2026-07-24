import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  planReminders,
  resolveMealReminders,
  type MealReminderSettings,
  type ReminderPlan,
} from '@macrolog/core';
import type { I18nKey, TFn } from '@/i18n';

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
}

const isNative = Platform.OS !== 'web';

// Present the reminder as a banner even with the app foregrounded.
if (isNative) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
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
 * returns false and stays off. Disabling clears every scheduled nudge.
 * Does NOT itself schedule — see {@link setMealReminders}.
 */
export async function setRemindersEnabled(enabled: boolean): Promise<boolean> {
  await AsyncStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');

  if (!isNative) return enabled;

  if (!enabled) {
    await Notifications.cancelAllScheduledNotificationsAsync();
    return false;
  }

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    return false;
  }
  return true;
}

/**
 * Cancel and reschedule the full smart plan from core `planReminders`. Called
 * on Today focus, after every log, and after a settings change. No-op on web or
 * when reminders are disabled. The meal windows come straight from the user's
 * saved per-meal schedule — this adapter makes no scheduling decisions of its
 * own; that is entirely `planReminders`' job.
 */
export async function syncReminders(state: ReminderLiveState, t: TFn): Promise<void> {
  if (!isNative) return;
  const { enabled, meals } = await getReminderSettings();

  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!enabled) return;

  const plans = planReminders({
    now: new Date(),
    meals,
    loggedToday: state.loggedToday,
    streak: state.streak,
    daysSinceWeighIn: state.daysSinceWeighIn,
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
