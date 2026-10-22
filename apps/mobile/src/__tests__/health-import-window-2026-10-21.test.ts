import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState, type AppStateStatus } from 'react-native';
import { renderHook } from '@testing-library/react-native';
import { calendarDateKey, type HealthSample } from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';
import { mapBounded } from '@/lib/map-bounded';

/**
 * The Health import's cost (2026-10-21 perf audit). Every app open and EVERY
 * foreground, unthrottled, re-read 400 days of all five kinds from the OS
 * store, then four whole Firestore collections to diff against, then 90 days
 * of workouts and the newest 200 sessions — starting the same instant Today
 * opened its listeners, and writing one awaited document per changed day.
 *
 * Pinned here:
 *  - the automatic run is throttled to one per 15 min; a run someone asked for
 *    is not;
 *  - the full window is read on the first import, after a connect, for a
 *    different account, on *Sync now* and weekly — otherwise only since the
 *    last completed run, minus three days of overlap;
 *  - an incremental run bounds the Firestore read to its window and never
 *    applies the partial day at the window's edge;
 *  - the session read for the workout merge starts at the oldest block;
 *  - the launch run waits past Today's first paint.
 */

// `jest.setup.js` stubs this module for every screen test; this one tests it.
jest.unmock('@/lib/health-sync');

let mockSamples: Partial<Record<string, HealthSample[]>> = {};
const mockReadSamples = jest.fn((kind: string, _days: number) => Promise.resolve(mockSamples[kind] ?? []));
const mockReadWorkouts = jest.fn(async (_days: number) => [] as unknown[]);
jest.mock('@/lib/health', () => ({
  health: {
    readSamples: (kind: string, days: number) => mockReadSamples(kind, days),
    readWorkouts: (days: number) => mockReadWorkouts(days),
    requestPermissions: () => Promise.resolve(true),
  },
}));

const mockGetScalars = jest.fn(async (_uid: string, _since?: string) => ({
  weight: {}, sleep: {}, water: {}, steps: {}, activeEnergy: {},
}));
const mockWriteScalars = jest.fn(async (_uid: string, _kind: string, _days: Record<string, number>) => undefined);
const mockImportDailySleep = jest.fn(async () => true);
const mockSessionsSince = jest.fn(async (_uid: string, _since: Date, _n: number) => []);
jest.mock('@/lib/ledger', () => ({
  getDayBoundaryOnce: jest.fn().mockResolvedValue([]),
  getHealthScalarsOnce: (uid: string, since?: string) => mockGetScalars(uid, since),
  getRecentSessionsSince: (uid: string, since: Date, n: number) => mockSessionsSince(uid, since, n),
  getHealthTombstones: jest.fn(async () => new Set<string>()),
  importDailySleep: (...a: unknown[]) => mockImportDailySleep(...(a as [])),
  startSession: jest.fn(async () => 'new'),
  updateSession: jest.fn(),
  writeHealthScalars: (uid: string, kind: string, days: Record<string, number>) => mockWriteScalars(uid, kind, days),
}));
jest.mock('@/lib/pending-body', () => ({ flushPendingBody: jest.fn().mockResolvedValue(0) }));

import {
  HR_BACKFILL_KEY,
  autoImportDue,
  connectHealth,
  importAll,
  importHealth,
  importWindow,
  sessionsSince,
  useHealthAutoImport,
  writeImportedBlocks,
} from '@/lib/health-sync';

const DAY_MS = 86_400_000;
const NOW = new Date(2026, 9, 21, 9, 0).getTime();
const key = (msAgo: number) => calendarDateKey(new Date(NOW - msAgo));
const weight = (dateKey: string, value = 180): HealthSample => ({
  dateKey, kind: 'weight', value, endMs: NOW - 1_000, fromUs: false, source: 'com.withings.wiscale2',
});

let nowSpy: jest.SpyInstance<number, []>;
const setNow = (ms: number) => nowSpy.mockReturnValue(ms);

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('ignia.health.connected', '1');
  // The one-time HR backfill (a year of workouts) is its own test's subject.
  await AsyncStorage.setItem(HR_BACKFILL_KEY, '1');
  mockSamples = {};
  jest.clearAllMocks();
  nowSpy = jest.spyOn(Date, 'now').mockReturnValue(NOW);
});

afterEach(() => nowSpy.mockRestore());

/** The `days` each kind was read with, for the most recent run. */
const daysRead = () => mockReadSamples.mock.calls.slice(-5).map((c) => c[1]);

