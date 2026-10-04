/**
 * Ending a fast is undoable: `breakFast` hands back a receipt and
 * `undoBreakFast` reverses exactly what it wrote.
 *
 * The two halves have to agree on one thing — the id of the archived document
 * — and the only place that id exists is the ref `breakFast` mints before its
 * commit. So this file pins the round trip: the receipt names that ref, and the
 * undo batch deletes it and restores the ORIGINAL start (not "now", which would
 * silently shorten the fast being rescued). Same hand-built Firestore mock as
 * `fasting-archive-write.test.ts`, for the same ESM reason given there.
 */
const mockCommit = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();
const mockGetDoc = jest.fn();

jest.mock('firebase/firestore', () => {
  // Inside the factory: `jest.mock` is hoisted above module-scope classes.
  class Ts {
    at: Date;
    constructor(at: Date) {
      this.at = at;
    }
    toDate(): Date {
      return this.at;
    }
    static now(): Ts {
      return new Ts(new Date('2026-08-25T12:00:00.000Z'));
    }
    static fromDate(at: Date): Ts {
      return new Ts(at);
    }
  }
  return {
    setDoc: jest.fn(),
    updateDoc: jest.fn(),
    deleteDoc: jest.fn(),
    doc: (...a: unknown[]) => {
      const [first, ...rest] = a as [{ path?: string }, ...unknown[]];
      if (!rest.length && first && typeof first.path === 'string') {
        return { path: first.path, id: 'generated-id' };
      }
      const parts = rest.map(String);
      return { path: parts.join('/'), id: parts[parts.length - 1] };
    },
    collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
    writeBatch: () => ({
      set: mockBatchSet,
      update: mockBatchUpdate,
      delete: mockBatchDelete,
      commit: mockCommit,
    }),
    deleteField: () => ({ __delete: true }),
    documentId: () => '__name__',
    getDoc: (...a: unknown[]) => mockGetDoc(...(a as [])),
    getDocs: jest.fn(),
    increment: jest.fn(),
    limit: jest.fn(),
    onSnapshot: jest.fn(),
    orderBy: jest.fn(),
    query: jest.fn(),
    serverTimestamp: jest.fn(),
    where: jest.fn(),
    Timestamp: Ts,
  };
});

jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { breakFast, undoBreakFast } from '@/lib/ledger';

const { Timestamp: MockTimestamp } = jest.requireMock('firebase/firestore') as {
  Timestamp: { fromDate(d: Date): { toDate(): Date } };
};

const UID = 'u1';
const START = new Date('2026-08-24T20:00:00.000Z');
const END = new Date('2026-08-25T12:00:00.000Z');

beforeEach(() => {
  mockCommit.mockReset().mockResolvedValue(undefined);
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  mockBatchDelete.mockReset();
  mockGetDoc.mockReset();
});

describe('ending a fast can be undone', () => {
  it('breakFast returns the archived id and the start it cleared', async () => {
    mockGetDoc.mockResolvedValue({ data: () => ({ fastStartedAt: MockTimestamp.fromDate(START) }) });
    const receipt = await breakFast(UID, END);
    expect(receipt.fastId).toBe('generated-id');
    expect(receipt.startedAt?.toISOString()).toBe(START.toISOString());
    // The id in the receipt is the document the batch wrote, not a second mint.
    expect(mockBatchSet.mock.calls[0][0].id).toBe(receipt.fastId);
  });

  it('names no document when the interval was not storable', async () => {
    // Ends before it starts — `isStorableFast` refuses, nothing is archived.
    mockGetDoc.mockResolvedValue({ data: () => ({ fastStartedAt: MockTimestamp.fromDate(END) }) });
    const receipt = await breakFast(UID, START);
    expect(receipt.fastId).toBeNull();
    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('undo deletes that document and restores the ORIGINAL start in one batch', async () => {
    await undoBreakFast(UID, { fastId: 'generated-id', startedAt: START });
    expect(mockBatchDelete).toHaveBeenCalledTimes(1);
    expect(mockBatchDelete.mock.calls[0][0].id).toBe('generated-id');
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate.mock.calls[0][1].fastStartedAt.toDate().toISOString()).toBe(
      START.toISOString(),
    );
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('undo restores the timer even when nothing was archived', async () => {
    await undoBreakFast(UID, { fastId: null, startedAt: START });
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
  });

  it('undo of a receipt with no running fast writes nothing', async () => {
    await undoBreakFast(UID, { fastId: null, startedAt: null });
    expect(mockCommit).not.toHaveBeenCalled();
  });
});
