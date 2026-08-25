/**
 * The day-boundary write is the ONE place a boundary change reaches Firestore
 * (ADR-0030 step 4), so it is where the append-only invariant has to hold.
 *
 * Two things are pinned, and both are about what the SERVER can and cannot do
 * for us. `firestore.rules` has no way to iterate a list, so it can check that
 * `dayBoundary` is a list of at most 24 things and nothing about their shape or
 * their order. That makes this writer, not the rules, the thing that guarantees
 * a change is appended rather than rewriting a day that is already closed.
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

import { setDayStartHour } from '@/lib/ledger';
import { MIDNIGHT, setDayStartHour as coreSetDayStartHour } from '@macrolog/core';
import type { DateKey } from '@macrolog/core';

beforeEach(() => {
  mockUpdateDoc.mockReset();
  mockUpdateDoc.mockResolvedValue(undefined);
});

/** The patch `updateDoc` was called with. */
function patch(): { dayBoundary?: unknown } {
  return mockUpdateDoc.mock.calls[0]?.[1] ?? {};
}

const TODAY = '2026-08-25' as DateKey;

describe('setDayStartHour (mobile ledger)', () => {
  it('writes the whole history, not the hour', async () => {
    await setDayStartHour('u1', MIDNIGHT, 3, TODAY);
    expect(patch().dayBoundary).toEqual([{ from: '2026-08-25', hour: 3 }]);
  });

  it('appends rather than replacing, so closed days keep their rule', async () => {
    const existing = coreSetDayStartHour(MIDNIGHT, '2026-08-01' as DateKey, 5);
    await setDayStartHour('u1', existing, 3, TODAY);
    // The 08-01 entry survives — days between then and today were logged under
    // hour 5 and must keep reading that way.
    expect(patch().dayBoundary).toEqual([
      { from: '2026-08-01', hour: 5 },
      { from: '2026-08-25', hour: 3 },
    ]);
  });

  it('does not write at all when the hour is already in force', async () => {
    const existing = coreSetDayStartHour(MIDNIGHT, '2026-08-01' as DateKey, 3);
    await setDayStartHour('u1', existing, 3, TODAY);
    // A settings row can call this on every press without guarding.
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('writes plain objects, which is what the rules accept', async () => {
    await setDayStartHour('u1', MIDNIGHT, 4, TODAY);
    const list = patch().dayBoundary as unknown[];
    // Firestore rejects class instances and undefined-valued keys; the mapped
    // literal is what keeps this a document rather than a serialization bug.
    expect(Object.keys(list[0] as object).sort()).toEqual(['from', 'hour']);
    expect(JSON.parse(JSON.stringify(list))).toEqual(list);
  });

  it('refuses to rewrite history backwards', async () => {
    const existing = coreSetDayStartHour(MIDNIGHT, '2026-09-01' as DateKey, 5);
    // `from` is before an entry already on file — core throws rather than
    // silently re-sorting, and the writer does not swallow it.
    await expect(setDayStartHour('u1', existing, 3, TODAY)).rejects.toThrow(/forward-only/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('rejects an hour outside the allowed band', async () => {
    await expect(setDayStartHour('u1', MIDNIGHT, 9, TODAY)).rejects.toThrow(/0\.\.6/);
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