describe('importWindow — pure', () => {
  const mark = (atAgo: number, fullAgo = atAgo) => ({ atMs: NOW - atAgo, fullAtMs: NOW - fullAgo });

  it('no mark, or asked for it → the full window', () => {
    expect(importWindow(null, 400, NOW)).toEqual({ days: 400, full: true });
    expect(importWindow(mark(60_000), 400, NOW, { full: true })).toEqual({ days: 400, full: true });
  });

  it('a run minutes ago → one day plus three of overlap', () => {
    expect(importWindow(mark(60_000), 400, NOW)).toEqual({ days: 4, full: false });
  });

  it('two and a half days ago → rounded up, plus the overlap', () => {
    expect(importWindow(mark(2.5 * DAY_MS, 3 * DAY_MS), 400, NOW)).toEqual({ days: 6, full: false });
  });

  it('a full read a week old → full again, however recent the last run', () => {
    expect(importWindow(mark(60_000, 7 * DAY_MS), 400, NOW)).toEqual({ days: 400, full: true });
  });

  it('a clock that reads earlier than the mark cannot bound anything → full', () => {
    expect(importWindow(mark(-DAY_MS), 400, NOW)).toEqual({ days: 400, full: true });
  });

  it('never under minDays; never past the full window', () => {
    expect(importWindow(mark(60_000), 90, NOW, { minDays: 7 })).toEqual({ days: 7, full: false });
    expect(importWindow(mark(6 * DAY_MS, 6.5 * DAY_MS), 5, NOW)).toEqual({ days: 5, full: true });
  });
});

describe('the automatic run is throttled; an asked-for one is not', () => {
  it('a second foreground inside 15 min reads nothing; after it, it runs', async () => {
    await importAll('u1', { auto: true });
    expect(mockReadSamples).toHaveBeenCalledTimes(5);
    setNow(NOW + 14 * 60_000);
    expect(await importAll('u1', { auto: true })).toBe(0);
    expect(mockReadSamples).toHaveBeenCalledTimes(5);
    expect(mockReadWorkouts).toHaveBeenCalledTimes(1);
    setNow(NOW + 16 * 60_000);
    await importAll('u1', { auto: true });
    expect(mockReadSamples).toHaveBeenCalledTimes(10);
  });

  it('pull to refresh / Sync now right after a foreground still runs', async () => {
    await importAll('u1', { auto: true });
    setNow(NOW + 60_000);
    await importAll('u1');
    expect(mockReadSamples).toHaveBeenCalledTimes(10);
  });

  it('a scalar-only run (Body refresh) does not hold back the workouts', async () => {
    await importHealth('u1');
    expect(await autoImportDue('u1')).toBe(true);
    await importAll('u1', { auto: true });
    expect(mockReadWorkouts).toHaveBeenCalledTimes(1);
  });

  it('another account on the same phone is never throttled by this one', async () => {
    await importAll('u1', { auto: true });
    expect(await autoImportDue('u2')).toBe(true);
  });
});

describe('the window', () => {
  it('first import: 400 days and every stored day; the next: since the last run, Firestore bounded too', async () => {
    await importAll('u1');
    expect(daysRead()).toEqual([400, 400, 400, 400, 400]);
    expect(mockGetScalars).toHaveBeenLastCalledWith('u1', undefined);
    expect(mockReadWorkouts).toHaveBeenLastCalledWith(90);

    setNow(NOW + 60 * 60_000);
    await importAll('u1');
    // ceil(1 h) = 1 day, + 3 of overlap = 4; read 2 more so day one is whole.
    expect(daysRead()).toEqual([6, 6, 6, 6, 6]);
    expect(mockGetScalars).toHaveBeenLastCalledWith('u1', calendarDateKey(new Date(NOW + 60 * 60_000 - 4 * DAY_MS)));
    expect(mockReadWorkouts).toHaveBeenLastCalledWith(7);
  });

  it('the partial day at the edge of an incremental read is not applied', async () => {
    await importAll('u1');
    mockWriteScalars.mockClear();
    // An hour later: a 4-day window, read as 6.
    setNow(NOW + 60 * 60_000);
    const since = key(4 * DAY_MS);
    const edge = key(5 * DAY_MS);
    mockSamples.weight = [weight(edge, 170), weight(since, 181)];
    await importAll('u1');
    expect(mockWriteScalars).toHaveBeenCalledWith('u1', 'weight', { [since]: 181 });
  });

  it('a week after the last full read, the full window again', async () => {
    await importAll('u1');
    for (let d = 1; d <= 6; d++) {
      setNow(NOW + d * DAY_MS);
      await importAll('u1');
      expect(daysRead()[0]).toBe(6);
    }
    setNow(NOW + 7 * DAY_MS);
    await importAll('u1');
    expect(daysRead()).toEqual([400, 400, 400, 400, 400]);
  });

  it('Sync now (`full`) reads the full window', async () => {
    await importAll('u1');
    await importAll('u1', { full: true });
    expect(daysRead()).toEqual([400, 400, 400, 400, 400]);
    expect(mockGetScalars).toHaveBeenLastCalledWith('u1', undefined);
  });

  it('a (re)connect starts over from the full window', async () => {
    await importAll('u1');
    await connectHealth();
    await importAll('u1');
    expect(daysRead()).toEqual([400, 400, 400, 400, 400]);
  });

  it('a different account is a first import', async () => {
    await importAll('u1');
    await importAll('u2');
    expect(daysRead()).toEqual([400, 400, 400, 400, 400]);
  });

  it('a run that fails does not move the window', async () => {
    await importAll('u1');
    setNow(NOW + 2 * DAY_MS);
    mockReadSamples.mockRejectedValueOnce(new Error('locked'));
    await expect(importAll('u1')).rejects.toThrow('locked');
    await importAll('u1');
    // Still measured from NOW: ceil(2 d) + 3 = 5, + 2 slack.
    expect(daysRead()).toEqual([7, 7, 7, 7, 7]);
  });
});

