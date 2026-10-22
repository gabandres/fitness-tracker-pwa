import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyLog, Profile } from '@macrolog/core';
import { clearOfflineCache, writeCache } from '@/lib/offline-cache';

/**
 * Today's reads after the 2026-10-21 performance pass.
 *
 * - Water, sleep (hours AND times) and activity are ONE document each, on
 *   today's key, re-keyed when the day rolls over — not three whole
 *   collections read for one key.
 * - Weights are a window starting at the oldest log row plus the two edge
 *   readings (`useTargetWeights`), and the target record waits on BOTH.
 * - Before auth answers, the disk paint keys on `paintUid` while no listener
 *   opens at all.
 */

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
const mockAuth: { user: { uid: string } | null; paintUid: string | null; profile: null } = {
  user: { uid: 'u1' },
  paintUid: 'u1',
  profile: null,
};
jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/hooks/useLogWrites', () => ({ useLogWrites: () => ({}) }));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: jest.fn(), repeatYesterday: jest.fn() }));
jest.mock('@/lib/pending-logs', () => ({
  pendingLogsAsRows: () => Promise.resolve([]),
  onPendingLogsChanged: () => () => {},
}));
jest.mock('@/lib/subscription', () => ({ useSubscription: () => ({ isPro: true }) }));
// The day key, under the test's control — the rollover is the case.
let mockDayKey = '2026-10-21';
jest.mock('@/hooks/useDayKey', () => ({
  useDayKey: () => mockDayKey,
  useCalendarToday: () => new Date(2026, 9, 21),
}));

type Deliver<T> = (value: T, meta?: { fromCache: boolean }) => void;
/** Every listener opened, by name, with its arguments and its `deliver`. */
const opened: { name: string; args: unknown[]; deliver: Deliver<unknown>; unsub: jest.Mock }[] = [];
const sub =
  (name: string, cbAt: number) =>
  (...args: unknown[]) => {
    const unsub = jest.fn();
    opened.push({ name, args: args.slice(0, cbAt), deliver: args[cbAt] as Deliver<unknown>, unsub });
    return unsub;
  };
const mockEdges = jest.fn();

jest.mock('@/lib/ledger', () => {
  const actual = jest.requireActual('@/lib/ledger');
  return {
    weightsWindowStart: actual.weightsWindowStart,
    subscribeRecentLogs: sub('logs', 2),
    subscribeProfile: sub('profile', 1),
    subscribePresets: sub('presets', 1),
    subscribeCustomFoods: sub('customFoods', 1),
    subscribeRecentSessions: sub('sessions', 2),
    subscribeDailyWaterDay: sub('waterDay', 2),
    subscribeDailySleepDay: sub('sleepDay', 2),
    subscribeDailyActivityDay: sub('activityDay', 2),
    subscribeDailyHunger: sub('hunger', 2),
    subscribeDailyWeightsSince: sub('weightsSince', 2),
    getWeightEdges: (...a: unknown[]) => mockEdges(...a),
    updateSleepTimes: jest.fn(),
    setDailyHunger: jest.fn(),
    setHiddenRecentLabels: jest.fn(),
    startFast: jest.fn(),
    breakFast: jest.fn(),
    undoBreakFast: jest.fn(),
  };
});
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
// Only so `requireActual('@/lib/ledger')` can load for the one pure function
// it lends the mock above; nothing here reaches Firestore.
jest.mock('firebase/firestore', () => ({ Timestamp: class {} }));
jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn(), captureError: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn(), isOffline: () => false }));

import { useToday } from '@/hooks/useToday';

const live = (name: string) => {
  const all = opened.filter((o) => o.name === name && o.unsub.mock.calls.length === 0);
  return all[all.length - 1];
};
const row = (id: string, d: Date, calories = 500): DailyLog => ({ id, calories, date: d });
const PROFILE = { sex: 'male', heightIn: 70, age: 30, activityLevel: 'moderate', profileCompleted: true } as unknown as Profile;

beforeEach(async () => {
  await clearOfflineCache();
  await AsyncStorage.clear();
  opened.length = 0;
  mockDayKey = '2026-10-21';
  mockAuth.user = { uid: 'u1' };
  mockAuth.paintUid = 'u1';
  mockEdges.mockReset();
  mockEdges.mockResolvedValue({ first: null, newest: null });
});

