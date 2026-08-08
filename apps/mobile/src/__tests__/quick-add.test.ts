import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { PENDING_LOGS_KEY, type QuickAddTarget, parsePendingLogs } from '@macrolog/core';

/**
 * The quick-add adapter (ADR-0020) — the wiring no other layer can cover.
 *
 * `packages/core` owns and exhaustively tests the *rules* (slot resolution, the
 * queue, the minted id). What is only checkable here is the behaviour under a
 * failed write and a missing session, because that is where auth, storage and
 * the ledger meet — and it is the behaviour a user in a basement actually gets.
 */

// `mock`-prefixed so jest's out-of-scope-variable guard allows the factories
// below to close over them.
const mockAddLogWithId = jest.fn<Promise<void>, [string, string, unknown]>();
const mockExportNutrition = jest.fn();
const mockAuth: {
  user: { uid: string } | null;
  listener: ((u: { uid: string } | null) => void) | null;
} = { user: { uid: 'u1' }, listener: null };

jest.mock('@/lib/ledger', () => ({
  addLogWithId: (...args: [string, string, unknown]) => mockAddLogWithId(...args),
}));

jest.mock('@/lib/health-sync', () => ({
  exportNutrition: (...args: unknown[]) => mockExportNutrition(...args),
}));

// The iOS App Group container. On iOS the pending queue lives here rather than
// in AsyncStorage, because the writer is a Swift App Intent with no JS in its
// process — see `pendingStore` in `src/lib/quick-add.ts`.
const mockAppGroup = new Map<string, string | undefined>();

jest.mock('@bacons/apple-targets', () => ({
  ExtensionStorage: class {
    get(key: string) {
      return mockAppGroup.get(key);
    }
    set(key: string, value: string | undefined) {
      if (value === undefined) mockAppGroup.delete(key);
      else mockAppGroup.set(key, value);
    }
    static reloadWidget() {}
  },
}));

jest.mock('@/lib/firebase', () => ({
  db: {},
  auth: {
    get currentUser() {
      return mockAuth.user;
    },
    onAuthStateChanged: (cb: (u: { uid: string } | null) => void) => {
      mockAuth.listener = cb;
      return () => {
        mockAuth.listener = null;
      };
    },
  },
}));

const target: QuickAddTarget = { presetId: 'p1', name: 'Protein shake', calories: 180, protein: 32 };

// Imported after the mocks are registered.
import {
  clearQuickAdd,
  flushPendingLogs,
  getQuickAddSlots,
  logQuickAdd,
  readPendingLogs,
  setQuickAddSlots,
  subscribeQuickAddSlots,
  toggleQuickAddSlot,
} from '@/lib/quick-add';

beforeEach(async () => {
  jest.clearAllMocks();
  mockAuth.user = { uid: 'u1' };
  mockAuth.listener = null;
  await AsyncStorage.clear();
  mockAppGroup.clear();
  mockAddLogWithId.mockResolvedValue(undefined);
  // jest-expo runs this suite as iOS. The queue tests below are about the shared
  // logic, so they pin Android (AsyncStorage); the App-Group path has its own
  // block at the bottom.
  setPlatform('android');
});

/** `Platform.OS` is read at call time inside `pendingStore`, so overriding the
 *  property is enough and no module reset is needed. */
function setPlatform(os: 'ios' | 'android') {
  Object.defineProperty(Platform, 'OS', { get: () => os, configurable: true });
}

