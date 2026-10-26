/**
 * Travel mode: a weigh-in on a travel day is written with the travel-scale
 * note, whichever screen wrote it (`setDailyWeight` reads the trips the auth
 * provider hands the ledger). Outside a trip the doc stays `{ weight }`.
 */
const mockSetDoc = jest.fn(() => Promise.resolve());

jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => (mockSetDoc as (...x: unknown[]) => Promise<void>)(...a),
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
jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { TRAVEL_SCALE_NOTE } from '@macrolog/core';
import { setDailyWeight, setTravelPeriodsForWrites } from '@/lib/ledger';

afterEach(() => {
  mockSetDoc.mockClear();
  setTravelPeriodsForWrites([]);
});

it('tags a travel-day weigh-in, and only that one', async () => {
  setTravelPeriodsForWrites([{ start: '2026-10-31', end: '2026-11-18' }]);
  await setDailyWeight('u1', '2026-11-08', 156.2);
  await setDailyWeight('u1', '2026-11-19', 151.4);
  expect(mockSetDoc.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
    { weight: 156.2, note: TRAVEL_SCALE_NOTE },
    { weight: 151.4 },
  ]);
});
