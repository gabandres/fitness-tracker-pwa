import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEAL_REMINDERS,
  DEFAULT_REMINDER_HOUR,
  planReminders,
  resolveMealReminders,
  type MealReminderSettings,
  type ReminderPlan,
} from './reminder-plan';

// A fixed local afternoon so "now" is deterministic (well before 8:30pm).
const noon = () => new Date(2026, 6, 4, 12, 0, 0);
const ids = (plans: ReminderPlan[]) => plans.map((p) => p.id).sort();

describe('planReminders — meal windows', () => {
  it('schedules only the enabled windows as daily nudges', () => {
    const plans = planReminders({ now: noon(), meals: DEFAULT_MEAL_REMINDERS, loggedToday: true, streak: 0 });
    // defaults: lunch + dinner on, breakfast off; streak 0 → no streak nudge.
    expect(ids(plans)).toEqual(['meal-dinner', 'meal-lunch']);
    expect(plans.every((p) => p.kind === 'daily')).toBe(true);
  });

  it('honors per-window enable/disable', () => {
    const meals: MealReminderSettings = {
      breakfast: { enabled: true, hour: 9, minute: 30 },
      lunch: { enabled: false, hour: 13, minute: 30 },
      dinner: { enabled: false, hour: 20, minute: 0 },
    };
    const plans = planReminders({ now: noon(), meals, loggedToday: true, streak: 0 });
    expect(ids(plans)).toEqual(['meal-breakfast']);
  });
});

describe('planReminders — streak-at-risk', () => {
  const meals = DEFAULT_MEAL_REMINDERS;

  it('fires when streak ≥ 3 and today is unlogged', () => {
    const plans = planReminders({ now: noon(), meals, loggedToday: false, streak: 6 });
    const streak = plans.find((p) => p.id === 'streak-risk');
    expect(streak).toBeDefined();
    expect(streak).toMatchObject({ kind: 'date', bodyParams: { n: 6 } });
  });

  it('is omitted once the user has logged today (the cancel-on-log case)', () => {
    const plans = planReminders({ now: noon(), meals, loggedToday: true, streak: 6 });
    expect(plans.find((p) => p.id === 'streak-risk')).toBeUndefined();
  });

  it('is omitted for a streak below the ≥3 threshold', () => {
    expect(planReminders({ now: noon(), meals, loggedToday: false, streak: 2 }).find((p) => p.id === 'streak-risk')).toBeUndefined();
  });

  it('does not schedule in the past (after 8:30pm)', () => {
    const evening = new Date(2026, 6, 4, 21, 0, 0); // 9:00pm, past the 8:30 fire time
    const plans = planReminders({ now: evening, meals, loggedToday: false, streak: 6 });
    expect(plans.find((p) => p.id === 'streak-risk')).toBeUndefined();
  });

  it('fires at 8:30pm local on the same day as now', () => {
    const plans = planReminders({ now: noon(), meals, loggedToday: false, streak: 4 });
    const streak = plans.find((p) => p.id === 'streak-risk');
    const fireAt = streak && streak.kind === 'date' ? streak.fireAt : null;
    expect(fireAt?.getHours()).toBe(20);
    expect(fireAt?.getMinutes()).toBe(30);
    expect(fireAt?.getDate()).toBe(4);
  });
});

