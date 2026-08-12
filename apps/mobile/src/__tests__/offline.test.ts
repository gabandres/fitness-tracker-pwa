import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { PENDING_LOGS_KEY, parsePendingLogs } from '@macrolog/core';

/**
 * The offline layer — read cache, connectivity verdict, durable add.
 *
 * `packages/core` owns the queue's rules and tests them exhaustively. What is
 * only checkable here is the behaviour a user in a basement actually gets: does
 * a save survive the process, does the day still paint, and does the app say so.
 *
 * The read cache is tested through its own module rather than through
 * `useToday`, for the reason the jest config states: RNTL renders a tree but
 * runs no layout, so a hook test proves the wiring and not the screen. The
 * screen half belongs to Maestro.
 */

const mockAddLogWithId = jest.fn<Promise<void>, [string, string, unknown]>();

jest.mock('@/lib/ledger', () => ({
  addLogWithId: (...args: [string, string, unknown]) => mockAddLogWithId(...args),
}));

jest.mock('@/lib/health-sync', () => ({ exportNutrition: jest.fn() }));

jest.mock('../../modules/quick-add-tile', () => ({ setTileState: jest.fn() }));
jest.mock('../../modules/quick-add-credentials', () => ({
  setQuickAddCredentials: jest.fn(),
  clearQuickAddCredentials: jest.fn(),
}));
jest.mock('@/lib/widget', () => ({
  APP_GROUP: 'group.test',
  assertWatchSnapshot: jest.fn(),
  readWidgetSnapshot: jest.fn(),
  saveWidgetSnapshot: jest.fn(),
}));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: jest.fn() },
  onSessionTokenChanged: jest.fn(),
  NATIVE_REST_CONFIG: { apiKey: 'k', projectId: 'p' },
}));

import { isOffline, reportSnapshotMeta, resetConnectivity } from '@/lib/connectivity';
import { clearOfflineCache, readCache, writeCache } from '@/lib/offline-cache';
import { addLogDurably, pendingLogsAsRows } from '@/lib/pending-logs';

beforeEach(async () => {
  jest.useFakeTimers();
  // Re-installing fake timers does not discard what an earlier test queued, and
  // the cache's debounce is a real pending timer — without this, one test's
  // write-through fires inside the next one's clock advance and is counted
  // against it.
  jest.clearAllTimers();
  mockAddLogWithId.mockReset();
  resetConnectivity();
  await AsyncStorage.clear();
  // `jest-expo` reports iOS, where the parked queue deliberately lives in the
  // App Group rather than AsyncStorage (a Swift App Intent cannot reach the
  // latter). That split is quick-add.test.ts's subject; here it would only
  // obscure what is being tested, so pin the AsyncStorage-backed platform.
  Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
});

afterEach(() => {
  jest.useRealTimers();
});

/** Let the debounced cache write fire and its promise settle. */
async function settleCacheWrite(): Promise<void> {
  jest.advanceTimersByTime(500);
  await Promise.resolve();
  await Promise.resolve();
}

describe('offline read cache', () => {
  it('reads back what it wrote, with Dates intact', async () => {
    // The failure this guards: JSON turns a Date into a string, and the crash
    // lands later in summarizeDay rather than here.
    const rows = [{ id: 'a', calories: 500, date: new Date('2026-08-12T12:00:00Z') }];
    writeCache('u1', 'logs', rows);
    await settleCacheWrite();

    const back = await readCache<typeof rows>('u1', 'logs');
    expect(back?.[0].date).toBeInstanceOf(Date);
    expect(back?.[0].date.toISOString()).toBe('2026-08-12T12:00:00.000Z');
    expect(back?.[0].calories).toBe(500);
  });

  it('is namespaced per account — B can never paint A’s day', async () => {
    writeCache('u1', 'logs', [{ id: 'a', calories: 500, date: new Date() }]);
    await settleCacheWrite();
    expect(await readCache('u2', 'logs')).toBeNull();
  });

  it('is a miss, not a crash, when the payload is corrupt', async () => {
    await AsyncStorage.setItem('ignia.cache.v1.u1.logs', '{trunc');
    expect(await readCache('u1', 'logs')).toBeNull();
  });

  it('coalesces a burst of writes into the last value', async () => {
    // `AsyncStorage` is already a jest mock (jest.setup.js), so spyOn hands back
    // the existing fn complete with every earlier test's calls. Clear it, or
    // this asserts the file's history rather than this test's.
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    writeCache('u1', 'water', { d1: 1 });
    writeCache('u1', 'water', { d1: 2 });
    writeCache('u1', 'water', { d1: 3 });
    await settleCacheWrite();

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await readCache('u1', 'water')).toEqual({ d1: 3 });
    // No mockRestore: this is a jest.fn from the async-storage mock, not a spy
    // over a real method, so restoring it strips the implementation and every
    // later test in the file loses its storage.
    setItem.mockClear();
  });

  it('drops the account’s slices on sign-out, including one still in flight', async () => {
    writeCache('u1', 'logs', [{ id: 'a', calories: 500, date: new Date() }]);
    // Deliberately WITHOUT settling: a queued write that lands after the clear
    // would resurrect the data the clear existed to remove.
    await clearOfflineCache('u1');
    await settleCacheWrite();

    expect(await readCache('u1', 'logs')).toBeNull();
  });
});

