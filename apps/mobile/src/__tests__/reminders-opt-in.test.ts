/**
 * `reminders_on` is counted exactly once per grant, and only on a grant
 * (2026-09-10). The counter is what tells `config/retention` how many users
 * any notification-shaped lever can reach at all; a count on a denial, or on
 * switching OFF, would report reach the app does not have.
 */
let mockStatus = 'granted';
jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  requestPermissionsAsync: jest.fn(async () => ({ status: mockStatus })),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => undefined),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
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

const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));

import { setRemindersEnabled } from '@/lib/reminders';

describe('reminders_on', () => {
  beforeEach(() => {
    mockTrack.mockClear();
    mockStore.clear();
  });

  it('counts a grant, once', async () => {
    mockStatus = 'granted';
    await expect(setRemindersEnabled(true)).resolves.toBe(true);
    expect(mockTrack).toHaveBeenCalledTimes(1);
    expect(mockTrack).toHaveBeenCalledWith('reminders_on');
    expect(mockStore.get('reminder.enabled')).toBe('1');
  });

  it('counts nothing on a denial — the switch stays off', async () => {
    mockStatus = 'denied';
    await expect(setRemindersEnabled(true)).resolves.toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
    expect(mockStore.get('reminder.enabled')).toBe('0');
  });

  it('counts nothing on switching off', async () => {
    mockStatus = 'granted';
    await expect(setRemindersEnabled(false)).resolves.toBe(false);
    expect(mockTrack).not.toHaveBeenCalled();
  });
});
