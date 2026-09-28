jest.mock('@/lib/haptics', () => ({ success: jest.fn() }));

import { act, renderHook } from '@testing-library/react-native';
import { useRestTimer } from '@/hooks/useRestTimer';
import * as haptics from '@/lib/haptics';

/**
 * The rest countdown is WALL-CLOCK time. JS timers are suspended while the
 * screen is locked — which is what a lifter does between sets — and a timer
 * that decremented once per tick came back from a 60 s lock still showing the
 * number it left with, then buzzed a minute late.
 */
beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.useRealTimers());

/** Mount with real timers (the async renderer needs them to flush), then
 *  freeze the clock so `start` and every tick run against fake time. */
async function mount() {
  const hook = await renderHook(() => useRestTimer());
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 27, 12, 0, 0));
  return hook;
}

it('counts down by the clock, so a locked phone does not pause the rest', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(90));
  expect(result.current.remaining).toBe(90);

  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(result.current.remaining).toBe(85);

  // Screen locked: the clock moves 60 s with NO ticks, then one tick on wake.
  await act(async () => {
    jest.setSystemTime(Date.now() + 60_000);
    jest.advanceTimersByTime(1000);
  });
  expect(result.current.remaining).toBe(24);
  expect(result.current.label).toBe('0:24');
});

it('finishes with one buzz when the deadline passes while suspended', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(30));
  await act(async () => {
    jest.setSystemTime(Date.now() + 45_000);
    jest.advanceTimersByTime(1000);
  });
  expect(result.current.remaining).toBe(0);
  expect(haptics.success).toHaveBeenCalledTimes(1);
  // Idle: no further ticks, no second buzz.
  await act(async () => {
    jest.advanceTimersByTime(5000);
  });
  expect(haptics.success).toHaveBeenCalledTimes(1);
});

it('stop is silent and idempotent', async () => {
  const { result } = await mount();
  await act(async () => result.current.start(30));
  await act(async () => result.current.stop());
  await act(async () => result.current.stop());
  expect(result.current.remaining).toBe(0);
  await act(async () => {
    jest.advanceTimersByTime(60_000);
  });
  expect(haptics.success).not.toHaveBeenCalled();
});
