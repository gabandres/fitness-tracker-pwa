/**
 * `useBody` — the data half of the Body re-score (S20, 2026-10-04).
 *
 * Driven the way `cached-paint.test.tsx` drives it: every listener holds its
 * newest `deliver`, so a test pushes snapshots through by hand. Pins the
 * stable start the milestones and goal progress share (bug 4), the hero date
 * for a weight that came from a log (bug 10), the 7-day average, and the Undo
 * receipt that read "trend unchanged" off a stale map (bug 10).
 */
import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { type DailyLog, type Profile, addDays, calendarDateKey, trendShift } from '@macrolog/core';

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/health-sync', () => ({
  exportDaily: jest.fn(),
  exportManualWeight: jest.fn(),
  forgetHealthWeight: jest.fn().mockResolvedValue(false),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/pending-body', () => ({
  commitBodyOp: jest.fn().mockResolvedValue({ landed: Promise.resolve('saved') }),
  flushPendingBody: jest.fn().mockResolvedValue(0),
  onPendingBodyChanged: () => () => {},
  readPendingBody: () => Promise.resolve({ weights: {}, added: [], updated: {}, deleted: [] }),
}));

type Deliver<T> = (value: T, meta?: { fromCache: boolean }) => void;
const live: {
  logs?: Deliver<DailyLog[]>;
  weights?: Deliver<Record<string, number>>;
  profile?: Deliver<Profile | null>;
} = {};
let mockEarliest: { dateKey: string; weight: number } | null = null;

jest.mock('@/lib/ledger', () => ({
  subscribeRecentLogs: (_u: string, _n: number, cb: Deliver<DailyLog[]>) => {
    live.logs = cb;
    return () => {};
  },
  subscribeDailyWeightsSince: (_u: string, _s: string, cb: Deliver<Record<string, number>>) => {
    live.weights = cb;
    return () => {};
  },
  subscribeProfile: (_u: string, cb: Deliver<Profile | null>) => {
    live.profile = cb;
    return () => {};
  },
  subscribeMeasurements: () => () => {},
  getEarliestDailyWeight: () => Promise.resolve(mockEarliest),
  getAllDailyWeights: () => Promise.resolve({}),
}));

import { useBody } from '@/hooks/useBody';

const day = (offset: number) => calendarDateKey(addDays(new Date(), offset));

async function mount() {
  const hook = await renderHook(() => useBody());
  await act(async () => {
    live.logs?.([]);
    live.weights?.({});
    live.profile?.({ goalWeightLbs: 180 } as Profile);
  });
  return hook;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  mockEarliest = null;
});

describe('useBody — re-score', () => {
  it('startLb is the earliest-ever weigh-in, the same start goal progress uses (bug 4)', async () => {
    mockEarliest = { dateKey: '2024-01-01', weight: 210 };
    const hook = await mount();
    await act(async () => live.weights?.({ [day(-20)]: 195, [day(0)]: 190 }));
    await waitFor(() => expect(hook.result.current.startLb).toBe(210));
    expect(hook.result.current.goalProgress?.startWeight).toBe(210);
  });

  it('without an earlier start, startLb is the oldest loaded weigh-in', async () => {
    const hook = await mount();
    await act(async () => live.weights?.({ [day(-20)]: 195, [day(0)]: 190 }));
    await waitFor(() => expect(hook.result.current.startLb).toBe(195));
  });

  it('a goal passed in its own direction leaves nothing remaining (bug 1)', async () => {
    const hook = await mount();
    // The TREND has to be past it (re-score 3, bug 3), so a run of readings
    // under the goal rather than one.
    await act(async () =>
      live.weights?.({ [day(-20)]: 200, [day(-6)]: 178, [day(-5)]: 177.5, [day(-4)]: 177, [day(-3)]: 177, [day(-2)]: 176.5, [day(-1)]: 176.5, [day(0)]: 176 }),
    );
    await waitFor(() => expect(hook.result.current.goalProgress?.remaining).toBe(0));
  });

  it('goal progress is judged on the trend, not one light morning (re-score 3, bug 3)', async () => {
    const hook = await mount();
    // Steady at ~181, then one 179.4 morning: the scale is past the 180 goal,
    // the trend is not — so neither "Goal reached" nor 100%.
    await act(async () =>
      live.weights?.({ [day(-4)]: 181.2, [day(-3)]: 181, [day(-2)]: 181.1, [day(-1)]: 180.9, [day(0)]: 179.4 }),
    );
    await waitFor(() => expect(hook.result.current.goalProgress).not.toBeNull());
    const p = hook.result.current.goalProgress!;
    expect(p.currentWeight).toBeCloseTo(hook.result.current.trendWeight!, 5);
    expect(p.remaining).toBeGreaterThan(0);
    expect(p.pct).toBeLessThan(100);
  });

  it('a weight that came from a log names the log\'s day (bug 10)', async () => {
    const hook = await mount();
    const d = new Date();
    d.setDate(d.getDate() - 3);
    d.setHours(12, 0, 0, 0);
    await act(async () => live.logs?.([{ id: 'l1', calories: 0, date: d, weight: 182 } as DailyLog]));
    await waitFor(() => expect(hook.result.current.currentWeight).toBe(182));
    expect(hook.result.current.currentWeightDateKey).toBe(calendarDateKey(d));
  });

  it('carries a 7-day average once there are two readings in the week', async () => {
    const hook = await mount();
    await act(async () => live.weights?.({ [day(-1)]: 181, [day(0)]: 180, [day(-30)]: 190 }));
    await waitFor(() => expect(hook.result.current.weekAverage).toEqual({ avgLb: 180.5, count: 2 }));
  });

  it('an Undo fired from a stale closure previews the trend against the CURRENT map (bug 10)', async () => {
    const hook = await mount();
    const a = day(-2);
    const b = day(-1);
    await act(async () => live.weights?.({ [a]: 180, [b]: 184 }));
    await waitFor(() => expect(hook.result.current.weighIns).toHaveLength(2));
    // The toast's Undo holds the callback from BEFORE the delete landed.
    const staleSetWeight = hook.result.current.setWeight;
    await act(async () => live.weights?.({ [a]: 180 }));
    await waitFor(() => expect(hook.result.current.weighIns).toHaveLength(1));
    let receipt: Awaited<ReturnType<typeof staleSetWeight>> | undefined;
    await act(async () => {
      receipt = await staleSetWeight(184, b);
    });
    expect(receipt!.trend).toEqual(trendShift({ [a]: 180 }, b, 184));
    expect(receipt!.trend.beforeLb).not.toBe(receipt!.trend.afterLb);
  });
});
