/**
 * Issue #80 — an import must not write a second row for a night the user typed,
 * even when the two writers disagree about which day that night belongs to.
 *
 * The key derivation is pure and is pinned in `packages/core/src/sleep-night.test.ts`.
 * What *this* file covers is the thing no unit of that could: the ledger
 * actually READING the extra document before it writes, and the boundary
 * reaching it from the profile. The bug was never in the arithmetic — it was
 * that `importDailySleep` asked one document a question about two.
 */
const mockStore = new Map<string, Record<string, unknown>>();
const mockSetDoc = jest.fn();

jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => mockSetDoc(...(a as [])),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: (...a: unknown[]) => {
    const parts = (a as unknown[]).slice(1).map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(async (ref: { path: string }) => {
    const data = mockStore.get(ref.path);
    return { exists: () => data !== undefined, data: () => data };
  }),
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

jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { getDayBoundaryOnce, importDailySleep } from '@/lib/ledger';
import { MIDNIGHT, setDayStartHour, type DateKey, type DayBoundary } from '@macrolog/core';

const UID = 'u1';
const sleepPath = (key: string) => `users/${UID}/dailySleep/${key}`;
const THREE_AM: DayBoundary = setDayStartHour(MIDNIGHT, '2026-01-01' as DateKey, 3);

/** Woke at 01:00 local on the 20th — before a 3am day start, so the sleep sheet
 *  would have filed this night under the 19th while every importer files the
 *  20th. This is the exact instant the issue describes. */
const WOKE_BEFORE_BOUNDARY = new Date(2026, 2, 20, 1, 0).getTime();
/** Woke at 07:30 on the 20th. Both writers agree on the 20th. */
const WOKE_AFTER_BOUNDARY = new Date(2026, 2, 20, 7, 30).getTime();

beforeEach(() => {
  mockStore.clear();
  mockSetDoc.mockReset();
  mockSetDoc.mockResolvedValue(undefined);
});

/** What was written, if anything. */
const written = () => mockSetDoc.mock.calls.map(([ref, data]) => [ref.path, data] as const);

describe('a manual night and an import on different keys for the same real night', () => {
  it('declines — this is the bug', async () => {
    // The user typed it at 01:10, which on a 3am boundary is still the 19th.
    mockStore.set(sleepPath('2026-03-19'), { hours: 7, source: 'manual' });

    const wrote = await importDailySleep(UID, '2026-03-20', 6.5, {
      wakeAt: WOKE_BEFORE_BOUNDARY,
      boundary: THREE_AM,
    });

    expect(wrote).toBe(false);
    expect(written()).toEqual([]);
  });

  it('is exactly what the OLD guard did NOT do', async () => {
    // Same fixture, called the way every caller called it before this fix. The
    // regression test for the regression test: if this ever starts returning
    // false, the two cases above stopped being distinguishable and the new
    // arguments are no longer doing anything.
    mockStore.set(sleepPath('2026-03-19'), { hours: 7, source: 'manual' });

    expect(await importDailySleep(UID, '2026-03-20', 6.5)).toBe(true);
    expect(written()).toEqual([[sleepPath('2026-03-20'), { hours: 6.5, source: 'import' }]]);
  });

  it('protects a legacy row with no `source` at all', async () => {
    // Documents predating 2026-08-24 could be either, and the conservative
    // reading is the one that cannot destroy a real entry.
    mockStore.set(sleepPath('2026-03-19'), { hours: 7 });

    expect(
      await importDailySleep(UID, '2026-03-20', 6.5, {
        wakeAt: WOKE_BEFORE_BOUNDARY,
        boundary: THREE_AM,
      }),
    ).toBe(false);
  });
});

describe('what it still writes', () => {
  it('fills an empty night, under the SOURCE day — ADR-0030 Q5 unchanged', async () => {
    const wrote = await importDailySleep(UID, '2026-03-20', 6.5, {
      wakeAt: WOKE_BEFORE_BOUNDARY,
      boundary: THREE_AM,
    });

    expect(wrote).toBe(true);
    // Not the 19th. The guard looked there; the write never goes there.
    expect(written()).toEqual([[sleepPath('2026-03-20'), { hours: 6.5, source: 'import' }]]);
  });

  it('refreshes a night it already owns', async () => {
    mockStore.set(sleepPath('2026-03-20'), { hours: 6, source: 'import' });

    expect(
      await importDailySleep(UID, '2026-03-20', 6.5, {
        wakeAt: WOKE_BEFORE_BOUNDARY,
        boundary: THREE_AM,
      }),
    ).toBe(true);
  });

  it('does NOT read a typed night at D−1 as this night when the sleeper woke late', async () => {
    // THE over-reach case, at the ledger. A user on a 3am boundary who types
    // some nights has a manual row on the day before for a DIFFERENT night. A
    // blanket neighbour check would decline every import that follows a typed
    // night, silently and for ever.
    mockStore.set(sleepPath('2026-03-19'), { hours: 7, source: 'manual' });

    const wrote = await importDailySleep(UID, '2026-03-20', 6.5, {
      wakeAt: WOKE_AFTER_BOUNDARY,
      boundary: THREE_AM,
    });

    expect(wrote).toBe(true);
    expect(written()).toEqual([[sleepPath('2026-03-20'), { hours: 6.5, source: 'import' }]]);
  });

  it('still refuses to overwrite a typed night on its OWN key', async () => {
    // The protection that already worked, asserted so the widening cannot have
    // dropped it on the way past.
    mockStore.set(sleepPath('2026-03-20'), { hours: 7, source: 'manual' });

    expect(await importDailySleep(UID, '2026-03-20', 6.5)).toBe(false);
    expect(written()).toEqual([]);
  });
});

describe('the boundary the guard runs on comes off the profile', () => {
  it('reads `dayBoundary` and sanitizes it', async () => {
    mockStore.set(`users/${UID}`, {
      dayBoundary: [
        // Deliberately out of order and carrying one junk entry: rules cannot
        // iterate a list, so the shape is enforced on the way out.
        { from: '2026-06-01', hour: 6 },
        { from: '2026-01-01', hour: 3 },
        { from: 'nonsense', hour: 3 },
      ],
    });

    expect(await getDayBoundaryOnce(UID)).toEqual([
      { from: '2026-01-01', hour: 3 },
      { from: '2026-06-01', hour: 6 },
    ]);
  });

  it('is MIDNIGHT for an account that never touched the setting', async () => {
    mockStore.set(`users/${UID}`, { profileCompleted: true });

    expect(await getDayBoundaryOnce(UID)).toEqual(MIDNIGHT);
  });

  it('is MIDNIGHT rather than a throw when the profile cannot be read', async () => {
    const { getDoc } = jest.requireMock('firebase/firestore') as {
      getDoc: jest.Mock;
    };
    getDoc.mockRejectedValueOnce(new Error('offline'));

    // The failure direction matters: an import must not be blocked by a profile
    // read, and midnight is what the guard did before #80 anyway.
    expect(await getDayBoundaryOnce(UID)).toEqual(MIDNIGHT);
  });
});
