/**
 * "Day fully logged?" storage (2026-10-24): `users/{uid}/dailyLogged/{dateKey}
 * = { complete, updatedAt }`. Yes/No are writes of the whole doc (the rules
 * require both fields and a server `updatedAt`); unset is a DELETE, never a
 * third stored value; and the reader keeps only boolean answers.
 */
const mockSetDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockOnSnapshot = jest.fn();

jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => mockSetDoc(...(a as [])),
  updateDoc: jest.fn(),
  deleteDoc: (...a: unknown[]) => mockDeleteDoc(...(a as [])),
  doc: (...a: unknown[]) => {
    const parts = (a as unknown[]).slice(1).map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  serverTimestamp: () => ({ __serverTimestamp: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  onSnapshot: (...a: unknown[]) => mockOnSnapshot(...(a as [])),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  Timestamp: class {
    static now() { return { toDate: () => new Date(0) }; }
    static fromDate(d: Date) { return { toDate: () => d }; }
  },
}));

jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { clearDailyLogged, setDailyLogged, subscribeDailyLogged } from '@/lib/ledger';

beforeEach(() => {
  mockSetDoc.mockReset().mockResolvedValue(undefined);
  mockDeleteDoc.mockReset().mockResolvedValue(undefined);
  mockOnSnapshot.mockReset().mockReturnValue(() => {});
});

describe('dailyLogged writes', () => {
  it.each([true, false])('answers %s with the whole doc and a server timestamp', async (complete) => {
    await setDailyLogged('u1', '2026-10-24', complete);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
    const [ref, data] = mockSetDoc.mock.calls[0];
    expect(ref.path).toBe('users/u1/dailyLogged/2026-10-24');
    expect(data).toEqual({ complete, updatedAt: { __serverTimestamp: true } });
  });

  it('clearing the answer deletes the doc — unset is not a stored value', async () => {
    await clearDailyLogged('u1', '2026-10-24');
    expect(mockSetDoc).not.toHaveBeenCalled();
    expect(mockDeleteDoc.mock.calls[0][0].path).toBe('users/u1/dailyLogged/2026-10-24');
  });

  it('refuses a non-boolean before it reaches the network', async () => {
    await expect(setDailyLogged('u1', '2026-10-24', 'yes' as never)).rejects.toThrow(/boolean/);
    expect(mockSetDoc).not.toHaveBeenCalled();
  });
});

describe('subscribeDailyLogged', () => {
  it('maps day → answer and leaves a doc without a boolean out', () => {
    const cb = jest.fn();
    subscribeDailyLogged('u1', cb);
    const handler = mockOnSnapshot.mock.calls[0][2] as (snap: unknown) => void;
    const docs = [
      { id: '2026-10-22', data: () => ({ complete: true }) },
      { id: '2026-10-23', data: () => ({ complete: false }) },
      { id: '2026-10-24', data: () => ({ complete: 'yes' }) },
    ];
    handler({ docs, metadata: { fromCache: false }, docChanges: () => [] });
    expect(cb).toHaveBeenCalledWith({ '2026-10-22': true, '2026-10-23': false }, { fromCache: false });
  });
});
