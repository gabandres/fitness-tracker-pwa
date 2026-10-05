jest.mock('@/lib/haptics', () => ({ success: jest.fn() }));
// The hook schedules a local notification at the deadline; that behaviour has
// its own spec (rest-timer-notification.test.ts). Here it is inert.
jest.mock('expo-notifications', () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelScheduledNotificationAsync: jest.fn(async () => undefined),
  SchedulableTriggerInputTypes: { DAILY: 'daily', DATE: 'date' },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ profile: null }) }));

import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { I18nProvider } from '@/i18n';
import { LATE_END_MS, useRestCountdown, useRestTimer } from '@/hooks/useRestTimer';
import * as haptics from '@/lib/haptics';

const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(I18nProvider, null, children);

/**
 * The rest countdown is WALL-CLOCK time. JS timers are suspended while the
 * screen is locked — which is what a lifter does between sets — and a timer
 * that decremented once per tick came back from a 60 s lock still showing the
 * number it left with, then buzzed a minute late.
 *
 * Since the Train re-score the hook owns the DEADLINE (`endsAt`, moved only on
 * start / stop / run-out) and the per-second face is `useRestCountdown`, which
 * the rest bar calls itself — so the tick re-renders the bar, not the workout.
 */
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

/** Mount the timer AND a countdown that follows its deadline, the way the
 *  session and its rest bar are wired. Real timers to mount (the async
 *  renderer needs them to flush), then a frozen clock for everything after. */
async function mount(opts: Parameters<typeof useRestTimer>[0] = {}) {
  const hook = await renderHook(
    () => {
      const timer = useRestTimer(opts);
      const face = useRestCountdown(timer.endsAt);
      return { ...timer, ...face };
    },
    { wrapper },
  );
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  return hook;
}

it('counts down by the clock, so a locked phone does not pause the rest', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(90));
  // The countdown reads the clock on the next macrotask after a retarget.
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(result.current.remaining).toBe(90);
  expect(result.current.endsAt).toBe(Date.now() + 90_000);

  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(result.current.remaining).toBe(85);
  expect(result.current.remainingNow()).toBe(85);

  // Screen locked: the clock moves 60 s with NO ticks, then one tick on wake.
  await act(async () => {
    jest.setSystemTime(Date.now() + 60_000);
    jest.advanceTimersByTime(1000);
  });
  expect(result.current.remaining).toBe(24);
  expect(result.current.label).toBe('0:24');
});

it('the deadline does not move once a second — only the countdown does', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(60));
  const endsAt = result.current.endsAt;
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(result.current.endsAt).toBe(endsAt);
  expect(result.current.remaining).toBe(57);
});

it('finishes with one buzz when the deadline passes on screen', async () => {
  const onElapsed = jest.fn();
  const { result } = await mount({ onElapsed });
  await act(async () => result.current.start(3));
  await act(async () => {
    jest.advanceTimersByTime(3000);
  });
  expect(result.current.endsAt).toBeNull();
  expect(result.current.remaining).toBe(0);
  expect(haptics.success).toHaveBeenCalledTimes(1);
  expect(onElapsed).toHaveBeenCalledWith({ late: false });
  // Idle: no further ticks, no second buzz.
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(haptics.success).toHaveBeenCalledTimes(1);
  expect(onElapsed).toHaveBeenCalledTimes(1);
});

it('a rest that ran out while the phone was locked ends WITHOUT a late buzz (re-score bug 8)', async () => {
  const onElapsed = jest.fn();
  const { result } = await mount({ onElapsed });
  await act(async () => result.current.start(30));
  await act(async () => {
    jest.setSystemTime(Date.now() + 30_000 + LATE_END_MS + 13_000);
    jest.advanceTimersByTime(1000);
  });
  expect(result.current.endsAt).toBeNull();
  expect(haptics.success).not.toHaveBeenCalled();
  expect(onElapsed).toHaveBeenCalledWith({ late: true });
});

it('stop is silent and idempotent', async () => {
  const onElapsed = jest.fn();
  const { result } = await mount({ onElapsed });
  await act(async () => result.current.start(30));
  await act(async () => result.current.stop());
  await act(async () => result.current.stop());
  expect(result.current.endsAt).toBeNull();
  expect(result.current.remaining).toBe(0);
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(haptics.success).not.toHaveBeenCalled();
  expect(onElapsed).not.toHaveBeenCalled();
});

it('a ±30 s retarget redraws at once, not on the next tick', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(60));
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  await act(async () => result.current.start(result.current.remainingNow() + 30));
  await act(async () => {
    jest.advanceTimersByTime(0);
  });
  expect(result.current.remaining).toBe(90);
});
