/**
 * Rest-timer notification priming (UX_AUDIT S18-10, native half).
 *
 * The rest timer schedules its "rest over" notification only when permission
 * is already granted and never asks; before this, nothing else asked either.
 * Three rules are pinned: the sheet shows ONCE (either answer records it),
 * never when the OS already granted, never when the OS already denied — and
 * once the OS says yes, the countdown that surfaced the sheet is armed
 * without restarting the clock (`rearm`).
 */
jest.mock('@/lib/haptics', () => ({ success: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: null }) }));

const mockPerm = jest.fn<Promise<{ status: string }>, []>(async () => ({ status: 'undetermined' }));
const mockSchedule = jest.fn<Promise<string>, [unknown]>(async () => 'notif-1');
const mockCancel = jest.fn<Promise<void>, [string]>(async () => undefined);
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockPerm(),
  scheduleNotificationAsync: (a: unknown) => mockSchedule(a),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderHook } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { useRestTimer } from '@/hooks/useRestTimer';
import {
  REST_NOTIFY_PRIMED_KEY,
  decideRestNotifyPriming,
  markRestNotifyPrimed,
  shouldPrimeRestNotify,
} from '@/components/train/rest-notify-priming';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockPerm.mockImplementation(async () => ({ status: 'undetermined' }));
});
afterEach(() => jest.useRealTimers());

describe('shouldPrimeRestNotify (pure)', () => {
  it('shows once: undetermined and never shown', () => {
    expect(shouldPrimeRestNotify({ seen: false, status: 'undetermined' })).toBe(true);
  });
  it('never again after either answer', () => {
    expect(shouldPrimeRestNotify({ seen: true, status: 'undetermined' })).toBe(false);
  });
  it('skips when the OS already granted', () => {
    expect(shouldPrimeRestNotify({ seen: false, status: 'granted' })).toBe(false);
  });
  it('does not re-prompt a user who denied at the OS level', () => {
    expect(shouldPrimeRestNotify({ seen: false, status: 'denied' })).toBe(false);
  });
});

describe('decideRestNotifyPriming (storage + OS)', () => {
  it('true on a fresh device with the OS undetermined', async () => {
    expect(await decideRestNotifyPriming()).toBe(true);
  });
  it('false once marked, whatever the OS says', async () => {
    await markRestNotifyPrimed();
    expect(await AsyncStorage.getItem(REST_NOTIFY_PRIMED_KEY)).toBe('1');
    expect(await decideRestNotifyPriming()).toBe(false);
  });
  it('false when the permission read throws — a sheet whose Allow cannot work is worse than none', async () => {
    mockPerm.mockImplementation(async () => { throw new Error('bridge'); });
    expect(await decideRestNotifyPriming()).toBe(false);
  });
});

describe('useRestTimer.rearm', () => {
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(I18nProvider, null, children);
  const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

  it('arms the running countdown for its ORIGINAL deadline once permission exists', async () => {
    const { result } = await renderHook(() => useRestTimer(), { wrapper });
    jest.useFakeTimers();
    jest.setSystemTime(new Date(2026, 8, 28, 12, 0, 0));
    await act(async () => result.current.start(90));
    await flush();
    expect(mockSchedule).not.toHaveBeenCalled(); // undetermined → nothing scheduled

    // The user tapped Allow and the OS granted; ten seconds have passed.
    mockPerm.mockImplementation(async () => ({ status: 'granted' }));
    jest.setSystemTime(new Date(2026, 8, 28, 12, 0, 10));
    await act(async () => result.current.rearm());
    await flush();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
    const arg = mockSchedule.mock.calls[0][0] as { trigger: { date: Date } };
    expect(arg.trigger.date.getTime()).toBe(new Date(2026, 8, 28, 12, 1, 30).getTime());

    // Idempotent: already armed → no second schedule.
    await act(async () => result.current.rearm());
    await flush();
    expect(mockSchedule).toHaveBeenCalledTimes(1);
  });

  it('is a no-op when idle', async () => {
    mockPerm.mockImplementation(async () => ({ status: 'granted' }));
    const { result } = await renderHook(() => useRestTimer(), { wrapper });
    await act(async () => result.current.rearm());
    await flush();
    expect(mockSchedule).not.toHaveBeenCalled();
  });
});
