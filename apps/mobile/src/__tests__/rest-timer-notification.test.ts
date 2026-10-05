jest.mock('@/lib/haptics', () => ({ success: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: null }) }));

type ScheduleArg = {
  identifier: string;
  content: { title: string; body: string; interruptionLevel?: string };
  trigger: { type: string; date: Date };
};
const mockPerm = jest.fn<Promise<{ status: string }>, []>(async () => ({ status: 'granted' }));
const mockSchedule = jest.fn<Promise<string>, [ScheduleArg]>(async () => 'notif-1');
const mockCancel = jest.fn<Promise<void>, [string]>(async () => undefined);
const mockPending = jest.fn<Promise<{ identifier: string }[]>, []>(async () => []);
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: () => mockPerm(),
  scheduleNotificationAsync: (a: ScheduleArg) => mockSchedule(a),
  cancelScheduledNotificationAsync: (id: string) => mockCancel(id),
  getAllScheduledNotificationsAsync: () => mockPending(),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { REST_DONE_ID_PREFIX, scheduleRestDoneNotification, useRestTimer } from '@/hooks/useRestTimer';

/**
 * The in-app haptic at the end of a rest only fires while the JS timer is
 * running — a locked phone gets nothing until the lifter looks at it. So the
 * deadline also schedules a LOCAL notification. Three rules are pinned here:
 * it schedules only when permission is ALREADY granted (never prompts), it is
 * cancelled on skip/replace/unmount, and a slow schedule that lands after its
 * countdown was cancelled is cancelled too rather than left to fire.
 */
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, null, children);

// The schedule path is several awaits deep (permission → schedule → then);
// drain the microtask queue rather than count ticks.
const flush = () => act(async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); });

beforeEach(() => {
  jest.clearAllMocks();
  mockPerm.mockImplementation(async () => ({ status: 'granted' }));
  mockSchedule.mockImplementation(async () => 'notif-1');
  mockPending.mockImplementation(async () => []);
});
afterEach(() => jest.useRealTimers());

async function mount() {
  const hook = await renderHook(() => useRestTimer(), { wrapper });
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 28, 12, 0, 0));
  return hook;
}

it('schedules a DATE notification at the deadline when permission is already granted', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(90));
  await flush();
  expect(mockPerm).toHaveBeenCalledTimes(1);
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  const arg = mockSchedule.mock.calls[0][0];
  expect(arg.trigger.type).toBe('date');
  expect(arg.trigger.date.getTime()).toBe(new Date(2026, 8, 28, 12, 1, 30).getTime());
  // Copy comes through t(); whether or not the key is translated yet it is a
  // non-empty string, never undefined.
  expect(typeof arg.content.title).toBe('string');
  expect(arg.content.title.length).toBeGreaterThan(0);
});

it('never prompts: no schedule when permission is not granted, and no requestPermissionsAsync exists to call', async () => {
  mockPerm.mockImplementation(async () => ({ status: 'undetermined' }));
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  expect(mockSchedule).not.toHaveBeenCalled();
  // The mock deliberately has no requestPermissionsAsync — a prompt would throw.
  expect(await scheduleRestDoneNotification(new Date(), ((k: string) => k) as never)).toBeNull();
});

it('cancels the scheduled notification on skip', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  await act(async () => result.current.stop());
  expect(mockCancel).toHaveBeenCalledWith('notif-1');
});

it('replacing a countdown cancels the previous notification and schedules a new one', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  await act(async () => result.current.start(90));
  await flush();
  expect(mockCancel).toHaveBeenCalledWith('notif-1');
  expect(mockSchedule).toHaveBeenCalledTimes(2);
});

it('cancels on unmount (the workout was finished or discarded mid-rest)', async () => {
  const { result, unmount } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  // Concurrent React unmounts asynchronously; the cleanup runs inside act.
  await act(async () => { unmount(); });
  expect(mockCancel).toHaveBeenCalledWith('notif-1');
});

it('a schedule that resolves after its countdown was stopped is cancelled, not kept', async () => {
  let resolveId: (id: string) => void = () => {};
  mockSchedule.mockImplementation(() => new Promise<string>((r) => { resolveId = r; }));
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  await act(async () => result.current.stop());
  expect(mockCancel).not.toHaveBeenCalled(); // nothing known to cancel yet
  await act(async () => { resolveId('late-id'); });
  await flush();
  expect(mockCancel).toHaveBeenCalledWith('late-id');
});

it('asks to break through a Focus mode (time-sensitive; the entitlement decides)', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  expect(mockSchedule.mock.calls[0][0].content.interruptionLevel).toBe('timeSensitive');
});

it('sweeps every pending rest notification before scheduling — none the hook forgot survives (re-score bug 4)', async () => {
  // A request the Lock Screen's +30 s moved after the in-app tick forgot its
  // id, and one left by a runtime that has since restarted: both still carry
  // the prefix. A reminder that does not is left alone.
  mockPending.mockImplementation(async () => [
    { identifier: `${REST_DONE_ID_PREFIX}111.1` },
    { identifier: `${REST_DONE_ID_PREFIX}222.2` },
    { identifier: 'ignia.reminder.lunch' },
  ]);
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  expect(mockCancel).toHaveBeenCalledWith(`${REST_DONE_ID_PREFIX}111.1`);
  expect(mockCancel).toHaveBeenCalledWith(`${REST_DONE_ID_PREFIX}222.2`);
  expect(mockCancel).not.toHaveBeenCalledWith('ignia.reminder.lunch');
  // The sweep runs BEFORE the new request, so it can never cancel it.
  expect(mockSchedule).toHaveBeenCalledTimes(1);
  expect(mockCancel).not.toHaveBeenCalledWith(mockSchedule.mock.calls[0][0].identifier);
});

it('a sweep that cannot list still schedules', async () => {
  mockPending.mockImplementation(async () => {
    throw new Error('not here');
  });
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await flush();
  expect(mockSchedule).toHaveBeenCalledTimes(1);
});
