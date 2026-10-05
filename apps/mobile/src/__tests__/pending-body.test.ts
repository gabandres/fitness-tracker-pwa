import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The Body durable queue (Body review, bug 2).
 *
 * An offline weigh-in used to leave the sheet with a dead Save and no words —
 * `setDoc` resolves on the SERVER's ack and this app's Firestore is
 * memory-only — and killing the app lost it. These pin the discipline the meal
 * queue already has, restated for weigh-ins and measurements: disk first, a
 * bounded first attempt, coalescing by key, replay on flush, and "drop only if
 * disk still holds the bytes I wrote" so an edit made mid-flight survives.
 */

let mockOffline = false;
jest.mock('@/lib/connectivity', () => ({ isOffline: () => mockOffline }));

const mockSetDailyWeight = jest.fn();
const mockDeleteDailyWeight = jest.fn();
const mockAddMeasurementWithId = jest.fn();
const mockUpdateMeasurement = jest.fn();
const mockDeleteMeasurement = jest.fn();
jest.mock('@/lib/ledger', () => ({
  setDailyWeight: (...a: unknown[]) => mockSetDailyWeight(...a),
  deleteDailyWeight: (...a: unknown[]) => mockDeleteDailyWeight(...a),
  addMeasurementWithId: (...a: unknown[]) => mockAddMeasurementWithId(...a),
  updateMeasurement: (...a: unknown[]) => mockUpdateMeasurement(...a),
  deleteMeasurement: (...a: unknown[]) => mockDeleteMeasurement(...a),
}));

import {
  type BodyOp,
  PENDING_BODY_TTL_MS,
  commitBodyOp,
  flushPendingBody,
  mergeBodyOp,
  overlayFromOps,
  pruneBodyOps,
  readPendingBody,
} from '@/lib/pending-body';

const NOW = 1_800_000_000_000;
const w = (dateKey: string, weightLb: number, atMs = NOW): BodyOp => ({ kind: 'weight', uid: 'u1', dateKey, weightLb, atMs });

/** A write that never settles — Firestore offline. */
const hang = () => new Promise<void>(() => {});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockOffline = false;
  for (const m of [mockSetDailyWeight, mockDeleteDailyWeight, mockAddMeasurementWithId, mockUpdateMeasurement, mockDeleteMeasurement]) {
    m.mockReset();
    m.mockResolvedValue(undefined);
  }
});

describe('mergeBodyOp — one pending intent per key', () => {
  it('a newer weigh-in for the day replaces the older one', () => {
    const out = mergeBodyOp([w('2026-10-04', 180)], w('2026-10-04', 179));
    expect(out).toEqual([w('2026-10-04', 179)]);
  });

  it('a delete replaces the day\'s weigh-in', () => {
    const del: BodyOp = { kind: 'weightDelete', uid: 'u1', dateKey: '2026-10-04', atMs: NOW };
    expect(mergeBodyOp([w('2026-10-04', 180)], del)).toEqual([del]);
  });

  it('an edit of a measurement that never landed folds INTO its add', () => {
    const add: BodyOp = { kind: 'measurementAdd', uid: 'u1', id: 'm1', entry: { waist: 34 }, dateMs: NOW, atMs: NOW };
    const upd: BodyOp = { kind: 'measurementUpdate', uid: 'u1', id: 'm1', entry: { waist: 33 }, atMs: NOW + 1 };
    expect(mergeBodyOp([add], upd)).toEqual([{ ...add, entry: { waist: 33 }, atMs: NOW + 1 }]);
  });

  it('different days and rows are independent', () => {
    expect(mergeBodyOp([w('2026-10-03', 180)], w('2026-10-04', 179))).toHaveLength(2);
  });
});

describe('pruneBodyOps', () => {
  it("drops another account's ops and anything past the TTL", () => {
    const mine = w('2026-10-04', 180);
    const theirs = { ...w('2026-10-04', 170), uid: 'u2' };
    const stale = w('2026-08-01', 185, NOW - PENDING_BODY_TTL_MS - 1);
    expect(pruneBodyOps([mine, theirs, stale], NOW, 'u1')).toEqual([mine]);
  });
});