describe("Today's daily scalars", () => {
  it('opens one DOCUMENT listener per scalar on today, never a collection', async () => {
    const hook = await renderHook(() => useToday());
    for (const name of ['waterDay', 'sleepDay', 'activityDay', 'hunger']) {
      expect(live(name)?.args).toEqual(['u1', '2026-10-21']);
    }
    await act(async () => {
      live('waterDay').deliver({ '2026-10-21': 32 }, { fromCache: false });
      live('sleepDay').deliver(
        { sleep: { '2026-10-21': 7 }, times: { bedtime: '23:00', wakeTime: '06:00' } },
        { fromCache: false },
      );
      live('activityDay').deliver({ '2026-10-21': { steps: 9000 } }, { fromCache: false });
      live('hunger').deliver(4);
    });
    expect(hook.result.current.water).toBe(32);
    expect(hook.result.current.sleep).toBe(7);
    expect(hook.result.current.sleepTimes).toEqual({ bedtime: '23:00', wakeTime: '06:00' });
    expect(hook.result.current.activity).toEqual({ steps: 9000 });
    expect(hook.result.current.hunger).toBe(4);
  });

  it("re-keys the four day listeners — and only those — when the day rolls over", async () => {
    const hook = await renderHook(() => useToday());
    await act(async () => live('waterDay').deliver({ '2026-10-21': 32 }, { fromCache: false }));
    const logsBefore = live('logs');
    const waterBefore = live('waterDay');

    mockDayKey = '2026-10-22';
    await act(async () => hook.rerender({}));
    expect(waterBefore.unsub).toHaveBeenCalled();
    for (const name of ['waterDay', 'sleepDay', 'activityDay', 'hunger']) {
      expect(live(name)?.args).toEqual(['u1', '2026-10-22']);
    }
    // Yesterday's glasses are not today's, even before the new doc answers.
    expect(hook.result.current.water).toBe(0);
    expect(live('logs')).toBe(logsBefore);
    expect(logsBefore.unsub).not.toHaveBeenCalled();
  });

  it('a cold paint from yesterday reads nothing for today', async () => {
    writeCache('u1', 'water', { '2026-10-20': 40 });
    await new Promise((r) => setTimeout(r, 600));
    const hook = await renderHook(() => useToday());
    expect(hook.result.current.water).toBe(0);
  });
});

describe("Today's weights", () => {
  it('bounds the listener at the oldest log row, and merges in the edge readings', async () => {
    mockEdges.mockResolvedValue({
      first: { dateKey: '2021-03-01', weight: 230 },
      newest: { dateKey: '2026-06-20', weight: 199 },
    });
    const hook = await renderHook(() => useToday());
    await act(async () => {
      live('logs').deliver([row('a', new Date(2026, 6, 14, 9)), row('b', new Date(2026, 9, 21, 9))], { fromCache: false });
      live('profile').deliver(PROFILE, { fromCache: false });
    });
    // The window moved to July once the logs answered.
    const w = live('weightsSince');
    expect(w.args).toEqual(['u1', '2026-07-01']);
    expect(mockEdges).toHaveBeenLastCalledWith('u1', '2026-07-01');
    await act(async () => w.deliver({ '2026-10-21': 190 }, { fromCache: false }));
    await waitFor(() =>
      expect(hook.result.current.shareStats.weightDeltaLb).toBe(40), // 230 first-ever → 190 now
    );
    expect(hook.result.current.hasWeighIn).toBe(true);
  });

  it('holds the target record until the window AND the edges are the server’s', async () => {
    let release: (v: unknown) => void = () => {};
    mockEdges.mockReturnValue(new Promise((r) => (release = r)));
    const hook = await renderHook(() => useToday());
    await act(async () => {
      live('logs').deliver([row('a', new Date(2026, 9, 1, 9))], { fromCache: false });
      live('profile').deliver(PROFILE, { fromCache: false });
      // The window this delivery answers is about to move (no rows → this
      // month; a row on Oct 1 → September): an answer for the OLD window must
      // not count.
      live('weightsSince').deliver({}, { fromCache: false });
    });
    expect(live('weightsSince').args).toEqual(['u1', '2026-09-01']);
    expect(hook.result.current.targetsAuthoritative).toBe(false);
    await act(async () => live('weightsSince').deliver({}, { fromCache: false }));
    expect(hook.result.current.targetsAuthoritative).toBe(false);
    await act(async () => release({ first: null, newest: null }));
    await waitFor(() => expect(hook.result.current.targetsAuthoritative).toBe(true));
  });
});

describe('before auth answers', () => {
  it('paints the presumed account’s cache and opens NO listener', async () => {
    writeCache('u1', 'logs', [row('cached', new Date(2026, 9, 21, 8), 640)]);
    writeCache('u1', 'profile', PROFILE);
    await new Promise((r) => setTimeout(r, 600));
    mockAuth.user = null;
    mockAuth.paintUid = 'u1';

    const hook = await renderHook(() => useToday());
    expect(opened).toHaveLength(0);
    expect(hook.result.current.loading).toBe(false);
    expect(hook.result.current.summary.totalCalories).toBe(640);
    // Nothing is written from a presumed session's numbers.
    expect(hook.result.current.targetsAuthoritative).toBe(false);
  });
});
