import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DailyLog, Measurement, Profile } from '@macrolog/core';
import { writeCache } from '@/lib/offline-cache';

/**
 * Cached paint for History, Trends and Body (UX_AUDIT S18-13).
 *
 * Today has painted the last session from disk since `offline-cache.ts`
 * landed; the other three tabs booted on a bare spinner — and offline, on a
 * spinner that never ended. Each hook below now hydrates the same slices
 * (`logs`, `weights`, `profile` are the SAME queries Today caches;
 * `measurements` is Body's own), so a cold open shows the last data at once
 * and the live snapshot replaces it. Follows `cached-state-provenance.test.ts`:
 * seed the disk, mount with listeners that never answer, assert the paint.
 *
 * The History half also covers the on-demand month fetch behind the 400-row
 * window: one `getDocs`, merged into `logs`, never repeated.
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
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
jest.mock('@/hooks/useLogWrites', () => ({ useLogWrites: () => ({}) }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn() }));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: jest.fn() }));

type Deliver<T> = (value: T, meta?: { fromCache: boolean }) => void;

/** Every listener the three hooks open, each holding its newest `deliver` so a
 *  test can push a snapshot through — or leave it silent, which is the point. */
const live: {
  logs?: Deliver<DailyLog[]>;
  weights?: Deliver<Record<string, number>>;
  profile?: Deliver<Profile | null>;
  measurements?: Deliver<Measurement[]>;
} = {};
const mockGetLogsForRange = jest.fn<Promise<DailyLog[]>, [string, string, string, unknown?]>();

jest.mock('@/lib/ledger', () => ({
  subscribeRecentLogs: (_uid: string, _n: number, cb: Deliver<DailyLog[]>) => {
    live.logs = cb;
    return () => {};
  },
  subscribeDailyWeights: (_uid: string, cb: Deliver<Record<string, number>>) => {
    live.weights = cb;
    return () => {};
  },
  subscribeProfile: (_uid: string, cb: Deliver<Profile | null>) => {
    live.profile = cb;
    return () => {};
  },
  subscribeMeasurements: (_uid: string, _n: number, cb: Deliver<Measurement[]>) => {
    live.measurements = cb;
    return () => {};
  },
  subscribePresets: () => () => {},
  subscribeCustomFoods: () => () => {},
  getLogsForRange: (...args: [string, string, string, unknown?]) => mockGetLogsForRange(...args),
}));

import { useHistory } from '@/hooks/useHistory';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';
import { useBody } from '@/hooks/useBody';

/** `writeCache` debounces by 400 ms; seed and let it land before mounting. */
async function seed(slice: 'logs' | 'weights' | 'profile' | 'measurements', v: unknown) {
  writeCache('u1', slice, v);
  await new Promise((r) => setTimeout(r, 600));
}

function row(id: string, iso: string, calories = 500): DailyLog {
  return { id, calories, date: new Date(iso) };
}

const PROFILE = { sex: 'male', heightIn: 70, age: 30 } as unknown as Profile;

beforeEach(async () => {
  await AsyncStorage.clear();
  delete live.logs;
  delete live.weights;
  delete live.profile;
  delete live.measurements;
  mockGetLogsForRange.mockReset();
});

describe('useHistory paints from disk', () => {
  it('ends the spinner on a cache hit while the listener is silent, with Dates intact', async () => {
    const cached = [row('a', '2026-09-20T12:00:00'), row('b', '2026-09-21T12:00:00')];
    await seed('logs', cached);
    await seed('weights', { '2026-09-21': 180 });

    const hook = await renderHook(() => useHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['a', 'b']);
    expect(hook.result.current.logs[0].date.getTime()).toBe(cached[0].date.getTime());
    expect(hook.result.current.weights).toEqual({ '2026-09-21': 180 });
    // The calendar's day list is derived from the paint, not left empty.
    expect(hook.result.current.days.map((d) => d.dateKey)).toEqual(['2026-09-21', '2026-09-20']);
  });

  it('an offline listener\'s empty cache snapshot does not clobber the paint', async () => {
    await seed('logs', [row('a', '2026-09-20T12:00:00')]);
    const hook = await renderHook(() => useHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    await act(async () => live.logs?.([], { fromCache: true }));
    expect(hook.result.current.logs).toHaveLength(1);
  });

  it('the live snapshot replaces the paint', async () => {
    await seed('logs', [row('stale', '2026-09-20T12:00:00')]);
    const hook = await renderHook(() => useHistory());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));

    await act(async () => live.logs?.([row('fresh', '2026-09-22T12:00:00')], { fromCache: false }));
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['fresh']);
  });

  it('stays on the spinner with no cache and no answer (nothing to show yet)', async () => {
    const hook = await renderHook(() => useHistory());
    await new Promise((r) => setTimeout(r, 50));
    expect(hook.result.current.loading).toBe(true);
  });
});