describe('overlayFromOps — what Body draws before the server answers', () => {
  it('maps weigh-ins, deletes and measurement ops for one account', () => {
    const o = overlayFromOps(
      [
        w('2026-10-04', 180),
        { kind: 'weightDelete', uid: 'u1', dateKey: '2026-10-01', atMs: NOW },
        { kind: 'measurementAdd', uid: 'u1', id: 'm9', entry: { waist: 34 }, dateMs: NOW, atMs: NOW },
        { kind: 'measurementDelete', uid: 'u1', id: 'm2', atMs: NOW },
        { ...w('2026-10-04', 150), uid: 'u2' },
      ],
      'u1',
    );
    expect(o.weights).toEqual({ '2026-10-04': 180, '2026-10-01': null });
    expect(o.added.map((m) => m.id)).toEqual(['m9']);
    expect(o.deleted).toEqual(['m2']);
  });
});

describe('commitBodyOp — the sheet closes on the LOCAL write', () => {
  it('online: lands, reports saved, and leaves nothing parked', async () => {
    const { landed } = await commitBodyOp(w('2026-10-04', 180));
    await expect(landed).resolves.toBe('saved');
    expect(mockSetDailyWeight).toHaveBeenCalledWith('u1', '2026-10-04', 180);
    expect((await readPendingBody('u1')).weights).toEqual({});
  });

  it('offline: resolves as soon as it is parked, reports queued, and the flush lands it', async () => {
    jest.useFakeTimers();
    try {
      mockOffline = true;
      mockSetDailyWeight.mockImplementationOnce(hang);
      const { landed } = await commitBodyOp(w('2026-10-04', 180));
      // Parked BEFORE the network was touched — what survives a killed app.
      expect((await readPendingBody('u1')).weights).toEqual({ '2026-10-04': 180 });
      jest.advanceTimersByTime(1600);
      await expect(landed).resolves.toBe('queued');
    } finally {
      jest.useRealTimers();
    }
    // Next foreground: the socket is back.
    await expect(flushPendingBody('u1')).resolves.toBe(1);
    expect((await readPendingBody('u1')).weights).toEqual({});
  });

  it('a permanent refusal is REPORTED and dropped, never retried for a month', async () => {
    mockSetDailyWeight.mockRejectedValueOnce(Object.assign(new Error('nope'), { code: 'permission-denied' }));
    const { landed } = await commitBodyOp(w('2026-10-04', 180));
    await expect(landed).resolves.toBe('rejected');
    expect((await readPendingBody('u1')).weights).toEqual({});
  });

  it('an edit made while the first write is in flight survives that write landing', async () => {
    jest.useFakeTimers();
    try {
      let release: () => void = () => {};
      mockSetDailyWeight.mockImplementationOnce(() => new Promise<void>((r) => (release = r)));
      mockSetDailyWeight.mockImplementationOnce(hang);
      const first = await commitBodyOp(w('2026-10-04', 180));
      const second = await commitBodyOp(w('2026-10-04', 179));
      release();
      await expect(first.landed).resolves.toBe('saved');
      // The 180 landed and must not take the 179 off disk with it.
      expect((await readPendingBody('u1')).weights).toEqual({ '2026-10-04': 179 });
      jest.advanceTimersByTime(9000);
      await expect(second.landed).resolves.toBe('queued');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('flushPendingBody', () => {
  it('lands measurement adds at their own id and date, and keeps what still fails', async () => {
    jest.useFakeTimers();
    try {
      mockOffline = true;
      mockAddMeasurementWithId.mockImplementationOnce(hang);
      mockSetDailyWeight.mockImplementationOnce(hang);
      const a = await commitBodyOp({ kind: 'measurementAdd', uid: 'u1', id: 'm1', entry: { waist: 34 }, dateMs: NOW, atMs: NOW });
      const b = await commitBodyOp(w('2026-10-04', 180));
      jest.advanceTimersByTime(1600);
      await a.landed;
      await b.landed;
    } finally {
      jest.useRealTimers();
    }
    mockSetDailyWeight.mockRejectedValueOnce(new Error('still offline'));
    await expect(flushPendingBody('u1')).resolves.toBe(1);
    expect(mockAddMeasurementWithId).toHaveBeenLastCalledWith('u1', 'm1', { waist: 34 }, new Date(NOW));
    const left = await readPendingBody('u1');
    expect(left.added).toEqual([]);
    expect(left.weights).toEqual({ '2026-10-04': 180 });
  });
});
