/**
 * The ledger half of the 2026-10-21 Today performance pass.
 *
 * - `onChangedData` re-converts only the documents `docChanges()` names, keeps
 *   unchanged rows by identity, and reads ORDER off `snap.docs`.
 * - Today's water / sleep / activity are ONE document each, keyed on the day.
 * - `ensureProfile` stops rewriting `lastSeenAt` on every cold start.
 * - `weightsWindowStart` places a weights window no later than the oldest log.
 */
const mockOnSnapshot = jest.fn((..._a: unknown[]) => () => {});
const mockGetDoc = jest.fn();
const mockGetDocs = jest.fn();
const mockUpdateDoc = jest.fn((..._a: unknown[]) => Promise.resolve());
const mockSetDoc = jest.fn((..._a: unknown[]) => Promise.resolve());

jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => mockSetDoc(...a),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...a),
  deleteDoc: jest.fn(() => Promise.resolve()),
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: (...a: unknown[]) => mockGetDoc(...a),
  getDocs: (...a: unknown[]) => mockGetDocs(...a),
  limit: jest.fn(),
  onSnapshot: (...a: unknown[]) => mockOnSnapshot(...a),
  orderBy: jest.fn(),
  query: jest.fn(() => ({ path: 'q' })),
  where: jest.fn(),
  Timestamp: class {
    mockMs: number;
    constructor(mockMs: number) {
      this.mockMs = mockMs;
    }
    toMillis(): number {
      return this.mockMs;
    }
    toDate(): Date {
      return new Date(this.mockMs);
    }
    static now(): unknown {
      return { now: true };
    }
    static fromDate(d: Date): { toDate: () => Date } {
      return { toDate: () => d };
    }
  },
}));

