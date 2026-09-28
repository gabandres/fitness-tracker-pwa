import { act, renderHook } from '@testing-library/react-native';
import type { DailyLog } from '@macrolog/core';

/**
 * `useReminderSync` feeds `planReminders` two "days since" numbers. Both are
 * derived from boundary-aware day keys, so the "today" they are measured
 * against must be the user's today too: at 01:00 under a 3 AM start a meal
 * logged at 23:00 is the SAME day, and calling it "1 day ago" fired the lapsed
 * nudges a day early. The span is rounded, not floored, so a DST hour cannot
 * shave a day off either.
 */

const mockFocus = { focused: true };
const mockSync = jest.fn(async () => undefined);
const subs: { logs?: (l: DailyLog[]) => void; weights?: (w: Record<string, number>) => void } = {};
const mockProfile: { current: unknown } = { current: null };

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
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile.current }),
}));
jest.mock('@/i18n', () => ({ useT: () => (k: string) => k }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_l: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/reminders', () => ({
  syncReminders: (...a: unknown[]) => mockSync(...(a as [])),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeRecentLogs: (_u: string, _n: number, cb: (l: DailyLog[]) => void) => {
    subs.logs = cb;
    return () => {};
  },
  subscribeDailyWeights: (_u: string, cb: (w: Record<string, number>) => void) => {
    subs.weights = cb;
    return () => {};
  },
}));

import { useReminderSync } from '@/hooks/useReminderSync';

beforeEach(() => {
  jest.useFakeTimers();
  mockSync.mockClear();
  mockFocus.focused = true;
});
afterEach(() => jest.useRealTimers());

const lastState = () => (mockSync.mock.calls.at(-1) as unknown as [Record<string, unknown>])[0];

it("measures 'days since' against the user's today under a 3 AM boundary", async () => {
  mockProfile.current = { dayBoundary: [{ from: '2026-01-01', hour: 3 }] };
  // 01:00 on the 27th is still the 26th for this user.
  jest.setSystemTime(new Date(2026, 8, 27, 1, 0));
  await act(async () => {
    await renderHook(() => useReminderSync());
  });
  await act(async () => {
    subs.weights?.({});
    subs.logs?.([{ id: 'a', date: new Date(2026, 8, 26, 23, 0), calories: 600 }]);
  });
  expect(lastState()).toMatchObject({ loggedToday: true, daysSinceLastLog: 0 });
});

it('counts whole days across a DST change (round, not floor)', async () => {
  mockProfile.current = null;
  // 2026-03-08 is the US spring-forward. Two calendar days later the span is
  // 47 hours; floor(47/24) = 1 said "yesterday" about a log from two days ago.
  jest.setSystemTime(new Date(2026, 2, 10, 12, 0));
  await act(async () => {
    await renderHook(() => useReminderSync());
  });
  await act(async () => {
    subs.weights?.({});
    subs.logs?.([{ id: 'a', date: new Date(2026, 2, 8, 9, 0), calories: 600 }]);
  });
  expect(lastState()).toMatchObject({ loggedToday: false, daysSinceLastLog: 2 });
});
