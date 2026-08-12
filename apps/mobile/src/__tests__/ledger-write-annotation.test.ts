/**
 * A rejected Firestore write must name the document it was writing.
 *
 * Sentry IGNIA-MOBILE-4 is three events of "FirebaseError: Missing or
 * insufficient permissions." with `stacktrace: null` — Hermes loses the stack
 * when the rejection crosses an async boundary, so the events identify no
 * collection, no document and no code path. The account that produced them has
 * not been opened since, so there is nothing left to reproduce, and the same
 * error arriving tomorrow would be equally unidentifiable.
 *
 * These tests pin the two properties that fix that: the path reaches the
 * message (which Sentry groups on), and `code` — which callers branch on —
 * does not move.
 */
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockAddBreadcrumb = jest.fn();

// Hand-built rather than spread over `requireActual`: the real package is ESM
// and jest cannot parse it here. Only the symbols `ledger.ts` imports are
// needed, and only `path` is read off a ref by the code under test.
jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => mockSetDoc(...(a as [])),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...(a as [])),
  deleteDoc: (...a: unknown[]) => mockDeleteDoc(...(a as [])),
  doc: (...a: unknown[]) => {
    const parts = (a as unknown[]).slice(1).map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  Timestamp: {
    now: () => ({ toDate: () => new Date(0) }),
    fromDate: (d: Date) => ({ toDate: () => d }),
  },
}));

jest.mock('@/lib/sentry', () => ({
  addBreadcrumb: (...a: unknown[]) => mockAddBreadcrumb(...(a as [])),
}));

jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { setDailyWeight, deleteLog } from '@/lib/ledger';

/** What Firestore actually throws: a code, and (under Hermes) no stack. */
function permissionDenied(): Error & { code: string } {
  const err = new Error('Missing or insufficient permissions.') as Error & { code: string };
  err.code = 'permission-denied';
  err.stack = undefined;
  return err;
}

beforeEach(() => {
  mockSetDoc.mockReset();
  mockUpdateDoc.mockReset();
  mockDeleteDoc.mockReset();
  mockAddBreadcrumb.mockReset();
});

describe('rejected writes name their document', () => {
  it('puts the path in the message and keeps the code', async () => {
    mockSetDoc.mockRejectedValueOnce(permissionDenied());

    await expect(setDailyWeight('u1', '2026-08-12', 180)).rejects.toMatchObject({
      message: 'users/u1/dailyWeights/2026-08-12: Missing or insufficient permissions.',
      code: 'permission-denied', // callers branch on this — it must not move
    });
  });

  it('breadcrumbs the failure with the error code', async () => {
    mockDeleteDoc.mockRejectedValueOnce(permissionDenied());

    await expect(deleteLog('u1', 'log-9')).rejects.toThrow();
    expect(mockAddBreadcrumb).toHaveBeenCalledWith(
      'firestore write failed: users/u1/dailyLogs/log-9',
      { code: 'permission-denied' },
    );
  });

  it('leaves a successful write alone', async () => {
    mockSetDoc.mockResolvedValueOnce(undefined);

    await expect(setDailyWeight('u1', '2026-08-12', 180)).resolves.toBeUndefined();
    expect(mockAddBreadcrumb).not.toHaveBeenCalled();
  });
});