jest.mock('@/lib/sentry', () => ({ addBreadcrumb: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn(), isOffline: () => false }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { Timestamp } from 'firebase/firestore';
import type { DateKey } from '@macrolog/core';
import * as ledger from '@/lib/ledger';

/** The mock's one-argument (millisecond) Timestamp. */
const stamp = (ms: number): unknown => new (Timestamp as unknown as new (ms: number) => unknown)(ms);
const key = (k: string) => k as DateKey;

type Doc = { id: string; data: () => Record<string, unknown> };
type Change = { type: 'added' | 'modified' | 'removed'; doc: Doc };

const handler = (call = 0): ((s: unknown) => void) => {
  const next = (mockOnSnapshot.mock.calls[call] as unknown[])[2];
  return typeof next === 'function' ? (next as (s: unknown) => void) : (next as { next: (s: unknown) => void }).next;
};
const querySnap = (docs: Doc[], changes: Change[] = [], fromCache = false) => ({
  metadata: { fromCache },
  docs,
  docChanges: () => changes,
});
/** A doc whose `data()` counts its calls — the decode `onChangedData` saves. */
const counted = (id: string, data: Record<string, unknown>, calls: Record<string, number>): Doc => ({
  id,
  data: () => {
    calls[id] = (calls[id] ?? 0) + 1;
    return data;
  },
});

beforeEach(() => {
  mockOnSnapshot.mockClear();
  mockGetDoc.mockReset();
  mockGetDocs.mockReset();
  mockUpdateDoc.mockClear();
  mockSetDoc.mockClear();
  ledger.__resetWeightEdges();
});

describe('onChangedData converts only what changed', () => {
  const preset = (name: string) => ({ name, calories: 100 });

  it('re-converts added/modified docs only, keeps the rest by identity, follows snap.docs order', () => {
    const cb = jest.fn();
    ledger.subscribePresets('u1', cb);
    const h = handler();
    const calls: Record<string, number> = {};
    const a = counted('a', preset('A'), calls);
    const b = counted('b', preset('B'), calls);
    const c = counted('c', preset('C'), calls);

    h(querySnap([a, b, c])); // first snapshot: everything converts
    expect(calls).toEqual({ a: 1, b: 1, c: 1 });
    const first = cb.mock.calls[0][0] as { id: string; name: string }[];
    expect(first.map((p) => p.id)).toEqual(['a', 'b', 'c']);

    // b modified; a and c untouched.
    const b2 = counted('b', preset('B2'), calls);
    h(querySnap([a, b2, c], [{ type: 'modified', doc: b2 }]));
    expect(calls).toEqual({ a: 1, b: 2, c: 1 });
    const second = cb.mock.calls[1][0] as { id: string; name: string }[];
    expect(second).not.toBe(first);
    expect(second[0]).toBe(first[0]);
    expect(second[2]).toBe(first[2]);
    expect(second[1].name).toBe('B2');

    // a removed, d added at the front, c reordered before b: order is the
    // query's, read off `snap.docs`.
    const d = counted('d', preset('D'), calls);
    h(querySnap([d, c, b2], [{ type: 'removed', doc: a }, { type: 'added', doc: d }]));
    expect(calls).toEqual({ a: 1, b: 2, c: 1, d: 1 });
    const third = cb.mock.calls[2][0] as { id: string }[];
    expect(third.map((p) => p.id)).toEqual(['d', 'c', 'b']);
    expect(third[1]).toBe(second[2]); // c, carried over
    expect(third[2]).toBe(second[1]); // b2, carried over
  });

  it('a doc that leaves and comes back is converted afresh, not resurrected', () => {
    const cb = jest.fn();
    ledger.subscribePresets('u1', cb);
    const h = handler();
    const calls: Record<string, number> = {};
    const a = counted('a', preset('A'), calls);
    const b = counted('b', preset('B'), calls);
    h(querySnap([a, b]));
    h(querySnap([b], [{ type: 'removed', doc: a }]));
    const a2 = counted('a', preset('A again'), calls);
    h(querySnap([a2, b], [{ type: 'added', doc: a2 }]));
    const last = cb.mock.calls[2][0] as { id: string; name: string }[];
    expect(last[0].name).toBe('A again');
    expect(calls).toEqual({ a: 2, b: 1 });
  });

  it('keeps the oldest-first contract of the logs window, converting one row for one add', () => {
    const cb = jest.fn();
    ledger.subscribeRecentLogs('u1', 400, cb);
    const h = handler();
    const calls: Record<string, number> = {};
    const row = (id: string, ms: number) => counted(id, { calories: 100, timestamp: stamp(ms) }, calls);
    // The query is newest-first; the delivery is oldest-first.
    const r2 = row('r2', 2_000);
    const r1 = row('r1', 1_000);
    h(querySnap([r2, r1]));
    expect((cb.mock.calls[0][0] as { id: string }[]).map((l) => l.id)).toEqual(['r1', 'r2']);
    const r3 = row('r3', 3_000);
    h(querySnap([r3, r2, r1], [{ type: 'added', doc: r3 }]));
    expect((cb.mock.calls[1][0] as { id: string }[]).map((l) => l.id)).toEqual(['r1', 'r2', 'r3']);
    expect(calls).toEqual({ r1: 1, r2: 1, r3: 1 });
  });

  it('map readers drop a doc with no usable value, as their loops did', () => {
    const cb = jest.fn();
    ledger.subscribeDailyWeightsSince('u1', '2026-10-01', cb);
    const h = handler();
    h(querySnap([
      { id: '2026-10-02', data: () => ({ weight: 180 }) },
      { id: '2026-10-03', data: () => ({}) },
    ]));
    expect(cb.mock.calls[0][0]).toEqual({ '2026-10-02': 180 });
  });

  it('an event with no changes still re-delivers the SAME value on a provenance flip', () => {
    const cb = jest.fn();
    ledger.subscribePresets('u1', cb);
    const h = handler();
    h(querySnap([{ id: 'a', data: () => preset('A') }], [], true));
    h(querySnap([{ id: 'a', data: () => preset('A') }], [], false));
    expect(cb).toHaveBeenCalledTimes(2);
    expect(cb.mock.calls[1][0]).toBe(cb.mock.calls[0][0]);
  });
});

describe("Today's daily scalars are ONE document each", () => {
  const docSnap = (data: Record<string, unknown> | undefined, fromCache = false) => ({
    metadata: { fromCache },
    exists: () => data != null,
    data: () => data,
  });

  it('water listens to the day document and delivers a one-entry map', () => {
    const cb = jest.fn();
    ledger.subscribeDailyWaterDay('u1', '2026-10-21', cb);
    const [ref, options] = mockOnSnapshot.mock.calls[0] as unknown[];
    expect(ref).toEqual({ path: 'users/u1/dailyWater/2026-10-21' });
    expect(options).toEqual({ includeMetadataChanges: true });
    const h = handler();
    h(docSnap({ flOz: 24 }, true));
    expect(cb.mock.calls[0]).toEqual([{ '2026-10-21': 24 }, { fromCache: true }]);
    // The server confirms the same data: same object, new provenance.
    h(docSnap({ flOz: 24 }, false));
    expect(cb.mock.calls[1][0]).toBe(cb.mock.calls[0][0]);
    expect(cb.mock.calls[1][1]).toEqual({ fromCache: false });
    // A write's ack: nothing new at all.
    h(docSnap({ flOz: 24 }, false));
    expect(cb).toHaveBeenCalledTimes(2);
    h(docSnap(undefined, false));
    expect(cb.mock.calls[2][0]).toEqual({});
  });

  it('sleep answers the hours AND the bedtime / wake time from one listener', () => {
    const cb = jest.fn();
    ledger.subscribeDailySleepDay('u1', '2026-10-21', cb);
    expect(mockOnSnapshot).toHaveBeenCalledTimes(1);
    expect((mockOnSnapshot.mock.calls[0] as unknown[])[0]).toEqual({ path: 'users/u1/dailySleep/2026-10-21' });
    const h = handler();
    h(docSnap({ hours: 7.5, bedtime: '23:30', wakeTime: '07:00' }));
    expect(cb.mock.calls[0][0]).toEqual({
      sleep: { '2026-10-21': 7.5 },
      times: { bedtime: '23:30', wakeTime: '07:00' },
    });
    h(docSnap(undefined));
    expect(cb.mock.calls[1][0]).toEqual({ sleep: {}, times: {} });
  });

  it('activity listens to the day document', () => {
    const cb = jest.fn();
    ledger.subscribeDailyActivityDay('u1', '2026-10-21', cb);
    expect((mockOnSnapshot.mock.calls[0] as unknown[])[0]).toEqual({ path: 'users/u1/dailyActivity/2026-10-21' });
    handler()(docSnap({ steps: 8000, activeKcal: 400 }));
    expect(cb.mock.calls[0][0]).toEqual({ '2026-10-21': { steps: 8000, activeKcal: 400 } });
  });

  it('the whole-collection readers Today used are gone', () => {
    const l = ledger as Record<string, unknown>;
    expect(l.subscribeDailyWater).toBeUndefined();
    expect(l.subscribeDailySleep).toBeUndefined();
    expect(l.subscribeDailyActivity).toBeUndefined();
    expect(l.subscribeSleepTimes).toBeUndefined();
  });
});

describe('ensureProfile writes lastSeenAt at most every 12 h', () => {
  const HOUR = 60 * 60 * 1000;
  const profileDoc = (fields: Record<string, unknown>) => ({ exists: () => true, data: () => fields });
  const offset = new Date().getTimezoneOffset();

  it('skips the write when the stamp is fresh and the timezone has not moved', async () => {
    mockGetDoc.mockResolvedValue(
      profileDoc({ profileCompleted: true, lastSeenAt: stamp(Date.now() - 2 * HOUR), timezoneOffsetMin: offset }),
    );
    await ledger.ensureProfile('u1');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('writes when the stamp is 12 h old', async () => {
    mockGetDoc.mockResolvedValue(
      profileDoc({ profileCompleted: true, lastSeenAt: stamp(Date.now() - 13 * HOUR), timezoneOffsetMin: offset }),
    );
    await ledger.ensureProfile('u1');
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({ lastSeenAt: { now: true }, timezoneOffsetMin: offset });
  });

  it('writes at once when the timezone moved, however fresh the stamp', async () => {
    mockGetDoc.mockResolvedValue(
      profileDoc({ profileCompleted: true, lastSeenAt: stamp(Date.now()), timezoneOffsetMin: offset + 60 }),
    );
    await ledger.ensureProfile('u1');
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({ lastSeenAt: { now: true }, timezoneOffsetMin: offset });
  });

  it('never adds the timezone to a profile still mid-onboarding (the rules reject it)', async () => {
    mockGetDoc.mockResolvedValue(profileDoc({ profileCompleted: false, lastSeenAt: stamp(0) }));
    await ledger.ensureProfile('u1');
    expect(mockUpdateDoc.mock.calls[0][1]).toEqual({ lastSeenAt: { now: true } });
    mockUpdateDoc.mockClear();
    // Fresh, mid-onboarding, no timezone on file: nothing to do.
    mockGetDoc.mockResolvedValue(profileDoc({ profileCompleted: false, lastSeenAt: stamp(Date.now()) }));
    await ledger.ensureProfile('u1');
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('still creates a missing profile', async () => {
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    await ledger.ensureProfile('u1');
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });
});

describe('weightsWindowStart', () => {
  it('starts on the 1st of the month of the day BEFORE the oldest row', () => {
    expect(ledger.weightsWindowStart([{ date: new Date(2026, 6, 14, 9) }], key('2026-10-21'))).toBe('2026-07-01');
    // The day before the 1st is last month — the boundary margin crosses it.
    expect(ledger.weightsWindowStart([{ date: new Date(2026, 6, 1, 9) }], key('2026-10-21'))).toBe('2026-06-01');
  });

  it("is this month's 1st with no rows, and never after today", () => {
    expect(ledger.weightsWindowStart([], key('2026-10-21'))).toBe('2026-10-01');
    expect(ledger.weightsWindowStart([{ date: new Date(2026, 11, 25) }], key('2026-10-21'))).toBe('2026-10-01');
  });
});

describe('getWeightEdges', () => {
  const one = (id: string, weight: number) => ({ docs: [{ id, data: () => ({ weight }) }] });

  it('reads the first-ever and newest-before-window weigh-ins once, then holds them', async () => {
    mockGetDocs.mockImplementation(() => Promise.resolve(one('2022-01-03', 210)));
    const [a, b] = await Promise.all([ledger.getWeightEdges('u1', '2026-07-01'), ledger.getWeightEdges('u1', '2026-07-01')]);
    expect(a).toBe(b);
    expect(mockGetDocs).toHaveBeenCalledTimes(2); // earliest + newest-before, once
    await ledger.getWeightEdges('u1', '2026-07-01');
    expect(mockGetDocs).toHaveBeenCalledTimes(2);
  });

  it('a weight write drops what is held', async () => {
    mockGetDocs.mockImplementation(() => Promise.resolve(one('2022-01-03', 210)));
    await ledger.getWeightEdges('u1', '2026-07-01');
    await ledger.setDailyWeight('u1', '2022-01-02', 211);
    await ledger.getWeightEdges('u1', '2026-07-01');
    expect(mockGetDocs).toHaveBeenCalledTimes(4);
  });

  it('a failed read is not held', async () => {
    mockGetDocs.mockRejectedValueOnce(new Error('offline'));
    await expect(ledger.getWeightEdges('u1', '2026-07-01')).rejects.toThrow('offline');
    mockGetDocs.mockImplementation(() => Promise.resolve({ docs: [] }));
    await expect(ledger.getWeightEdges('u1', '2026-07-01')).resolves.toEqual({ first: null, newest: null });
  });
});
