import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import {
  DEFAULT_MEAL_REMINDERS,
  planReminders,
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
const HOUR_KEY = 'reminder.hour';
export const DEFAULT_REMINDER_HOUR = 20; // 8 PM — the primary evening nudge.

export interface ReminderState {
  enabled: boolean;
  hour: number; // 0–23
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

export async function getReminder(): Promise<ReminderState> {
  const [enabled, hour] = await Promise.all([
    AsyncStorage.getItem(ENABLED_KEY),
    AsyncStorage.getItem(HOUR_KEY),
  ]);
  return {
    enabled: enabled === '1',
    hour: hour != null ? Number(hour) : DEFAULT_REMINDER_HOUR,
  };
}

/**
 * Persist the reminder preferences. Enabling requests permission first; if
 * denied, returns false and stays off. Disabling clears every scheduled nudge.
 * Does NOT itself schedule — the caller follows a successful enable / hour
 * change with `syncReminders(...)` (scheduling needs live streak/weigh-in
 * state, which only the app screens have).
 */
export async function setReminder(enabled: boolean, hour: number): Promise<boolean> {
  await AsyncStorage.multiSet([
    [HOUR_KEY, String(hour)],
    [ENABLED_KEY, enabled ? '1' : '0'],
  ]);

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
 * when reminders are disabled. Meal windows use the grilled defaults with the
 * dinner nudge pinned to the user's configured hour.
 */
export async function syncReminders(state: ReminderLiveState, t: TFn): Promise<void> {
  if (!isNative) return;
  const { enabled, hour } = await getReminder();

  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!enabled) return;

  const meals: MealReminderSettings = {
    ...DEFAULT_MEAL_REMINDERS,
    dinner: { enabled: true, hour, minute: 0 },
  };
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
