import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LOG_WINDOW_ROWS, type DailyLog } from '@macrolog/core';

/**
 * Data-layer defects from the 2026-10-15 audit (second batch):
 *
 *  1. `useCachedState` dropped EVERY cache-only snapshot once it had painted
 *     from disk. Offline, every snapshot is cache-only — including the ones
 *     carrying the user's own writes — so an offline delete or edit never
 *     showed until reconnect.
 *  2. History's older months were one `getDocs` kept for the screen's life,
 *     so an add/delete on an old day never reached the calendar.
 *  3. (`breakFast` idempotency is pinned in `fast-end-undo.test.ts`.)
 *  4. `useMilestones` opened its listener on mount, outside the focus gate and
 *     `trackSubs`.
 */

const mockFocus = { focused: true };
const mockTracked: string[] = [];
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
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (label: string, unsubs: (() => void)[]) => {
    mockTracked.push(label);
    return () => unsubs.forEach((u) => u());
  },
}));

type Deliver<T> = (v: T, meta?: { fromCache: boolean }) => void;
const mockRange: { args: unknown[]; deliver: Deliver<DailyLog[]>; unsub: jest.Mock }[] = [];
let mockWindow: Deliver<DailyLog[]> | null = null;
let mockMilestones: Deliver<Record<string, Date>> | null = null;
const mockMilestoneUnsub = jest.fn();

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/hooks/useLogWrites', () => ({ useLogWrites: () => ({}) }));
jest.mock('@/lib/ledger', () => ({
  subscribeRecentLogs: (_u: string, _n: number, d: Deliver<DailyLog[]>) => {
    mockWindow = d;
    return () => {};
  },
  subscribeDailyWeights: () => () => {},
  subscribePresets: () => () => {},
  subscribeCustomFoods: () => () => {},
  subscribeRecentSessions: () => () => {},
  subscribeLogsForRange: (...a: unknown[]) => {
    const unsub = jest.fn();
    mockRange.push({ args: a.slice(0, 3), deliver: a[4] as Deliver<DailyLog[]>, unsub });
    return unsub;
  },
  subscribeMilestones: (_u: string, d: Deliver<Record<string, Date>>) => {
    mockMilestones = d;
    return mockMilestoneUnsub;
  },
  recordMilestone: jest.fn(async () => true),
  hasAnyCompletedFast: jest.fn(async () => false),
  hasAnyCompletedWorkout: jest.fn(async () => false),
}));

import { __resetServerAnswered, useCachedState } from '@/hooks/useCachedState';
import { useHistory } from '@/hooks/useHistory';
import { useMilestoneRecord, useMilestones } from '@/hooks/useMilestones';
import { clearOfflineCache, writeCache } from '@/lib/offline-cache';
import { monthToWatch } from '@/lib/history-paging';

beforeEach(async () => {
  await clearOfflineCache();
  await AsyncStorage.clear();
  __resetServerAnswered();
  mockFocus.focused = true;
  mockTracked.length = 0;
  mockRange.length = 0;
  mockWindow = null;
  mockMilestones = null;
  mockMilestoneUnsub.mockClear();
});

describe('1 — useCachedState shows the user’s own offline writes', () => {
  async function painted(slice: 'presets' | 'logs', v: string[]) {
    writeCache('u1', slice, v);
    await new Promise((r) => setTimeout(r, 600));
    const hook = await renderHook(() => useCachedState<string[]>('u1', slice, []));
    await waitFor(() => expect(hook.result.current[2]).toBe(true));
    return hook;
  }

  it('after the server has answered, an offline delete (a cache-only snapshot) reaches the screen', async () => {
    const hook = await painted('presets', ['a', 'b']);
    await act(async () => hook.result.current[1](['a', 'b', 'c'], { authoritative: true }));
    // Signal gone; the user deletes `b`. The SDK's next snapshot is cache-only.
    await act(async () => hook.result.current[1](['a', 'c'], { authoritative: false }));
    expect(hook.result.current[0]).toEqual(['a', 'c']);
  });

  it('holds across a remount and a listener re-open — the memory cache outlives both', async () => {
    const first = await painted('logs', ['a']);
    await act(async () => first.result.current[1](['a', 'b'], { authoritative: true }));
    await first.unmount();
    const second = await renderHook(() => useCachedState<string[]>('u1', 'logs', []));
    await act(async () => second.result.current[1](['b'], { authoritative: false }));
    expect(second.result.current[0]).toEqual(['b']);
  });

  it('still refuses the cold-start cache-only snapshot when the server has NOT answered this run', async () => {
    const hook = await painted('presets', ['a', 'b']);
    await act(async () => hook.result.current[1]([], { authoritative: false }));
    expect(hook.result.current[0]).toEqual(['a', 'b']);
  });

  it('a shown cache-only value is still never written to disk', async () => {
    const hook = await painted('presets', ['a']);
    await act(async () => hook.result.current[1](['a', 'b'], { authoritative: true }));
    await new Promise((r) => setTimeout(r, 600));
    await act(async () => hook.result.current[1](['x'], { authoritative: false }));
    expect(hook.result.current[0]).toEqual(['x']);
    await new Promise((r) => setTimeout(r, 600));
    // The next cold paint is the last SERVER-confirmed value.
    expect(JSON.stringify(await AsyncStorage.getAllKeys().then((k) => AsyncStorage.multiGet(k)))).not.toContain('"x"');
  });
});

