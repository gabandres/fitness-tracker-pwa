/**
 * Retention nudge planner (ADR-0015, grilled 2026-07-04). Pure decision logic:
 * given the clock, the user's meal-reminder settings, whether they've logged
 * today, and their streak, it returns the exact set of local notifications that
 * should be scheduled right now. The `expo-notifications` layer is a dumb
 * adapter that cancels everything and schedules whatever this returns — so all
 * the behavior lives here and is unit-tested without a device.
 *
 * The split (why two `kind`s): a repeating OS notification can't be made
 * conditional, so meal-window nudges are **daily-repeating** and tail-timed
 * (they fire even for a lapsed user who never opens the app; the late time
 * makes "did you log?" rarely fire after you already did). The streak-at-risk
 * nudge is the **smart** one — a one-shot for *today* that's simply omitted
 * (i.e. the adapter cancels it) once you've logged, so it never nags you after
 * you've saved your streak.
 */

export type MealKey = 'breakfast' | 'lunch' | 'dinner';

export interface MealReminder {
  enabled: boolean;
  /** Local wall-clock fire time (already tail-timed for its window). */
  hour: number;
  minute: number;
}

export type MealReminderSettings = Record<MealKey, MealReminder>;

/** Grilled defaults: breakfast off (habitual), lunch + dinner on, tail-timed
 *  so the nudge lands after you'd normally have logged that meal. */
export const DEFAULT_MEAL_REMINDERS: MealReminderSettings = {
  breakfast: { enabled: false, hour: 9, minute: 30 },
  lunch: { enabled: true, hour: 13, minute: 30 },
  dinner: { enabled: true, hour: 20, minute: 0 },
};

/** Streak-at-risk fires at 8:30pm, only for a streak worth protecting. */
export const STREAK_RISK_HOUR = 20;
export const STREAK_RISK_MINUTE = 30;
export const STREAK_RISK_MIN_STREAK = 3;

export const MEAL_TITLE_KEY = 'reminder.mealTitle';
export const MEAL_BODY_KEY: Record<MealKey, string> = {
  breakfast: 'reminder.breakfastBody',
  lunch: 'reminder.lunchBody',
  dinner: 'reminder.dinnerBody',
};
export const STREAK_TITLE_KEY = 'reminder.streakTitle';
export const STREAK_BODY_KEY = 'reminder.streakBody';

/** Weigh-in nudge: a smart, data-driven reminder to step on the scale when it's
 *  been a while. Keeps measured-mode TDEE + the recalibration digest reliable
 *  (both need recent weigh-ins) — the retention loop that ties back to Adaptive
 *  TDEE. Fires in the morning, one-shot for today, only when overdue. */
export const WEIGH_IN_HOUR = 8;
export const WEIGH_IN_MINUTE = 0;
export const WEIGH_IN_MIN_DAYS = 7;
export const WEIGH_IN_TITLE_KEY = 'reminder.weighInTitle';
export const WEIGH_IN_BODY_KEY = 'reminder.weighInBody';

export type ReminderPlan =
  | {
      id: `meal-${MealKey}`;
      kind: 'daily';
      hour: number;
      minute: number;
      titleKey: string;
      bodyKey: string;
    }
  | {
      id: 'streak-risk';
      kind: 'date';
      /** Absolute local time to fire once. */
      fireAt: Date;
      titleKey: string;
      bodyKey: string;
      /** Interpolation for the body copy ("your 6-day streak…"). */
      bodyParams: { n: number };
    }
  | {
      id: 'weigh-in';
      kind: 'date';
      /** Absolute local time to fire once. */
      fireAt: Date;
      titleKey: string;
      bodyKey: string;
      /** Interpolation for the body copy ("it's been 9 days…"). */
      bodyParams: { n: number };
    };

export interface ReminderInput {
  now: Date;
  meals: MealReminderSettings;
  /** Has the user logged anything today? (Streak survives on any log.) */
  loggedToday: boolean;
  /** Current consecutive-day logging streak. */
  streak: number;
  /** Whole days since the last recorded weigh-in, or null when never weighed /
   *  unknown. Drives the smart weigh-in nudge; omit to disable it. */
  daysSinceWeighIn?: number | null;
}

const MEAL_ORDER: MealKey[] = ['breakfast', 'lunch', 'dinner'];

/**
 * The full set of notifications that should be scheduled given the current
 * state. Call on app-foreground and after every log; the adapter cancels all
 * previously-scheduled nudges and (re)schedules exactly this list.
 */
