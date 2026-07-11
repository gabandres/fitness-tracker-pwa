import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MEAL_REMINDERS,
  planReminders,
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
