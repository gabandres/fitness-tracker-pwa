/**
 * The ledger half of the 2026-10-21 Health import fix: the Firestore reads the
 * import diffs against are bounded to its window, and its writes go out as
 * batches.
 *
 *  - `getHealthScalarsOnce(uid, sinceKey)` reads `dateKey >= sinceKey` from
 *    each of the four collections; without `sinceKey` it reads them whole
 *    (only the full re-scan asks for that).
 *  - `writeHealthScalars` writes ≤ 500 days per batch, documents identical to
 *    the one-day writers', and falls back to those writers when the rules
 *    refuse a batch — so one bad day cannot sink the other 499.
 *  - `getRecentSessionsSince` bounds the session read from below.
 */
const mockGetDocs = jest.fn(async (_q: unknown) => ({ docs: [] as unknown[] }));
const mockSetDoc = jest.fn(async (_ref: unknown, _data: unknown, _opts?: unknown) => undefined);
type Batch = { ops: [string, unknown, unknown?][]; commit: jest.Mock };
const mockBatches: Batch[] = [];
let mockCommitFails = false;

// Hand-built, as in `ledger-write-annotation.test.ts`: the real package is ESM.
jest.mock('firebase/firestore', () => ({
  setDoc: (...a: [unknown, unknown, unknown?]) => mockSetDoc(...a),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: (...a: unknown[]) => {
    const parts = (a as unknown[]).slice(1).map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => {
    const b: Batch = {
      ops: [],
      commit: jest.fn(async () => {
        if (mockCommitFails) throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      }),
    };
    mockBatches.push(b);
    return {
      set: (ref: { path: string }, data: unknown, opts?: unknown) => b.ops.push([ref.path, data, opts]),
      update: jest.fn(),
      commit: b.commit,
    };
  },
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(),
  getDocs: (q: unknown) => mockGetDocs(q),
  limit: (n: number) => ({ limit: n }),
  onSnapshot: jest.fn(),
  orderBy: (f: string, d: string) => ({ orderBy: [f, d] }),
  query: (col: unknown, ...c: unknown[]) => ({ col, c }),
  where: (f: string, op: string, v: unknown) => ({ where: [f, op, v] }),
  Timestamp: {
    now: () => ({ toDate: () => new Date(0) }),
    fromDate: (d: Date) => ({ ms: d.getTime() }),
  },
}));
jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { getHealthScalarsOnce, getRecentSessionsSince, writeHealthScalars } from '@/lib/ledger';

beforeEach(() => {
  mockGetDocs.mockClear();
  mockSetDoc.mockClear();
  mockBatches.length = 0;
  mockCommitFails = false;
});

describe('getHealthScalarsOnce', () => {
  it('with a sinceKey: a documentId() range on every collection', async () => {
    await getHealthScalarsOnce('u1', '2026-10-17');
    expect(mockGetDocs).toHaveBeenCalledTimes(4);
    const paths = mockGetDocs.mock.calls.map(([q]) => (q as { col: { path: string } }).col.path).sort();
    expect(paths).toEqual(['users/u1/dailyActivity', 'users/u1/dailySleep', 'users/u1/dailyWater', 'users/u1/dailyWeights']);
    for (const [q] of mockGetDocs.mock.calls) {
      expect((q as { c: unknown[] }).c).toEqual([{ where: ['__name__', '>=', '2026-10-17'] }]);
    }
  });

  it('without one: the whole collections, as before (the full re-scan)', async () => {
    await getHealthScalarsOnce('u1');
    for (const [q] of mockGetDocs.mock.calls) expect(q).not.toHaveProperty('c');
  });
});

describe('writeHealthScalars', () => {
  const days = (n: number) =>
    Object.fromEntries(Array.from({ length: n }, (_, i) => [`2025-${String(1 + Math.floor(i / 28)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`, 180 + i / 10]));

  it('≤ 500 writes per batch, one commit each', async () => {
    await writeHealthScalars('u1', 'weight', days(600));
    expect(mockBatches.map((b) => b.ops.length)).toEqual([500, 100]);
    expect(mockBatches.every((b) => b.commit.mock.calls.length === 1)).toBe(true);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });

  it('documents match the one-day writers: clamps, rounding, merge', async () => {
    await writeHealthScalars('u1', 'water', { '2026-10-20': 900 });
    await writeHealthScalars('u1', 'steps', { '2026-10-20': 4000.6 });
    await writeHealthScalars('u1', 'activeEnergy', { '2026-10-20': 512.4 });
    await writeHealthScalars('u1', 'weight', { '2026-10-20': 180.2 });
    expect(mockBatches.map((b) => b.ops[0])).toEqual([
      ['users/u1/dailyWater/2026-10-20', { flOz: 676 }, undefined],
      ['users/u1/dailyActivity/2026-10-20', { steps: 4001 }, { merge: true }],
      ['users/u1/dailyActivity/2026-10-20', { activeKcal: 512 }, { merge: true }],
      ['users/u1/dailyWeights/2026-10-20', { weight: 180.2 }, undefined],
    ]);
  });

  it('a refused batch falls back to one write per day, in order, and throws at the first refusal', async () => {
    mockCommitFails = true;
    mockSetDoc
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' }));
    await expect(
      writeHealthScalars('u1', 'weight', { '2026-10-18': 180, '2026-10-19': 1200, '2026-10-20': 181 }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockSetDoc.mock.calls.map(([ref]) => (ref as { path: string }).path)).toEqual([
      'users/u1/dailyWeights/2026-10-18',
      'users/u1/dailyWeights/2026-10-19',
    ]);
  });

  it('nothing to write → no batch at all', async () => {
    await writeHealthScalars('u1', 'weight', {});
    expect(mockBatches).toHaveLength(0);
  });
});

describe('getRecentSessionsSince', () => {
  it('a timestamp floor, newest first, capped', async () => {
    const since = new Date(2026, 9, 1);
    await getRecentSessionsSince('u1', since, 200);
    const [q] = mockGetDocs.mock.calls[0] as [{ col: { path: string }; c: unknown[] }];
    expect(q.col.path).toBe('users/u1/workoutSessions');
    expect(q.c).toEqual([
      { where: ['timestamp', '>=', { ms: since.getTime() }] },
      { orderBy: ['timestamp', 'desc'] },
      { limit: 200 },
    ]);
  });
});