export function planReminders(
  { now, meals, loggedToday, streak, daysSinceWeighIn }: ReminderInput,
): ReminderPlan[] {
  const plans: ReminderPlan[] = [];

  for (const key of MEAL_ORDER) {
    const m = meals[key];
    if (m?.enabled) {
      plans.push({
        id: `meal-${key}`,
        kind: 'daily',
        hour: m.hour,
        minute: m.minute,
        titleKey: MEAL_TITLE_KEY,
        bodyKey: MEAL_BODY_KEY[key],
      });
    }
  }

  // Streak-at-risk: only when there's a streak worth protecting, today is still
  // unlogged, and tonight's fire time hasn't already passed (can't schedule the
  // past — tomorrow's app-open will re-arm it).
  if (streak >= STREAK_RISK_MIN_STREAK && !loggedToday) {
    const fireAt = atToday(now, STREAK_RISK_HOUR, STREAK_RISK_MINUTE);
    if (fireAt.getTime() > now.getTime()) {
      plans.push({
        id: 'streak-risk',
        kind: 'date',
        fireAt,
        titleKey: STREAK_TITLE_KEY,
        bodyKey: STREAK_BODY_KEY,
        bodyParams: { n: streak },
      });
    }
  }

  // Weigh-in nudge: overdue by WEIGH_IN_MIN_DAYS+ and this morning's slot hasn't
  // passed. Re-armed each app-open, so a missed morning simply rolls to the next.
  if (daysSinceWeighIn != null && daysSinceWeighIn >= WEIGH_IN_MIN_DAYS) {
    const fireAt = atToday(now, WEIGH_IN_HOUR, WEIGH_IN_MINUTE);
    if (fireAt.getTime() > now.getTime()) {
      plans.push({
        id: 'weigh-in',
        kind: 'date',
        fireAt,
        titleKey: WEIGH_IN_TITLE_KEY,
        bodyKey: WEIGH_IN_BODY_KEY,
        bodyParams: { n: daysSinceWeighIn },
      });
    }
  }

  return plans;
}

/** A Date at today's (local) hour:minute, derived from `now`. */
function atToday(now: Date, hour: number, minute: number): Date {
  const d = new Date(now);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Fallback evening hour when a device has no stored preference at all. */
export const DEFAULT_REMINDER_HOUR = 20;

function isMealSettings(x: unknown): x is MealReminderSettings {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return MEAL_ORDER.every((k) => {
    const m = o[k] as Record<string, unknown> | undefined;
    return (
      typeof m === 'object' &&
      m !== null &&
      typeof m['enabled'] === 'boolean' &&
      typeof m['hour'] === 'number' &&
      Number.isFinite(m['hour']) &&
      typeof m['minute'] === 'number' &&
      Number.isFinite(m['minute'])
    );
  });
}

/**
 * Decide the per-meal schedule from what a device has on disk. Pure, so the
 * upgrade path is testable without a device — the frontend adapter just hands
 * over the two raw stored values.
 *
 * **Why the legacy branch matters.** 1.0 stored a single `reminder.hour` and
 * the adapter pinned it to dinner while silently applying
 * {@link DEFAULT_MEAL_REMINDERS} for breakfast and lunch. So an upgrading user
 * is *already* receiving a 1:30pm lunch nudge that had no off switch in the UI.
 * Reconstructing that exact schedule — rather than resetting to defaults —
 * means nobody's notifications change on upgrade; what changes is that all
 * three windows become visible and editable.
 *
 * @param storedJson  the saved per-meal blob, or null before the first save
 * @param legacyHour  the 1.0 single-hour value, or null if never set
 */
export function resolveMealReminders(
  storedJson: string | null | undefined,
  legacyHour: number | null | undefined,
): MealReminderSettings {
  if (storedJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(storedJson);
    } catch {
      parsed = null;
    }
    // A corrupt blob falls back to defaults rather than throwing — losing a
    // custom reminder time is recoverable; a settings screen that crashes on
    // open is not.
    if (isMealSettings(parsed)) return parsed;
    return DEFAULT_MEAL_REMINDERS;
  }

  const hour =
    typeof legacyHour === 'number' && Number.isFinite(legacyHour) && legacyHour >= 0 && legacyHour <= 23
      ? legacyHour
      : DEFAULT_REMINDER_HOUR;
  return { ...DEFAULT_MEAL_REMINDERS, dinner: { enabled: true, hour, minute: 0 } };
}
