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
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

const mockStore = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async (k: string) => mockStore.get(k) ?? null),
    setItem: jest.fn(async (k: string, v: string) => {
      mockStore.set(k, v);
    }),
  },
}));

import { syncReminders } from '@/lib/reminders';

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
