import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

// Local daily "log your meals" reminder. Entirely on-device — scheduled
// local notifications work in Expo Go (only REMOTE push needs a dev build +
// FCM token, which is the server-gated path the CF sendDailyReminders covers
// separately). State lives in AsyncStorage because the schedule is per-device.

const ENABLED_KEY = 'reminder.enabled';
const HOUR_KEY = 'reminder.hour';
export const DEFAULT_REMINDER_HOUR = 20; // 8 PM

export interface ReminderState {
  enabled: boolean;
  hour: number; // 0–23
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
 * Persist + (re)schedule the daily reminder. Enabling requests permission
 * first; if denied, returns false and stays off. Always clears any prior
 * schedule so the hour can be changed idempotently. No-op (returns the
 * requested enabled flag) on web, where local scheduling isn't supported.
 */
export async function setReminder(enabled: boolean, hour: number): Promise<boolean> {
  await AsyncStorage.multiSet([
    [HOUR_KEY, String(hour)],
    [ENABLED_KEY, enabled ? '1' : '0'],
  ]);

  if (!isNative) return enabled;

  await Notifications.cancelAllScheduledNotificationsAsync();
  if (!enabled) return false;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    await AsyncStorage.setItem(ENABLED_KEY, '0');
    return false;
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Ignia',
      body: "Don't forget to log today's meals.",
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour,
      minute: 0,
    },
  });
  return true;
}