describe('slots', () => {
  it('round-trips through device storage', async () => {
    await setQuickAddSlots(['a', 'b']);
    expect(await getQuickAddSlots()).toEqual(['a', 'b']);
  });

  it('caps what it stores at three', async () => {
    await setQuickAddSlots(['a', 'b', 'c', 'd']);
    expect(await getQuickAddSlots()).toEqual(['a', 'b', 'c']);
  });

  it('toggles on and off, keeping pick order', async () => {
    expect(await toggleQuickAddSlot('a')).toEqual(['a']);
    expect(await toggleQuickAddSlot('b')).toEqual(['a', 'b']);
    expect(await toggleQuickAddSlot('a')).toEqual(['b']);
  });

  it('drops the oldest pick at the cap instead of refusing the tap', async () => {
    await setQuickAddSlots(['a', 'b', 'c']);
    expect(await toggleQuickAddSlot('d')).toEqual(['b', 'c', 'd']);
  });

  it('notifies subscribers, which is how Settings reaches the home screen', async () => {
    const seen: string[][] = [];
    const unsub = subscribeQuickAddSlots((ids) => seen.push(ids));
    await toggleQuickAddSlot('a');
    unsub();
    await toggleQuickAddSlot('b');
    expect(seen).toEqual([['a']]);
  });

  it('survives hand-corrupted storage', async () => {
    await AsyncStorage.setItem('ignia.quickAdd.slots.v1', '{not json');
    expect(await getQuickAddSlots()).toEqual([]);
  });
});

describe('logQuickAdd', () => {
  it('writes the row at a caller-minted id', async () => {
    expect(await logQuickAdd(target)).toBe('logged');
    expect(mockAddLogWithId).toHaveBeenCalledTimes(1);
    const [uid, id, entry] = mockAddLogWithId.mock.calls[0];
    expect(uid).toBe('u1');
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(entry).toMatchObject({ calories: 180, protein: 32, mealLabel: 'Protein shake' });
  });

  it('mirrors the meal to Health, like any in-app entry', async () => {
    await logQuickAdd(target);
    expect(mockExportNutrition).toHaveBeenCalledWith(expect.objectContaining({ kcal: 180, protein: 32 }));
  });

  it('leaves the queue empty on success', async () => {
    await logQuickAdd(target);
    expect(await readPendingLogs()).toEqual([]);
  });

  it('parks the write when the ledger rejects', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    expect(await logQuickAdd(target)).toBe('queued');
    const parked = await readPendingLogs();
    expect(parked).toHaveLength(1);
    expect(parked[0]).toMatchObject({ uid: 'u1', calories: 180, mealLabel: 'Protein shake' });
  });

  it('parks under the SAME id the failed attempt used — the retry is idempotent', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    await logQuickAdd(target);
    const attemptedId = mockAddLogWithId.mock.calls[0][1];
    expect((await readPendingLogs())[0].id).toBe(attemptedId);
  });

  it('keeps the tap time, so a flush tomorrow still lands on today', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    const at = new Date('2026-08-07T19:00:00Z');
    await logQuickAdd(target, at);
    expect((await readPendingLogs())[0].atMs).toBe(at.getTime());
  });

  it('writes NOTHING when signed out — an unattributable row is worse than a lost tap', async () => {
    mockAuth.user = null;
    const result = logQuickAdd(target);
    mockAuth.listener?.(null);
    expect(await result).toBe('signed-out');
    expect(mockAddLogWithId).not.toHaveBeenCalled();
    expect(await readPendingLogs()).toEqual([]);
  });

  it('waits for auth to rehydrate rather than reading a cold currentUser as signed out', async () => {
    mockAuth.user = null;
    const result = logQuickAdd(target);
    // What a headless widget task looks like: `currentUser` is null for the
    // first tick, then AsyncStorage persistence resolves the session.
    mockAuth.listener?.({ uid: 'u1' });
    expect(await result).toBe('logged');
    expect(mockAddLogWithId).toHaveBeenCalledWith('u1', expect.any(String), expect.anything());
  });
});

