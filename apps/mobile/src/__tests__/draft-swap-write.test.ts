/**
 * `commitDraftSwaps` — switching a superset draft on or back is ONE batch:
 * the live template's body and the draft doc together (2026-10-11).
 *
 * The revert removes the draft's `previous` with `deleteField()`. The first
 * build passed that sentinel through `pruneUndefined`, which rebuilds every
 * object it does not know is opaque; a rebuilt sentinel is a plain object
 * Firestore refuses, so every revert failed — found on the simulator, where
 * "Revert" said "Couldn't update the template". This pins that the sentinel
 * reaches the batch as the SAME object `deleteField()` returned.
 */
const mockCommit = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockBatchDelete = jest.fn();

jest.mock('firebase/firestore', () => {
  class Ts {
    at: Date;
    constructor(at: Date) {
      this.at = at;
    }
    toDate(): Date {
      return this.at;
    }
    static now(): Ts {
      return new Ts(new Date('2026-10-11T12:00:00.000Z'));
    }
    static fromDate(at: Date): Ts {
      return new Ts(at);
    }
  }
  // A class instance, not a literal: a rebuilt copy would still deep-equal a
  // literal and hide exactly the bug this file exists for.
  class DeleteSentinel {
    readonly kind = 'delete';
  }
  const sentinel = new DeleteSentinel();
  return {
    setDoc: jest.fn(),
    updateDoc: jest.fn(),
    deleteDoc: jest.fn(),
    doc: (...a: unknown[]) => {
      const parts = (a as unknown[]).slice(1).map(String);
      return { path: parts.join('/'), id: parts[parts.length - 1] };
    },
    collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
    writeBatch: () => ({ set: mockBatchSet, update: mockBatchUpdate, delete: mockBatchDelete, commit: mockCommit }),
    deleteField: () => sentinel,
    documentId: () => '__name__',
    getDoc: jest.fn(),
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
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn(), isOffline: () => false }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { commitDraftSwaps, deleteTemplateWithDraft } from '@/lib/ledger';

const { deleteField } = jest.requireMock('firebase/firestore') as { deleteField: () => unknown };
const body = (name: string) => ({ name, exercises: [{ exerciseId: 'e1', name: 'Bench', plannedSets: [], supersetGroup: undefined }] });
const AT = new Date('2026-10-11T16:00:00.000Z');

beforeEach(() => {
  mockCommit.mockReset().mockResolvedValue(undefined);
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
});

describe('commitDraftSwaps', () => {
  it('revert: the template body and the draft go in one commit, and `previous` is deleted with the real sentinel', async () => {
    await commitDraftSwaps('u1', [{ mode: 'revert', draftId: 'd1', templateId: 't1', body: body('Upper A'), kept: body('Upper A') }], AT);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet.mock.calls[0][0].path).toBe('users/u1/workoutTemplates/t1');
    const [ref, patch] = mockBatchUpdate.mock.calls[0];
    expect(ref.path).toBe('users/u1/templateDrafts/d1');
    expect(patch.status).toBe('draft');
    expect(patch.previous).toBe(deleteField());
    expect(patch.revertedAt).toBe(AT.toISOString());
  });

  it('activate: keeps the replaced body for the way back, with no undefined left in it', async () => {
    await commitDraftSwaps('u1', [{ mode: 'activate', draftId: 'd1', templateId: 't1', body: body('Upper A'), kept: body('Upper A') }], AT);
    const [, patch] = mockBatchUpdate.mock.calls[0];
    expect(patch.status).toBe('active');
    expect(patch.previous).toEqual({ name: 'Upper A', exercises: [{ exerciseId: 'e1', name: 'Bench', plannedSets: [] }] });
  });

  it('several drafts switch in ONE batch', async () => {
    await commitDraftSwaps('u1', [
      { mode: 'activate', draftId: 'd1', templateId: 't1', body: body('Push'), kept: body('Push') },
      { mode: 'activate', draftId: 'd2', templateId: 't2', body: body('Leg'), kept: body('Leg') },
    ], AT);
    expect(mockCommit).toHaveBeenCalledTimes(1);
    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
  });
});

describe('a refusal after the wait window is still heard', () => {
  it('late: the screen already said "switched", so onLateFailure fires once', async () => {
    jest.useFakeTimers();
    try {
      let reject!: (e: Error) => void;
      mockCommit.mockReturnValue(new Promise<void>((_, r) => { reject = r; }));
      const late = jest.fn();
      const done = commitDraftSwaps('u1', [{ mode: 'revert', draftId: 'd1', templateId: 't1', body: body('A'), kept: body('A') }], AT, late);
      await jest.advanceTimersByTimeAsync(4100);
      await done;
      reject(new Error('permission-denied'));
      await Promise.resolve();
      await Promise.resolve();
      expect(late).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it('in the window: the call itself rejects, and onLateFailure stays quiet', async () => {
    mockCommit.mockRejectedValue(new Error('permission-denied'));
    const late = jest.fn();
    await expect(commitDraftSwaps('u1', [{ mode: 'revert', draftId: 'd1', templateId: 't1', body: body('A'), kept: body('A') }], AT, late)).rejects.toThrow();
    await Promise.resolve();
    expect(late).not.toHaveBeenCalled();
  });
});

describe('deleteTemplateWithDraft', () => {
  it('deletes the template and its draft in ONE commit — never a template gone with its draft left behind', async () => {
    await deleteTemplateWithDraft('u1', 'leg', 'd-leg');
    expect(mockBatchDelete).toHaveBeenCalledTimes(2);
    expect(mockBatchDelete.mock.calls.map(([ref]) => ref.path)).toEqual([
      expect.stringContaining('leg'),
      expect.stringContaining('templateDrafts/d-leg'),
    ]);
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });
});
