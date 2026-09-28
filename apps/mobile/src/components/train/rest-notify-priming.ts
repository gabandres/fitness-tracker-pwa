import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

/**
 * Rest-timer notification priming (UX_AUDIT S18-10, the native half).
 *
 * `useRestTimer` schedules a "rest over" local notification at the deadline,
 * but only when permission is ALREADY granted — it never asks, because a
 * system prompt between sets is the wrong moment. Nothing else asked either,
 * so a user who skipped the reminders opt-in never got the buzz. This is the
 * one place that asks, and it asks ONCE: a short themed sheet the first time a
 * rest starts, explaining the why before the OS dialog appears.
 *
 * The decision is a pure predicate over two facts (was the sheet shown; what
 * the OS says) so it can be tested without a device; the two async wrappers
 * below are the only I/O.
 */
export const REST_NOTIFY_PRIMED_KEY = 'train.restNotify.primed';

export interface RestNotifyPrimingInput {
  /** The sheet was already shown on this device, whichever way it was answered. */
  seen: boolean;
  /** `Notifications.getPermissionsAsync().status` — 'granted' | 'denied' | 'undetermined'. */
  status: string;
}

/**
 * Show the priming sheet?
 *
 * - shown before → never again, regardless of the answer (Not now is a
 *   decision, and re-asking would punish it);
 * - already granted → nothing to ask, the timer schedules on its own;
 * - denied at the OS level → the system dialog cannot be shown again anyway,
 *   and a sheet whose Allow does nothing is worse than no sheet (a deep-link
 *   to Settings is deliberately out of scope here);
 * - undetermined and never shown → yes, once.
 */
export function shouldPrimeRestNotify({ seen, status }: RestNotifyPrimingInput): boolean {
  if (seen) return false;
  return status === 'undetermined';
}

/** Was the sheet already shown? `false` on a storage error — a lost flag must
 *  cost one extra sheet, never a crash. */
export async function loadRestNotifyPrimed(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(REST_NOTIFY_PRIMED_KEY)) === '1';
  } catch {
    return false;
  }
}

/** Record that the sheet was shown. Called on Allow AND on Not now. */
export async function markRestNotifyPrimed(): Promise<void> {
  try {
    await AsyncStorage.setItem(REST_NOTIFY_PRIMED_KEY, '1');
  } catch {
    // Storage unavailable: the sheet may show once more next launch. A
    // nuisance, not a fault.
  }
}

/**
 * Gather the two facts and decide. Resolves `false` on web (no local
 * notifications) and on any bridge error — a failed read must not surface a
 * sheet whose Allow cannot work.
 */
export async function decideRestNotifyPriming(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const [seen, perm] = await Promise.all([loadRestNotifyPrimed(), Notifications.getPermissionsAsync()]);
    return shouldPrimeRestNotify({ seen, status: perm.status });
  } catch {
    return false;
  }
}