describe('useHistory fetches an older month on demand', () => {
  /** A full window, one row per day, newest first, ending on `oldest`. */
  function fullWindow(oldest: Date, n = 400): DailyLog[] {
    return Array.from({ length: n }, (_, i) => ({
      id: `w${i}`,
      calories: 500,
      date: new Date(oldest.getFullYear(), oldest.getMonth(), oldest.getDate() + (n - 1 - i), 12),
    }));
  }

  /** A promise the test settles by hand, so "in flight" is a state it can
   *  hold the hook in rather than race. */
  function deferred<T>() {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('runs ONE bounded query for a month behind the window, merges it, and never re-asks', async () => {
    const fetch = deferred<DailyLog[]>();
    mockGetLogsForRange.mockReturnValue(fetch.promise);
    const hook = await renderHook(() => useHistory());
    await act(async () => live.logs?.(fullWindow(new Date(2026, 8, 1)), { fromCache: false }));
    expect(hook.result.current.logs).toHaveLength(400);

    // The month the window covers needs nothing.
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 8, 15)));
    expect(mockGetLogsForRange).not.toHaveBeenCalled();

    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 7, 15)));
    expect(hook.result.current.olderMonths.loading).toBe(true);
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(1);
    expect(mockGetLogsForRange.mock.calls[0].slice(0, 3)).toEqual(['u1', '2026-08-01', '2026-08-31']);

    // A re-render mid-fetch (the effect re-asking) does not fire a second query.
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 7, 15)));
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(1);

    await act(async () => {
      fetch.resolve([row('aug1', '2026-08-03T09:00:00'), row('aug2', '2026-08-20T09:00:00')]);
      await fetch.promise;
    });
    await waitFor(() => expect(hook.result.current.olderMonths.loading).toBe(false));
    const ids = hook.result.current.logs.map((l) => l.id);
    expect(ids.slice(0, 2)).toEqual(['aug1', 'aug2']); // oldest first, ahead of the window
    expect(ids).toHaveLength(402);
    expect(hook.result.current.days.some((d) => d.dateKey === '2026-08-20')).toBe(true);

    // Paging away and back re-queries nothing.
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 8, 15)));
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 7, 15)));
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(1);
  });

  it('a failed fetch is reported and can be retried', async () => {
    mockGetLogsForRange.mockRejectedValueOnce(new Error('offline'));
    mockGetLogsForRange.mockResolvedValueOnce([]);
    const hook = await renderHook(() => useHistory());
    await act(async () => live.logs?.(fullWindow(new Date(2026, 8, 1)), { fromCache: false }));

    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 7, 15)));
    await waitFor(() => expect(hook.result.current.olderMonths.error).not.toBeNull());
    expect(hook.result.current.olderMonths.loading).toBe(false);

    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2026, 7, 15)));
    await waitFor(() => expect(hook.result.current.olderMonths.error).toBeNull());
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(2);
  });

  it('never queries while the window is not full — everything is already loaded', async () => {
    const hook = await renderHook(() => useHistory());
    await act(async () => live.logs?.(fullWindow(new Date(2026, 8, 1), 5), { fromCache: false }));
    await act(async () => hook.result.current.ensureMonthLoaded(new Date(2020, 0, 15)));
    expect(mockGetLogsForRange).not.toHaveBeenCalled();
  });
});

describe('useCoreSnapshot (Trends and Body inputs) paints from disk', () => {
  it('is loaded once all three slices hydrate, with the cached values in hand', async () => {
    await seed('logs', [row('a', '2026-09-20T12:00:00')]);
    await seed('weights', { '2026-09-20': 181 });
    await seed('profile', PROFILE);

    const hook = await renderHook(() => useCoreSnapshot('Test'));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));
    expect(hook.result.current.logs).toHaveLength(1);
    expect(hook.result.current.weights).toEqual({ '2026-09-20': 181 });
    expect(hook.result.current.profile).toMatchObject({ heightIn: 70 });
  });

  it('a PARTIAL paint does not count — a seed target over empty logs is the bug loaded guards', async () => {
    await seed('profile', PROFILE);
    const hook = await renderHook(() => useCoreSnapshot('Test'));
    await new Promise((r) => setTimeout(r, 50));
    expect(hook.result.current.profile).toMatchObject({ heightIn: 70 });
    expect(hook.result.current.loaded).toBe(false);
  });

  it('a server answer still loads it with an empty cache, and replaces a paint', async () => {
    await seed('logs', [row('stale', '2026-09-20T12:00:00')]);
    await seed('weights', {});
    await seed('profile', PROFILE);
    const hook = await renderHook(() => useCoreSnapshot('Test'));
    await waitFor(() => expect(hook.result.current.loaded).toBe(true));

    await act(async () => {
      live.logs?.([row('fresh', '2026-09-22T12:00:00')], { fromCache: false });
      live.weights?.({ '2026-09-22': 179 }, { fromCache: false });
      live.profile?.(PROFILE, { fromCache: false });
    });
    expect(hook.result.current.logs.map((l) => l.id)).toEqual(['fresh']);
    expect(hook.result.current.weights).toEqual({ '2026-09-22': 179 });
  });
});

describe('useBody paints its measurements from disk', () => {
  it('shows the cached tape rows before the listener answers', async () => {
    await seed('logs', []);
    await seed('weights', { '2026-09-20': 181 });
    await seed('profile', PROFILE);
    const rows: Measurement[] = [{ id: 'm1', date: new Date('2026-09-20T08:00:00'), waist: 34, neck: 15 }];
    await seed('measurements', rows);

    const hook = await renderHook(() => useBody());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.measurements).toHaveLength(1);
    expect(hook.result.current.measurements[0].date.getTime()).toBe(rows[0].date.getTime());
    expect(hook.result.current.weighIns).toEqual([{ dateKey: '2026-09-20', weight: 181 }]);
  });
});
