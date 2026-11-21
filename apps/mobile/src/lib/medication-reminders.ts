/**
 * Dose-day reminders (2026-11-20): the expo-notifications half of the
 * medication log. Core `planMedicationReminders` decides WHEN; this hands the
 * OS those moments and takes back the ones that no longer apply.
 *
 * Its own module, imported BY `reminders.ts` and not the other way round:
 * `reminders.ts` cancels every scheduled notification on each sync and must
 * put these back (`rearmMedicationReminders`), and nine test files fake
 * `@/lib/reminders` with only the functions they use.
 *
 * The words on a lock screen name no medication and no dose. What someone
 * takes is theirs to show, not a notification's.
 *
 * Never throws: a reminder that cannot be scheduled must not fail a save, a
 * sign-out or the meal-reminder sync.
 */
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { MEDICATION_REMINDER_ID_PREFIX, type MedicationLog, medicationDayOf, planMedicationReminders } from '@macrolog/core';
import type { TFn } from '@/i18n';

const isNative = Platform.OS !== 'web';

/** The log the medication store last published, or null when nobody is
 *  signed in. Held so a re-arm needs neither storage nor a uid. */
let held: MedicationLog | null = null;
let words: { title: string; body: string } | null = null;

let queue: Promise<void> = Promise.resolve();
function enqueue(work: () => Promise<void>): Promise<void> {
  queue = queue.then(work).catch(() => undefined);
  return queue;
}

async function apply(now: Date): Promise<void> {
  if (!isNative) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      (scheduled ?? [])
        .filter((n) => n.identifier.startsWith(MEDICATION_REMINDER_ID_PREFIX))
        .map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier).catch(() => undefined)),
    );
    if (held && words) {
      for (const plan of planMedicationReminders(held, now)) {
        await Notifications.scheduleNotificationAsync({
          identifier: plan.id,
          content: words,
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: plan.at },
        });
      }
    }
  } catch {
    // The bridge refused: the log is still saved, only the reminder is missing.
  }
  await dismissAnswered();
}

/**
 * Take a DELIVERED dose-day notification out of the shade once it has been
 * answered: its dose is logged, its medication is gone, or nobody is signed
 * in. Seen on the OnePlus 8T (2026-11-20): "Dose day" stayed up after the dose
 * was logged, and after sign-out — where it would have been the next person's
 * to read. Its own `try`: an older binary without these calls must not cost
 * the scheduling above.
 */
async function dismissAnswered(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    const log = held;
    const answered = (identifier: string): boolean => {
      if (!identifier.startsWith(MEDICATION_REMINDER_ID_PREFIX)) return false;
      if (!log) return true;
      // `medication.<id>.<YYYY-MM-DD>`
      const rest = identifier.slice(MEDICATION_REMINDER_ID_PREFIX.length);
      const medicationId = rest.slice(0, -11);
      const day = rest.slice(-10);
      if (!log.medications.some((m) => m.id === medicationId)) return true;
      return log.doses.some((d) => d.medicationId === medicationId && medicationDayOf(d.takenAt) >= day);
    };
    await Promise.all(
      (shown ?? [])
        .filter((n) => answered(n.request.identifier))
        .map((n) => Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined)),
    );
  } catch {
    // Not available here: the notification stays until it is swiped away.
  }
}

/**
 * Hand the OS the next dose-day reminders for this log, replacing the last
 * set. Called by the medication store on every load and change. A medication
 * with a reminder time needs notification permission; the screen asks for it
 * when the time is set.
 */
export function setMedicationReminders(log: MedicationLog | null, t: TFn): Promise<void> {
  held = log;
  words = { title: t('medication.reminderTitle'), body: t('medication.reminderBody') };
  return enqueue(() => apply(new Date()));
}

/** Cancel every dose-day reminder — on sign-out, so none fires for whoever
 *  uses the phone next. */
export function clearMedicationReminders(): Promise<void> {
  held = null;
  return enqueue(() => apply(new Date()));
}

/** Put the reminders back after `reminders.ts` cancelled everything. Runs
 *  inside that module's own chain, so it is awaited there, not queued here. */
export function rearmMedicationReminders(now: Date): Promise<void> {
  return apply(now);
}