describe('writes', () => {
  it('one batched write per kind, sleep through its per-night guard', async () => {
    const today = key(0);
    const yday = key(DAY_MS);
    mockSamples = {
      weight: [weight(today, 180), weight(yday, 181)],
      steps: [{ dateKey: today, kind: 'steps', value: 4000, endMs: NOW, fromUs: false }],
      sleep: [{ dateKey: today, kind: 'sleep', value: 7, endMs: NOW - 3 * 3_600_000, fromUs: false }],
    };
    const n = await importAll('u1');
    expect(mockWriteScalars).toHaveBeenCalledWith('u1', 'weight', { [today]: 180, [yday]: 181 });
    expect(mockWriteScalars).toHaveBeenCalledWith('u1', 'steps', { [today]: 4000 });
    // An empty kind writes nothing at all.
    expect(mockWriteScalars).toHaveBeenCalledTimes(2);
    expect(mockImportDailySleep).toHaveBeenCalledWith('u1', today, 7, expect.objectContaining({ wakeAt: NOW - 3 * 3_600_000 }));
    expect(n).toBe(4);
  });
});

describe('the workout merge reads sessions from the oldest block, not the newest 200', () => {
  const block = (startedAt?: Date): CardioBlock =>
    ({ modality: 'run', durationSec: 1800, source: 'health', provider: 'other', sourceId: String(startedAt?.getTime()), startedAt }) as CardioBlock;

  it('sessionsSince: two days before the oldest block; a block with no start is now', () => {
    const a = new Date(NOW - 10 * DAY_MS);
    expect(sessionsSince([block(new Date(NOW - DAY_MS)), block(a)], NOW)).toEqual(new Date(a.getTime() - 2 * DAY_MS));
    expect(sessionsSince([block(undefined), block(new Date(Number.NaN))], NOW)).toEqual(new Date(NOW - 2 * DAY_MS));
  });

  it('writeImportedBlocks passes that bound to the read', async () => {
    const a = new Date(NOW - 3 * DAY_MS);
    await writeImportedBlocks('u1', [block(a)]);
    expect(mockSessionsSince).toHaveBeenCalledWith('u1', new Date(a.getTime() - 2 * DAY_MS), 200);
  });
});

describe('mapBounded', () => {
  it('keeps order and never has more than `limit` in flight', async () => {
    let live = 0;
    let peak = 0;
    const out = await mapBounded([5, 1, 4, 2, 3, 0], 2, async (ms, i) => {
      live++;
      peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, ms));
      live--;
      return i;
    });
    expect(out).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peak).toBe(2);
  });

  it('rejects like Promise.all and starts nothing new after a failure', async () => {
    const seen: number[] = [];
    await expect(
      mapBounded([0, 1, 2, 3], 1, async (n) => {
        seen.push(n);
        if (n === 1) throw new Error('no');
        return n;
      }),
    ).rejects.toThrow('no');
    expect(seen).toEqual([0, 1]);
  });
});

describe('useHealthAutoImport waits past the first paint', () => {
  let listener: ((s: AppStateStatus) => void) | undefined;
  // `setImmediate` is left real, so a flush drains every promise chain the
  // import starts (AsyncStorage, the mocked reads) without moving the clock.
  const flush = async () => {
    for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r));
  };

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['Date', 'setImmediate'] });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
      listener = cb as (s: AppStateStatus) => void;
      return { remove: jest.fn() } as never;
    });
  });
  afterEach(async () => {
    jest.useRealTimers();
    (AppState.addEventListener as jest.Mock).mockRestore();
    // Let a started import finish, or its in-flight flag no-ops the next test.
    await new Promise((r) => setTimeout(r, 20));
  });

  it('nothing at mount; the import after 3 s and an idle frame', async () => {
    renderHook(() => useHealthAutoImport('u1'));
    await flush();
    jest.advanceTimersByTime(2_999);
    await flush();
    expect(mockReadSamples).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    jest.runOnlyPendingTimers(); // the idle frame
    await flush();
    expect(mockReadSamples).toHaveBeenCalled();
  });

  it('going to the background before the launch run cancels it', async () => {
    renderHook(() => useHealthAutoImport('u1'));
    await flush(); // the effect is mounted
    listener?.('background');
    jest.advanceTimersByTime(5_000);
    jest.runOnlyPendingTimers();
    await flush();
    expect(mockReadSamples).not.toHaveBeenCalled();
    // …and coming back runs it, on an idle frame.
    listener?.('active');
    jest.runOnlyPendingTimers();
    await flush();
    expect(mockReadSamples).toHaveBeenCalled();
  });
});
