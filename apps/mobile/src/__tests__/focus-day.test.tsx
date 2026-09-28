import { act, renderHook } from '@testing-library/react-native';
import { MIDNIGHT, type DateKey, dayKeyAt } from '@macrolog/core';

/** Drives the focus gate, same stand-in `use-ledger-feed.test.tsx` uses. */
const mockFocus = { focused: true };

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    const focused = mockFocus.focused;
    React.useEffect(() => {
      if (!focused) return;
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb, focused]);
  },
}));

import { useFocusDay } from '@/hooks/useFocusDay';

/**
 * The Trends windows were memoised on `boundary` alone, and for every default
 * account that is the shared `MIDNIGHT` constant — so `trailingDateKeys(N, new
 * Date(), boundary)` was computed once, on the mount day, for as long as the
 * tab stayed mounted. `useFocusDay` is what moves them on.
 */
beforeEach(() => {
  mockFocus.focused = true;
});
afterEach(() => jest.useRealTimers());

/** Mount with real timers (the async renderer needs them to flush), then
 *  freeze the clock at noon on the 27th. */
async function mount<T>(cb: () => T) {
  const hook = await renderHook(cb);
  jest.useFakeTimers();
  jest.setSystemTime(new Date(2026, 8, 27, 12, 0));
  return hook;
}

async function blurThenFocus(rerender: () => void) {
  mockFocus.focused = false;
  await act(async () => rerender());
  mockFocus.focused = true;
  await act(async () => rerender());
}

it('keeps the same Date across refocuses within one day (no memo churn)', async () => {
  const { result, rerender } = await mount(() => useFocusDay(MIDNIGHT));
  const first = result.current;
  jest.setSystemTime(new Date(2026, 8, 27, 18, 30));
  await blurThenFocus(() => rerender(undefined));
  expect(result.current).toBe(first);
});

it('moves to the new day on the first focus after midnight', async () => {
  const { result, rerender } = await mount(() => useFocusDay(MIDNIGHT));
  const first = result.current;
  jest.setSystemTime(new Date(2026, 8, 28, 9, 0));
  await blurThenFocus(() => rerender(undefined));
  expect(result.current).not.toBe(first);
  expect(dayKeyAt(result.current, MIDNIGHT)).toBe('2026-09-28');
});

it("asks the user's boundary which day it is, not the calendar", async () => {
  const threeAm = [{ from: '2026-01-01' as DateKey, hour: 3 }];
  const { result, rerender } = await mount(() => useFocusDay(threeAm));
  const first = result.current;
  // 01:00 on the 28th is still the 27th under a 3 AM start: same window.
  jest.setSystemTime(new Date(2026, 8, 28, 1, 0));
  await blurThenFocus(() => rerender(undefined));
  expect(result.current).toBe(first);
  // 04:00 is the new day.
  jest.setSystemTime(new Date(2026, 8, 28, 4, 0));
  await blurThenFocus(() => rerender(undefined));
  expect(dayKeyAt(result.current, threeAm)).toBe('2026-09-28');
});