/** A full 400-row window whose oldest row is in September 2026. */
function fullWindow(): DailyLog[] {
  return Array.from({ length: LOG_WINDOW_ROWS }, (_, i) => ({
    id: `w${i}`,
    date: new Date(2026, 8, 1 + (i % 28), 12),
    calories: 100,
    protein: 1,
    carbs: 1,
    fat: 1,
  })) as DailyLog[];
}

describe('2 — an older History month stays live while it is viewed', () => {
  it('pure: watches only a month behind a FULL window', () => {
    expect(monthToWatch({ view: new Date(2026, 5, 10), oldestWindowKey: '2026-09-01', windowRows: LOG_WINDOW_ROWS })).toBe('2026-06');
    expect(monthToWatch({ view: new Date(2026, 9, 10), oldestWindowKey: '2026-09-01', windowRows: LOG_WINDOW_ROWS })).toBeNull();
    expect(monthToWatch({ view: new Date(2026, 5, 10), oldestWindowKey: '2026-09-01', windowRows: 10 })).toBeNull();
  });

  it('a delete on an old day reaches the screen; leaving the month closes its listener', async () => {
    const hook = await renderHook(() => useHistory());
    await act(async () => mockWindow!(fullWindow()));
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 5, 10)));
    expect(mockRange).toHaveLength(1);
    expect(mockRange[0].args).toEqual(['u1', '2026-06-01', '2026-06-30']);
    expect(hook.result.current.olderMonths.loading).toBe(true);

    const old = (id: string) => ({ id, date: new Date(2026, 5, 3, 9), calories: 300, protein: 1, carbs: 1, fat: 1 }) as DailyLog;
    await act(async () => mockRange[0].deliver([old('j1'), old('j2')]));
    expect(hook.result.current.logs.filter((l) => l.id?.startsWith('j'))).toHaveLength(2);
    expect(hook.result.current.olderMonths.loading).toBe(false);

    // Deleted from the day-detail route: the listener hears it.
    await act(async () => mockRange[0].deliver([old('j1')]));
    expect(hook.result.current.logs.filter((l) => l.id?.startsWith('j')).map((l) => l.id)).toEqual(['j1']);

    // Back to a month the window covers: the older month's listener closes.
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 8, 10)));
    expect(mockRange[0].unsub).toHaveBeenCalled();
    await hook.unmount();
  });

  it('a blurred History screen holds no month listener', async () => {
    const hook = await renderHook(() => useHistory());
    await act(async () => mockWindow!(fullWindow()));
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 5, 10)));
    mockFocus.focused = false;
    await hook.rerender({});
    expect(mockRange[0].unsub).toHaveBeenCalled();
    await hook.unmount();
  });
});

describe('4 — the milestones listener is focus-gated and counted', () => {
  it('opens through trackSubs, and a blurred Today drops it', async () => {
    const hook = await renderHook(() => useMilestones({ uid: 'u1', streak: 0, hasWeighIn: false, boundary: [] }));
    expect(mockTracked).toContain('Today milestones');
    await act(async () => mockMilestones!({}));
    expect(hook.result.current.ready).toBe(true);
    mockFocus.focused = false;
    await hook.rerender({});
    expect(mockMilestoneUnsub).toHaveBeenCalled();
    // The last answer is kept while blurred.
    expect(hook.result.current.ready).toBe(true);
    await hook.unmount();
  });

  it('an offline cache-only answer is not "nothing on file" — no evaluation runs on it', async () => {
    const hook = await renderHook(() => useMilestoneRecord('u1'));
    await act(async () => mockMilestones!({}, { fromCache: true }));
    expect(hook.result.current.ready).toBe(false);
    await act(async () => mockMilestones!({ 'first-weigh-in': new Date() }, { fromCache: false }));
    expect(hook.result.current.ready).toBe(true);
    expect(Object.keys(hook.result.current.earned)).toEqual(['first-weigh-in']);
    await hook.unmount();
  });
});