describe('flushPendingLogs', () => {
  async function park(n: number) {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < n; i++) await logQuickAdd({ ...target, calories: 100 + i });
    mockAddLogWithId.mockReset();
    mockAddLogWithId.mockResolvedValue(undefined);
  }

  it('lands every parked write and empties the queue', async () => {
    await park(3);
    expect(await flushPendingLogs('u1')).toBe(3);
    expect(mockAddLogWithId).toHaveBeenCalledTimes(3);
    expect(await readPendingLogs()).toEqual([]);
  });

  it('is a no-op with nothing parked', async () => {
    expect(await flushPendingLogs('u1')).toBe(0);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
  });

  it('keeps a row that still fails, and does not block the ones after it', async () => {
    await park(3);
    mockAddLogWithId.mockRejectedValueOnce(new Error('still offline'));
    expect(await flushPendingLogs('u1')).toBe(2);
    expect(await readPendingLogs()).toHaveLength(1);
  });

  it('drops another account’s parked rows without writing them', async () => {
    await park(2);
    expect(await flushPendingLogs('someone-else')).toBe(0);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
    expect(await readPendingLogs()).toEqual([]);
  });

  it('drops rows past the TTL', async () => {
    await park(1);
    const eightDays = Date.now() + 8 * 24 * 60 * 60 * 1000;
    expect(await flushPendingLogs('u1', eightDays)).toBe(0);
    expect(await readPendingLogs()).toEqual([]);
  });

  it('re-flushing after a full success writes nothing', async () => {
    await park(2);
    await flushPendingLogs('u1');
    mockAddLogWithId.mockClear();
    expect(await flushPendingLogs('u1')).toBe(0);
    expect(mockAddLogWithId).not.toHaveBeenCalled();
  });
});

describe('clearQuickAdd', () => {
  it('drops the queue and the slots on sign-out', async () => {
    await setQuickAddSlots(['a']);
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    await logQuickAdd(target);
    expect(parsePendingLogs(await AsyncStorage.getItem(PENDING_LOGS_KEY))).toHaveLength(1);

    await clearQuickAdd();

    expect(await getQuickAddSlots()).toEqual([]);
    expect(await readPendingLogs()).toEqual([]);
  });
});

// ─── The queue lives in a different store on iOS ────────────────
// A Swift App Intent parks failed writes into the App Group, because it has no
// access to AsyncStorage. If the JS flush read the wrong store, every iOS
// quick-add would appear to queue and then never land — with nothing to see.

describe('pending queue on iOS', () => {
  beforeEach(() => setPlatform('ios'));

  it('parks into the App Group, not AsyncStorage', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    expect(await logQuickAdd(target)).toBe('queued');

    expect(parsePendingLogs(mockAppGroup.get(PENDING_LOGS_KEY) ?? null)).toHaveLength(1);
    expect(await AsyncStorage.getItem(PENDING_LOGS_KEY)).toBeNull();
  });

  it('reads back what Swift would have written there', async () => {
    // Byte-for-byte the shape `QuickAdd.park` emits in Swift.
    mockAppGroup.set(
      PENDING_LOGS_KEY,
      JSON.stringify([
        { v: 1, id: 'fromSwift0000000000', uid: 'u1', calories: 210, mealLabel: 'Three eggs', atMs: 1_760_000_000_000 },
      ]),
    );
    expect(await readPendingLogs()).toHaveLength(1);
    expect(await flushPendingLogs('u1', 1_760_000_100_000)).toBe(1);
    expect(mockAddLogWithId).toHaveBeenCalledWith('u1', 'fromSwift0000000000', expect.objectContaining({ calories: 210 }));
  });

  it('empties the App Group when everything lands', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    await logQuickAdd(target);
    mockAddLogWithId.mockReset();
    mockAddLogWithId.mockResolvedValue(undefined);

    await flushPendingLogs('u1');
    expect(mockAppGroup.get(PENDING_LOGS_KEY)).toBeUndefined();
  });

  it('sign-out clears the App Group queue too', async () => {
    mockAddLogWithId.mockRejectedValue(new Error('offline'));
    await logQuickAdd(target);
    await clearQuickAdd();
    expect(mockAppGroup.get(PENDING_LOGS_KEY)).toBeUndefined();
  });
});
