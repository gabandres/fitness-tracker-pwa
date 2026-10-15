import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { PENDING_LOGS_KEY, PENDING_LOGS_MAX, buildPendingLog, serializePendingLogs } from '@macrolog/core';

/**
 * Audit 2026-10-15 — the quick-add adapter's remaining silent losses:
 *
 * - #16 a slot whose preset was deleted kept counting toward the cap, and a
 *   fourth pick evicted slot 1 (the one the Quick Settings tile fires) without
 *   a word. Dead slots are pruned; a real fourth pick is refused.
 * - #20 at the queue cap, a new park pushed the oldest UNSENT meal out.
 * - #21 a parked row the rules refuse on flush stayed in the queue, counted on
 *   Today for the 7-day TTL, then vanished. It is dropped and reported.
 * - #26 two widget taps at once each read the same snapshot and the second
 *   save erased the first tap's numbers.
 */

const mockAddLogWithId = jest.fn<Promise<void>, [string, string, unknown]>();
jest.mock('@/lib/ledger', () => ({
  addLogWithId: (...args: [string, string, unknown]) => mockAddLogWithId(...args),
  deleteLog: jest.fn(async () => undefined),
}));
jest.mock('@/lib/health-sync', () => ({ exportNutrition: jest.fn() }));
jest.mock('@/lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: () => () => {} },
}));

let mockSnapshot: Record<string, unknown> | null = null;
jest.mock('@/lib/widget', () => ({
  APP_GROUP: 'group.test',
  readWidgetSnapshot: async () => (mockSnapshot ? JSON.parse(JSON.stringify(mockSnapshot)) : null),
  saveWidgetSnapshot: async (s: Record<string, unknown>) => {
    // A real save is an async bridge hop; yield so two taps can interleave.
    await new Promise((r) => setTimeout(r, 0));
    mockSnapshot = s;
  },
  assertWatchSnapshot: jest.fn(),
}));

import {
  flushPendingLogs,
  getQuickAddSlots,
  parkPendingLog,
  performQuickAdd,
  readPendingLogs,
  setQuickAddSlots,
  toggleQuickAddSlot,
} from '@/lib/quick-add';
import { onPendingLogsRejected } from '@/lib/pending-logs-events';

beforeEach(async () => {
  jest.clearAllMocks();
  await AsyncStorage.clear();
  mockAddLogWithId.mockResolvedValue(undefined);
  Object.defineProperty(Platform, 'OS', { get: () => 'android', configurable: true });
});

describe('quick-add slots (#16)', () => {
  it('prunes slots whose preset no longer exists before counting the cap', async () => {
    await setQuickAddSlots(['gone', 'a', 'b']);
    expect(await toggleQuickAddSlot('c', ['a', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    expect(await getQuickAddSlots()).toEqual(['a', 'b', 'c']);
  });

  it('refuses a fourth live pick instead of evicting slot 1', async () => {
    await setQuickAddSlots(['a', 'b', 'c']);
    expect(await toggleQuickAddSlot('d', ['a', 'b', 'c', 'd'])).toEqual(['a', 'b', 'c']);
    expect(await getQuickAddSlots()).toEqual(['a', 'b', 'c']);
  });

  it('still toggles off at the cap', async () => {
    await setQuickAddSlots(['a', 'b', 'c']);
    expect(await toggleQuickAddSlot('a', ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});

describe('queue cap (#20)', () => {
  it('refuses a new row at the cap rather than dropping the oldest unsent one', async () => {
    const full = Array.from({ length: PENDING_LOGS_MAX }, (_, i) =>
      buildPendingLog(`id${i}`, 'u1', { calories: 100 }, Date.now()),
    );
    await AsyncStorage.setItem(PENDING_LOGS_KEY, serializePendingLogs(full));
    expect(await parkPendingLog(buildPendingLog('new', 'u1', { calories: 100 }, Date.now()))).toBe(false);
    const left = await readPendingLogs();
    expect(left).toHaveLength(PENDING_LOGS_MAX);
    expect(left[0].id).toBe('id0');
  });
});

describe('flush of a refused row (#21)', () => {
  it('drops a permission-denied row and reports it, keeping the transient failures', async () => {
    const now = Date.now();
    await AsyncStorage.setItem(
      PENDING_LOGS_KEY,
      serializePendingLogs([
        buildPendingLog('bad', 'u1', { calories: 100, mealLabel: 'Bad row' }, now),
        buildPendingLog('slow', 'u1', { calories: 100 }, now),
        buildPendingLog('ok', 'u1', { calories: 100 }, now),
      ]),
    );
    mockAddLogWithId.mockImplementation(async (_uid, id) => {
      if (id === 'bad') throw Object.assign(new Error('refused'), { code: 'permission-denied' });
      if (id === 'slow') throw new Error('offline');
    });
    const seen: string[][] = [];
    const off = onPendingLogsRejected((rows) => seen.push(rows.map((r) => r.mealLabel ?? r.id)));

    expect(await flushPendingLogs('u1', now)).toBe(1);
    off();

    expect((await readPendingLogs()).map((r) => r.id)).toEqual(['slow']);
    expect(seen).toEqual([['Bad row']]);
  });
});

describe('concurrent widget taps (#26)', () => {
  it('both taps move the snapshot, not just the last one', async () => {
    mockSnapshot = {
      v: 1,
      dateKey: new Date().toISOString().slice(0, 10),
      kcalConsumed: 1000,
      kcalTarget: 2000,
      proteinConsumed: 50,
      proteinTarget: 140,
      updatedMs: 1,
      locale: 'en',
      quickAdd: [{ presetId: 'p', name: 'Shake', calories: 200, protein: 30 }],
    };
    const at = new Date();
    const dateKey = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    mockSnapshot.dateKey = dateKey;
    await Promise.all([performQuickAdd(0, at), performQuickAdd(0, at)]);
    expect((mockSnapshot as { kcalConsumed: number }).kcalConsumed).toBe(1400);
  });
});
