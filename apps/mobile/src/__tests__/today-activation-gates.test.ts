import { everLoggedFood, showFirstMealCard, wantsReminderAsk } from '@/lib/today-gate';

/**
 * The first-meal card and the reminder ask (2026-11-19). Both key on "has this
 * account ever logged a food", which is UNKNOWN until Today's rows are in —
 * and unknown must show neither, or a returning user sees "Log your first
 * meal" flash on a cold start.
 */

describe('everLoggedFood', () => {
  it('is unknown (null) until the rows are in', () => {
    expect(everLoggedFood({ dataReady: false, todayEntries: 0, hasPriorEntries: false })).toBeNull();
    expect(everLoggedFood({ dataReady: false, todayEntries: 3, hasPriorEntries: true })).toBeNull();
  });
  it('is true with an entry today or on an earlier day', () => {
    expect(everLoggedFood({ dataReady: true, todayEntries: 1, hasPriorEntries: false })).toBe(true);
    expect(everLoggedFood({ dataReady: true, todayEntries: 0, hasPriorEntries: true })).toBe(true);
  });
  it('is false only when ready and empty', () => {
    expect(everLoggedFood({ dataReady: true, todayEntries: 0, hasPriorEntries: false })).toBe(false);
  });
});

describe('showFirstMealCard', () => {
  it('shows for a never-logged account on an empty today', () => {
    expect(showFirstMealCard({ isToday: true, todayEntries: 0, everLogged: false })).toBe(true);
  });
  it('never shows while unknown — no flash for a returning user', () => {
    expect(showFirstMealCard({ isToday: true, todayEntries: 0, everLogged: null })).toBe(false);
  });
  it('goes by itself once an entry exists', () => {
    expect(showFirstMealCard({ isToday: true, todayEntries: 1, everLogged: true })).toBe(false);
  });
  it('never on a past day', () => {
    expect(showFirstMealCard({ isToday: false, todayEntries: 0, everLogged: false })).toBe(false);
  });
});

describe('wantsReminderAsk', () => {
  const base = { isToday: true, everLogged: true, remindersOn: false, answered: false } as const;
  it('asks after a first log, reminders off, never answered, on today', () => {
    expect(wantsReminderAsk(base)).toBe(true);
  });
  it.each([
    ['never logged', { everLogged: false }],
    ['logged unknown', { everLogged: null }],
    ['reminders already on', { remindersOn: true }],
    ['reminders unknown', { remindersOn: null }],
    ['already answered', { answered: true }],
    ['answer unknown', { answered: null }],
    ['a past day', { isToday: false }],
  ])('does not ask: %s', (_, patch) => {
    expect(wantsReminderAsk({ ...base, ...patch })).toBe(false);
  });

  it('is never on the same render as the first-meal card', () => {
    for (const dataReady of [true, false]) {
      for (const todayEntries of [0, 1]) {
        for (const hasPriorEntries of [true, false]) {
          for (const remindersOn of [true, false, null]) {
            for (const answered of [true, false, null]) {
              const everLogged = everLoggedFood({ dataReady, todayEntries, hasPriorEntries });
              const first = showFirstMealCard({ isToday: true, todayEntries, everLogged });
              const ask = wantsReminderAsk({ isToday: true, everLogged, remindersOn, answered });
              expect(first && ask).toBe(false);
            }
          }
        }
      }
    }
  });
});
