/**
 * `syncReminders` must SERIALISE. On a cold start `useReminderSync` recomputes
 * once when the logs snapshot lands and again when the weights snapshot does,
 * and those two syncs used to interleave — cancel, cancel, schedule, schedule
 * — so every nudge was scheduled twice. Measured on the LG VS988 (2026-09-02):
 * four AlarmManager entries for a two-item plan after one launch, i.e. two
 * banners at 1:30pm and two at 8pm. This pins the order: a sync's schedules
 * all land before the next sync's cancel.
 */
const mockEvents: string[] = [];
const mockTick = () => new Promise<void>((r) => setTimeout(r, 0));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {
    mockEvents.push('cancel');
    await mockTick();
  }),
  scheduleNotificationAsync: jest.fn(async () => {
    await mockTick();
    mockEvents.push('schedule');
    return 'id';
  }),
  // Not recorded in mockEvents: the race test pins the cancel/schedule order
  // of the meal plan only.
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  getAllScheduledNotificationsAsync: jest.fn(async () => [{ identifier: 'meal-1' }, { identifier: 'tape-weekly' }]),
  getPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date', WEEKLY: 'weekly' },
}));

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
    removeItem: jest.fn(async (k: string) => {
      mockStore.delete(k);
    }),
  },
}));

import { clearTapeReminder, setRemindersEnabled, setTapeReminder, syncReminders } from '@/lib/reminders';

const t = ((key: string) => key) as unknown as Parameters<typeof syncReminders>[1];
const live = { loggedToday: true, streak: 0, daysSinceWeighIn: null, daysSinceLastLog: 0 };

beforeEach(() => {
  mockEvents.length = 0;
  mockStore.clear();
  mockStore.set('reminder.enabled', '1');
});

describe('syncReminders', () => {
  it('does not interleave two concurrent syncs (the double-notification race)', async () => {
    await Promise.all([syncReminders(live, t), syncReminders(live, t)]);

    // Default plan with daysSinceLastLog 0 at any daytime: lunch + dinner
    // dailies plus the two lapsed one-shots = 4 schedules per sync.
    const perSync = mockEvents.indexOf('cancel', 1);
    expect(perSync).toBeGreaterThan(1);
    const batch = ['cancel', ...Array<string>(perSync - 1).fill('schedule')];
    expect(mockEvents).toEqual([...batch, ...batch]);
  });

  it('a failed sync does not block the next one', async () => {
    mockStore.set('reminder.meals', '{"breakfast":'); // corrupt blob → defaults, still fine
    const { cancelAllScheduledNotificationsAsync } = jest.requireMock('expo-notifications');
    (cancelAllScheduledNotificationsAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));

    await syncReminders(live, t);
    await syncReminders(live, t);
    expect(mockEvents.filter((e) => e === 'schedule').length).toBeGreaterThan(0);
  });
});