describe('connectivity verdict', () => {
  it('does not flash offline on the first cache-first snapshot', () => {
    reportSnapshotMeta(true);
    expect(isOffline()).toBe(false);
    jest.advanceTimersByTime(1000);
    expect(isOffline()).toBe(false);
  });

  it('says offline once the cache-only snapshots persist', () => {
    reportSnapshotMeta(true);
    jest.advanceTimersByTime(5000);
    expect(isOffline()).toBe(true);
  });

  it('clears the moment one server snapshot arrives', () => {
    reportSnapshotMeta(true);
    jest.advanceTimersByTime(5000);
    expect(isOffline()).toBe(true);

    reportSnapshotMeta(false);
    expect(isOffline()).toBe(false);
  });

  it('decays to online when reports stop — a blurred tab is not a dead network', () => {
    // ADR-0016 detaches listeners on blur, so silence means "nobody is looking".
    // Claiming offline then would tell a connected user their meals are not
    // saving, which is the expensive direction to be wrong in.
    reportSnapshotMeta(true);
    jest.advanceTimersByTime(5000);
    expect(isOffline()).toBe(true);

    jest.advanceTimersByTime(31_000);
    expect(isOffline()).toBe(false);
  });
});

describe('addLogDurably', () => {
  const entry = { calories: 420, protein: 30, mealLabel: 'Rice bowl' };

  it('reports logged and parks nothing when the write lands', async () => {
    mockAddLogWithId.mockResolvedValue(undefined);

    const outcome = await addLogDurably('u1', entry);

    expect(outcome).toBe('logged');
    expect(parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY))).toEqual([]);
  });

  it('parks the row when the write rejects', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));

    const outcome = await addLogDurably('u1', entry);

    expect(outcome).toBe('queued');
    const parked = parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY));
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ uid: 'u1', calories: 420, mealLabel: 'Rice bowl' });
  });

  it('parks the row when the write neither resolves nor rejects', async () => {
    // The real offline shape: Firestore's setDoc waits indefinitely rather than
    // throwing, so without a deadline the catch never runs and the meal is
    // silently lost. This is the case that motivates the whole module.
    mockAddLogWithId.mockReturnValue(new Promise<void>(() => {}));

    const pending = addLogDurably('u1', entry);
    jest.advanceTimersByTime(9000);

    await expect(pending).resolves.toBe('queued');
    expect(parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY))).toHaveLength(1);
  });

  it('gives up faster when connectivity is already known bad', async () => {
    reportSnapshotMeta(true);
    jest.advanceTimersByTime(5000);
    expect(isOffline()).toBe(true);
    mockAddLogWithId.mockReturnValue(new Promise<void>(() => {}));

    const pending = addLogDurably('u1', entry);
    // Past the offline deadline but well inside the online one.
    jest.advanceTimersByTime(2000);

    await expect(pending).resolves.toBe('queued');
  });

  it('keeps the meal slot the user picked, so a late flush still files it right', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));

    await addLogDurably('u1', { ...entry, mealType: 'breakfast' });

    const parked = parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY));
    expect(parked[0].mealType).toBe('breakfast');
  });

  it('writes under the id the flush will use, so a replay cannot double-log', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));

    await addLogDurably('u1', entry);

    const attemptedId = mockAddLogWithId.mock.calls[0][1];
    const parked = parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY));
    expect(parked[0].id).toBe(attemptedId);
  });
});

describe('pendingLogsAsRows', () => {
  it('renders this account’s parked rows and nobody else’s', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    await addLogDurably('u1', { calories: 100, mealLabel: 'Mine' });
    await addLogDurably('u2', { calories: 200, mealLabel: 'Theirs' });

    const rows = await pendingLogsAsRows('u1');

    expect(rows).toHaveLength(1);
    expect(rows[0].mealLabel).toBe('Mine');
    expect(rows[0].date).toBeInstanceOf(Date);
  });
});