describe('planReminders — weigh-in nudge (smart)', () => {
  const meals = DEFAULT_MEAL_REMINDERS;
  // 6:00am — before the 8:00am weigh-in slot, so an overdue nudge can fire.
  const dawn = () => new Date(2026, 6, 4, 6, 0, 0);

  it('fires when it has been ≥7 days since the last weigh-in', () => {
    const plans = planReminders({ now: dawn(), meals, loggedToday: true, streak: 0, daysSinceWeighIn: 9 });
    const w = plans.find((p) => p.id === 'weigh-in');
    expect(w).toMatchObject({ kind: 'date', bodyParams: { n: 9 } });
    const fireAt = w && w.kind === 'date' ? w.fireAt : null;
    expect(fireAt?.getHours()).toBe(8);
    expect(fireAt?.getDate()).toBe(4);
  });

  it('is independent of loggedToday (weighing ≠ food logging)', () => {
    const plans = planReminders({ now: dawn(), meals, loggedToday: false, streak: 0, daysSinceWeighIn: 8 });
    expect(plans.find((p) => p.id === 'weigh-in')).toBeDefined();
  });

  it('is omitted below the 7-day threshold', () => {
    expect(planReminders({ now: dawn(), meals, loggedToday: true, streak: 0, daysSinceWeighIn: 6 })
      .find((p) => p.id === 'weigh-in')).toBeUndefined();
  });

  it('is omitted when weigh-in data is absent (null / undefined)', () => {
    expect(planReminders({ now: dawn(), meals, loggedToday: true, streak: 0, daysSinceWeighIn: null })
      .find((p) => p.id === 'weigh-in')).toBeUndefined();
    expect(planReminders({ now: dawn(), meals, loggedToday: true, streak: 0 })
      .find((p) => p.id === 'weigh-in')).toBeUndefined();
  });

  it('does not schedule in the past (after the 8:00am slot)', () => {
    expect(planReminders({ now: noon(), meals, loggedToday: true, streak: 0, daysSinceWeighIn: 30 })
      .find((p) => p.id === 'weigh-in')).toBeUndefined();
  });
});

describe('resolveMealReminders (1.0 → per-meal upgrade)', () => {
  it('reconstructs the exact schedule 1.0 was running, not the defaults', () => {
    // 1.0 pinned the stored hour to dinner and ran DEFAULT_MEAL_REMINDERS for
    // the rest. An upgrade must not silently move anyone's notifications.
    expect(resolveMealReminders(null, 19)).toEqual({
      breakfast: DEFAULT_MEAL_REMINDERS.breakfast,
      lunch: DEFAULT_MEAL_REMINDERS.lunch,
      dinner: { enabled: true, hour: 19, minute: 0 },
    });
  });

  it('carries the previously-hidden lunch nudge through the upgrade', () => {
    // The whole point of the fix: lunch was already firing: it just had no off
    // switch. It must survive so the user can now see and disable it.
    const m = resolveMealReminders(null, 19);
    expect(m.lunch.enabled).toBe(true);
    expect(m.breakfast.enabled).toBe(false);
  });

  it('falls back to the default hour on a fresh install', () => {
    expect(resolveMealReminders(null, null).dinner.hour).toBe(DEFAULT_REMINDER_HOUR);
  });

  it.each([
    ['out of range high', 24],
    ['out of range low', -1],
    ['not a number', Number.NaN],
  ])('ignores a %s legacy hour', (_label, hour) => {
    expect(resolveMealReminders(null, hour).dinner.hour).toBe(DEFAULT_REMINDER_HOUR);
  });

  it('round-trips a saved schedule', () => {
    const saved: MealReminderSettings = {
      breakfast: { enabled: true, hour: 7, minute: 15 },
      lunch: { enabled: false, hour: 13, minute: 30 },
      dinner: { enabled: true, hour: 21, minute: 0 },
    };
    expect(resolveMealReminders(JSON.stringify(saved), 19)).toEqual(saved);
  });

  it('prefers a saved schedule over the legacy hour', () => {
    const saved = JSON.stringify({
      ...DEFAULT_MEAL_REMINDERS,
      dinner: { enabled: true, hour: 21, minute: 0 },
    });
    expect(resolveMealReminders(saved, 19).dinner.hour).toBe(21);
  });

  it.each([
    ['truncated', '{"breakfast":'],
    ['wrong shape', '{"breakfast":{"enabled":true}}'],
    ['missing a meal', JSON.stringify({ breakfast: DEFAULT_MEAL_REMINDERS.breakfast })],
    ['not an object', '"nope"'],
  ])('falls back to defaults rather than throwing on a %s blob', (_label, raw) => {
    expect(resolveMealReminders(raw, null)).toEqual(DEFAULT_MEAL_REMINDERS);
  });
});
