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
const mockAdmin = { current: false };
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile.current, isAdmin: mockAdmin.current }),
}));
// Stable, like the real `useT` between locale changes — a fresh function per
// render would re-run the focus effect on every render.
const mockT = (k: string) => k;
jest.mock('@/i18n', () => ({ useT: () => mockT }));
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

it('passes the tape gate (ADR-0043), and re-plans when a late admin claim flips it', async () => {
  mockProfile.current = { sex: 'female' };
  mockAdmin.current = false;
  jest.setSystemTime(new Date(2026, 9, 4, 12, 0));
  let hook: Awaited<ReturnType<typeof renderHook>> | undefined;
  await act(async () => {
    hook = await renderHook(() => useReminderSync());
  });
  await act(async () => {
    subs.weights?.({});
    subs.logs?.([]);
  });
  expect(lastState()).toMatchObject({ tape: { allowed: false, female: true } });

  const before = mockSync.mock.calls.length;
  mockAdmin.current = true;
  await act(async () => {
    await hook!.rerender({});
  });
  expect(mockSync.mock.calls.length).toBe(before + 1);
  expect(lastState()).toMatchObject({ tape: { allowed: true, female: true } });
  mockAdmin.current = false;
});

describe('mealsLoggedToday (owner, 2026-10-08: no nudge for a meal already logged)', () => {
  it('names the logged windows, slotting untagged rows by time and ignoring snacks, weights and workouts', async () => {
    mockProfile.current = null;
    jest.setSystemTime(new Date(2026, 9, 8, 15, 0));
    await act(async () => {
      await renderHook(() => useReminderSync());
    });
    await act(async () => {
      subs.weights?.({});
      subs.logs?.([
        { id: 'a', date: new Date(2026, 9, 8, 8, 0), calories: 400 }, // untagged, 08:00 → breakfast
        { id: 'b', date: new Date(2026, 9, 8, 12, 0), calories: 200, mealType: 'snack' },
        { id: 'c', date: new Date(2026, 9, 8, 12, 30), calories: 0, weight: 180 },
        { id: 'd', date: new Date(2026, 9, 7, 13, 0), calories: 700, mealType: 'lunch' }, // yesterday
      ]);
    });
    expect(lastState()).toMatchObject({ mealsLoggedToday: ['breakfast'] });
  });

  it("before a 3 AM day start, yesterday's breakfast does not silence this morning's", async () => {
    mockProfile.current = { dayBoundary: [{ from: '2026-01-01', hour: 3 }] };
    jest.setSystemTime(new Date(2026, 9, 8, 1, 0));
    await act(async () => {
      await renderHook(() => useReminderSync());
    });
    await act(async () => {
      subs.weights?.({});
      subs.logs?.([
        { id: 'a', date: new Date(2026, 9, 7, 8, 0), calories: 400, mealType: 'breakfast' },
        { id: 'b', date: new Date(2026, 9, 8, 0, 30), calories: 300, mealType: 'dinner' }, // still the 7th
      ]);
    });
    expect(lastState()).toMatchObject({ mealsLoggedToday: [] });
  });

  it('logging a second meal the same day re-plans (the signature carries the meals)', async () => {
    mockProfile.current = null;
    jest.setSystemTime(new Date(2026, 9, 8, 13, 0));
    await act(async () => {
      await renderHook(() => useReminderSync());
    });
    await act(async () => {
      subs.weights?.({});
      subs.logs?.([{ id: 'a', date: new Date(2026, 9, 8, 8, 0), calories: 400, mealType: 'breakfast' }]);
    });
    const calls = mockSync.mock.calls.length;
    await act(async () => {
      subs.logs?.([
        { id: 'a', date: new Date(2026, 9, 8, 8, 0), calories: 400, mealType: 'breakfast' },
        { id: 'b', date: new Date(2026, 9, 8, 12, 45), calories: 650, mealType: 'lunch' },
      ]);
    });
    expect(mockSync.mock.calls.length).toBe(calls + 1);
    expect(lastState()).toMatchObject({ mealsLoggedToday: ['breakfast', 'lunch'] });
  });
});