describe('weekly tape reminder (ADR-0043)', () => {
  const notif = () => jest.requireMock('expo-notifications') as Record<string, jest.Mock>;
  beforeEach(() => {
    notif().scheduleNotificationAsync.mockClear();
    notif().cancelScheduledNotificationAsync.mockClear();
  });

  it('survives a sync with meal reminders OFF, as a WEEKLY trigger under a fixed id', async () => {
    mockStore.set('reminder.enabled', '0');
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    await syncReminders(live, t);
    expect(notif().scheduleNotificationAsync).toHaveBeenCalledTimes(1);
    expect(notif().scheduleNotificationAsync.mock.calls[0][0]).toMatchObject({
      identifier: 'tape-weekly',
      content: { title: 'reminder.tapeTitle', body: 'reminder.tapeBody' },
      trigger: { type: 'weekly', weekday: 2, hour: 7, minute: 0 },
    });
  });

  it('turning it off cancels by id and forgets the setting', async () => {
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    expect(await setTapeReminder(null, t)).toBe('ok');
    expect(mockStore.has('reminder.tape')).toBe(false);
    expect(notif().cancelScheduledNotificationAsync).toHaveBeenCalledWith('tape-weekly');
  });

  it('turning meal reminders OFF leaves the tape reminder scheduled', async () => {
    notif().cancelAllScheduledNotificationsAsync.mockClear();
    await setRemindersEnabled(false);
    expect(notif().cancelAllScheduledNotificationsAsync).not.toHaveBeenCalled();
    expect(notif().cancelScheduledNotificationAsync.mock.calls).toEqual([['meal-1']]);
  });

  it('turning it off while a sync is in flight sticks (one queue)', async () => {
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    const sync = syncReminders(live, t); // reads the setting, then schedules a beat later
    const off = setTapeReminder(null, t);
    await Promise.all([sync, off]);
    const tapeSchedule = notif().scheduleNotificationAsync.mock.calls.findIndex((c) => c[0].identifier === 'tape-weekly');
    const scheduledAt = notif().scheduleNotificationAsync.mock.invocationCallOrder[tapeSchedule];
    const cancelledAt = Math.max(...notif().cancelScheduledNotificationAsync.mock.invocationCallOrder);
    expect(cancelledAt).toBeGreaterThan(scheduledAt);
  });

  it('meal reminders OFF that cannot cancel: rejects, and the stored flag stays ON', async () => {
    notif().getAllScheduledNotificationsAsync.mockRejectedValueOnce(new Error('bridge'));
    await expect(setRemindersEnabled(false)).rejects.toThrow('bridge');
    expect(mockStore.get('reminder.enabled')).toBe('1');
  });

  it('sign-out forgets it and cancels it — it belongs to the account, not the phone', async () => {
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    await clearTapeReminder();
    expect(mockStore.has('reminder.tape')).toBe(false);
    expect(notif().cancelScheduledNotificationAsync).toHaveBeenCalledWith('tape-weekly');
  });

  it('flag OFF on a gated sync: the notification is cancelled but the setting is KEPT', async () => {
    mockStore.set('reminder.enabled', '0');
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    await syncReminders({ ...live, tape: { allowed: false, female: false } }, t);
    expect(notif().scheduleNotificationAsync).not.toHaveBeenCalled();
    expect(notif().cancelScheduledNotificationAsync).toHaveBeenCalledWith('tape-weekly');
    expect(mockStore.has('reminder.tape')).toBe(true);

    // A later ungated sync (Settings') must not re-arm it…
    await syncReminders(live, t);
    expect(notif().scheduleNotificationAsync).not.toHaveBeenCalled();
    // …and the flag coming back restores it without asking again.
    await syncReminders({ ...live, tape: { allowed: true, female: false } }, t);
    expect(notif().scheduleNotificationAsync).toHaveBeenCalledTimes(1);
  });

  it('the hip wording follows the LIVE profile, not the stored setting', async () => {
    mockStore.set('reminder.enabled', '0');
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 })); // stored before `hip`
    await syncReminders({ ...live, tape: { allowed: true, female: true } }, t);
    expect(notif().scheduleNotificationAsync.mock.calls[0][0].content.body).toBe('reminder.tapeBodyHip');
  });

  it('a failed store reports "failed" — the switch must not say On', async () => {
    const storage = jest.requireMock('@react-native-async-storage/async-storage').default;
    (storage.setItem as jest.Mock).mockRejectedValueOnce(new Error('disk full'));
    expect(await setTapeReminder({ weekday: 2, hour: 7, minute: 0 }, t)).toBe('failed');
    expect(mockStore.has('reminder.tape')).toBe(false);
  });

  it('a tape-reminder failure never costs the meal plan', async () => {
    mockStore.set('reminder.tape', JSON.stringify({ weekday: 2, hour: 7, minute: 0 }));
    notif().scheduleNotificationAsync.mockRejectedValueOnce(new Error('weekly unsupported'));
    mockEvents.length = 0;
    await syncReminders(live, t);
    expect(mockEvents.filter((e) => e === 'schedule').length).toBeGreaterThan(0);
  });
});
