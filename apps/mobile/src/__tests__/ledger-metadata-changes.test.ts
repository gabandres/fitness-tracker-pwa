/**
 * Every listener that reports snapshot PROVENANCE must subscribe with
 * `includeMetadataChanges: true` (the rule is stated at `metaOf` in
 * `lib/ledger.ts`).
 *
 * `useCachedState` drops a `fromCache: true` snapshot once it has painted from
 * disk and waits for the server's answer. Without the flag Firestore never
 * sends that answer when it matches the cache — a metadata-only change — so a
 * listener re-opened over a fresh local write saw the new value once, as
 * cache-only, and dropped it. Found by Maestro 14 on 2026-10-04: sleep saved
 * from Today's native sheet stayed "not logged" until a cold start while
 * Firestore held 7.5. Only the logs and profile listeners carried the flag.
 */
const mockOnSnapshot = jest.fn((..._a: unknown[]) => () => {});

jest.mock('firebase/firestore', () => ({
  setDoc: jest.fn(),
  updateDoc: jest.fn(),
  deleteDoc: jest.fn(),
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  onSnapshot: (...a: unknown[]) => mockOnSnapshot(...a),
  orderBy: jest.fn(),
  query: jest.fn(() => ({ path: 'q' })),
  where: jest.fn(),
  Timestamp: class {
    static now(): { toDate: () => Date } {
      return { toDate: () => new Date(0) };
    }
    static fromDate(d: Date): { toDate: () => Date } {
      return { toDate: () => d };
    }
  },
}));

jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
// The logs and profile readers double as the connectivity probe; its debounce
// timer would otherwise outlive the run.
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn(), isOffline: () => false }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import * as ledger from '@/lib/ledger';

const D = new Date(2026, 9, 4);
type Call = (cb: jest.Mock) => unknown;
/** Each provenance-reporting reader, called with plausible arguments. */
const READERS: Record<string, Call> = {
  subscribeRecentLogs: (cb) => ledger.subscribeRecentLogs('u1', 14, cb),
  subscribeDailyWeights: (cb) => ledger.subscribeDailyWeights('u1', cb),
  subscribeDailyWeightsSince: (cb) => ledger.subscribeDailyWeightsSince('u1', '2026-09-01', cb),
  subscribeDailyWater: (cb) => ledger.subscribeDailyWater('u1', cb),
  subscribeDailyWaterSince: (cb) => ledger.subscribeDailyWaterSince('u1', '2026-09-01', cb),
  subscribeDailySleep: (cb) => ledger.subscribeDailySleep('u1', cb),
  subscribeDailySleepSince: (cb) => ledger.subscribeDailySleepSince('u1', '2026-09-01', cb),
  subscribeDailyActivity: (cb) => ledger.subscribeDailyActivity('u1', cb),
  subscribeFastsSince: (cb) => ledger.subscribeFastsSince('u1', D, cb),
  subscribeFastsAround: (cb) => ledger.subscribeFastsAround('u1', D, D, cb),
  subscribeProfile: (cb) => ledger.subscribeProfile('u1', cb),
  subscribeMilestones: (cb) => ledger.subscribeMilestones('u1', cb),
  subscribePresets: (cb) => ledger.subscribePresets('u1', cb),
  subscribeCustomFoods: (cb) => ledger.subscribeCustomFoods('u1', cb),
  subscribeExercises: (cb) => ledger.subscribeExercises('u1', cb),
  subscribeTemplates: (cb) => ledger.subscribeTemplates('u1', cb),
  subscribeRecentSessions: (cb) => ledger.subscribeRecentSessions('u1', 10, cb),
};

const CACHE_SNAP = { metadata: { fromCache: true }, docs: [], exists: () => false, data: () => undefined };

beforeEach(() => mockOnSnapshot.mockClear());

describe.each(Object.entries(READERS))('%s', (_name, call) => {
  it('asks for metadata changes, so the server answer always follows a cache one', () => {
    const cb = jest.fn();
    call(cb);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    const [, options, next] = mockOnSnapshot.mock.calls[0] as unknown[];
    expect(options).toEqual({ includeMetadataChanges: true });

    // And it really does report provenance — which is what makes the flag
    // load-bearing for it.
    const handler =
      typeof next === 'function' ? next : (next as { next: (s: unknown) => void }).next;
    handler(CACHE_SNAP);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][1]).toEqual(expect.objectContaining({ fromCache: true }));
  });
});

/**
 * The flag above makes every listener fire for events that change nothing on
 * screen — a write's server ack, a re-opened listener's cache-then-server pair.
 * Each used to be a fresh array and a full re-render of the screen (perf,
 * 2026-10-08). An event with no document changes now passes nothing new: it is
 * dropped, or — when the provenance flipped — re-delivers the SAME value.
 */
describe('events with no document changes', () => {
  const snap = (fromCache: boolean, changes: number, docs: { id: string; data: () => object }[] = []) => ({
    metadata: { fromCache },
    docs,
    docChanges: () => Array.from({ length: changes }),
  });
  const handlerOf = () => {
    const next = (mockOnSnapshot.mock.calls[0] as unknown[])[2];
    return typeof next === 'function' ? next : (next as { next: (s: unknown) => void }).next;
  };

  it.each([
    ['subscribePresets', READERS.subscribePresets],
    ['subscribeRecentLogs', READERS.subscribeRecentLogs],
  ])('%s: a server ack is dropped, a cache → server flip re-delivers the same value', (_n, call) => {
    const cb = jest.fn();
    call(cb);
    const handler = handlerOf();

    handler(snap(true, 0)); // first answer: always delivered, even empty
    handler(snap(true, 0)); // nothing new
    expect(cb).toHaveBeenCalledTimes(1);

    handler(snap(false, 0)); // the server confirms what the cache showed
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toBe(cb.mock.calls[0][0]);
    expect(cb.mock.calls[1][1]).toEqual({ fromCache: false });

    handler(snap(false, 0)); // a write's ack: metadata only
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it('a real change is mapped and delivered as a new value', () => {
    const cb = jest.fn();
    READERS.subscribeMilestones(cb);
    const handler = handlerOf();
    handler(snap(false, 0));
    handler(snap(false, 1, [{ id: 'first-log', data: () => ({}) }]));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).not.toBe(cb.mock.calls[0][0]);
  });

  it('subscribeProfile drops an event whose document and provenance are unchanged', () => {
    const cb = jest.fn();
    READERS.subscribeProfile(cb);
    const handler = handlerOf();
    const doc = (fromCache: boolean, data: object) => ({ metadata: { fromCache }, exists: () => true, data: () => data });
    handler(doc(false, { goal: 'lose' }));
    handler(doc(false, { goal: 'lose' })); // the ack of a write already shown
    expect(cb).toHaveBeenCalledTimes(1);
    handler(doc(false, { goal: 'gain' }));
    expect(cb).toHaveBeenCalledTimes(2);
  });
});
