import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { type DateKey, type DayBoundary, MIDNIGHT } from '@macrolog/core';
import { useDayKey } from '@/hooks/useDayKey';

/**
 * Today has to notice the day turning over — the bug this pins is a phone left
 * on Today overnight (or resumed the next morning) still showing yesterday.
 * The hook has two triggers; each case below disables the other one's chance
 * to mask a failure.
 */

let appStateListener: ((s: AppStateStatus) => void) | null = null;

beforeEach(() => {
  jest.useFakeTimers();
  appStateListener = null;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_type, fn) => {
    appStateListener = fn as (s: AppStateStatus) => void;
    return { remove: () => { appStateListener = null; } } as ReturnType<
      typeof AppState.addEventListener
    >;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useDayKey', () => {
  it('rolls over at midnight while the screen stays open (timer)', async () => {
    jest.setSystemTime(new Date(2026, 9, 4, 23, 59, 0));
    const { result } = await renderHook(() => useDayKey(MIDNIGHT));
    expect(result.current).toBe('2026-10-04');

    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 1000);
    });
    expect(result.current).toBe('2026-10-05');
  });

  it('re-keys on foreground after an overnight background (AppState)', async () => {
    jest.setSystemTime(new Date(2026, 9, 4, 23, 0, 0));
    const { result } = await renderHook(() => useDayKey(MIDNIGHT));
    expect(result.current).toBe('2026-10-04');

    // iOS suspends timers in the background: jump the clock WITHOUT running
    // them, so only the foreground event can move the key.
    jest.setSystemTime(new Date(2026, 9, 5, 7, 0, 0));
    await act(async () => {
      appStateListener?.('active');
    });
    expect(result.current).toBe('2026-10-05');
  });

  it('honours a day boundary — a 03:00 user is still on the old day at 01:00', async () => {
    const boundary: DayBoundary = [{ from: '2026-01-01' as DateKey, hour: 3 }];
    jest.setSystemTime(new Date(2026, 9, 5, 1, 0, 0));
    const { result } = await renderHook(() => useDayKey(boundary));
    expect(result.current).toBe('2026-10-04');

    await act(async () => {
      jest.advanceTimersByTime(2 * 60 * 60 * 1000 + 1000);
    });
    expect(result.current).toBe('2026-10-05');
  });

  it('a same-day foreground keeps the key', async () => {
    jest.setSystemTime(new Date(2026, 9, 4, 9, 0, 0));
    const { result } = await renderHook(() => useDayKey(MIDNIGHT));
    jest.setSystemTime(new Date(2026, 9, 4, 12, 0, 0));
    await act(async () => {
      appStateListener?.('active');
    });
    expect(result.current).toBe('2026-10-04');
  });
});
