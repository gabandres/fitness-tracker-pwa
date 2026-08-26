/**
 * `breakFast` is the one write in this app where a REJECTED document does
 * active harm rather than simply failing (ADR-0032, issue #97).
 *
 * It is a batch: create the completed fast in `users/{uid}/fasts`, null
 * `fastStartedAt` on the profile, one atomic commit. That atomicity is the
 * whole design — split into two writes, a failure between them either loses the
 * fast (null first) or leaves a phantom timer running against a fast already
 * archived (document first), and both are the bug class the Zero reviews in
 * ADR-0032 describe.
 *
 * The consequence this file pins is the non-obvious one. Because it is a batch,
 * a document `firestore.rules` refuses does not merely fail to save — it fails
 * the WHOLE commit, so `fastStartedAt` stays set and the user is left looking
 * at a counter they cannot stop. So the writer has to check the interval
 * ITSELF, before building the batch, and drop the record rather than hand
 * Firestore a write it will reject. `isStorableFast` is that check and it is
 * shared with the web adapter so the two cannot drift.
 *
 * The Firestore arm of this contract is covered for real against the emulator
 * with production rules loaded, on the web side, in
 * `src/app/ledger/infrastructure/firestore-ledger-core.emulator.test.ts`. This
 * file covers the Expo mirror, which has no emulator harness — so it asserts
 * the SHAPE, and the emulator suite asserts that the shape is accepted.
 */
const mockCommit = jest.fn();
const mockBatchSet = jest.fn();
const mockBatchUpdate = jest.fn();
const mockGetDoc = jest.fn();

// Hand-built for the same reason `day-boundary-write.test.ts` gives: the real
// package is ESM and jest cannot parse it here. `Timestamp` must be a real
// class, not a literal — `breakFast` narrows the stored value with
// `instanceof`, and a plain object would silently take the "no fast running"
// path and make every case below pass for the wrong reason.
jest.mock('firebase/firestore', () => {
  // Declared INSIDE the factory on purpose. `jest.mock` is hoisted above every
  // declaration in this file, so a class defined at module scope is still in
  // its temporal dead zone when the factory runs — `Timestamp` then arrives at
  // `ledger.ts` as `undefined` and the `instanceof` throws "Right-hand side of
  // 'instanceof' is not an object", which reads like a bug in the code under
  // test rather than in the harness.
  // A plain field, NOT a TypeScript parameter property: `constructor(private
  // readonly d: Date)` desugars to an assignment babel reads as an out-of-scope
  // reference to `d`, and jest rejects the whole factory for it.
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
  // Two call shapes, and `breakFast` uses the second. `doc(db, ...segments)`
  // addresses a known path; `doc(collectionRef)` mints a NEW id inside a
  // collection, which is how a completed fast gets its Firestore-generated key.
  doc: (...a: unknown[]) => {
    const [first, ...rest] = a as [{ path?: string }, ...unknown[]];
    if (!rest.length && first && typeof first.path === 'string') {
      return { path: first.path, id: 'generated-id' };
    }
    const parts = rest.map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: mockBatchSet, update: mockBatchUpdate, commit: mockCommit }),
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

import { breakFast } from '@/lib/ledger';
import { MAX_FAST_MS } from '@macrolog/core';

/** The same class `ledger.ts` sees, so a fixture built here satisfies the
 *  `instanceof` narrowing in `breakFast`. */
const { Timestamp: MockTimestamp } = jest.requireMock('firebase/firestore') as {
  Timestamp: { fromDate(d: Date): { toDate(): Date } };
};

const UID = 'u1';
const START = new Date('2026-08-24T20:00:00.000Z');
const END = new Date('2026-08-25T12:00:00.000Z');

/** A profile with a fast running since `start`. */
const runningSince = (start: Date | null) => ({
  data: () => (start ? { fastStartedAt: MockTimestamp.fromDate(start) } : {}),
});

beforeEach(() => {
  mockCommit.mockReset().mockResolvedValue(undefined);
  mockBatchSet.mockReset();
  mockBatchUpdate.mockReset();
  mockGetDoc.mockReset();
});

/** The document `breakFast` archived, or null when it archived nothing. */
const archived = () => (mockBatchSet.mock.calls.length ? mockBatchSet.mock.calls[0][1] : null);

describe('breakFast archives the fast instead of deleting it', () => {
  it('writes the completed interval and clears the timer in ONE batch', async () => {
    mockGetDoc.mockResolvedValue(runningSince(START));
    await breakFast(UID, END);

    const doc = archived();
    expect(doc).not.toBeNull();
    expect(doc.startedAt.toDate().toISOString()).toBe(START.toISOString());
    expect(doc.endedAt.toDate().toISOString()).toBe(END.toISOString());
    // Measured by the timer, not asserted by hand — the same distinction
    // `dailySleep.source` already makes.
    expect(doc.source).toBe('timer');

    // Both writes, and exactly one commit. If these ever split into two
    // commits the atomicity this whole design rests on is gone.
    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    expect(mockBatchUpdate.mock.calls[0][1].fastStartedAt).toBeNull();
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('files the fast under users/{uid}/fasts with a generated id', async () => {
    mockGetDoc.mockResolvedValue(runningSince(START));
    await breakFast(UID, END);
    // Interval-shaped and id-keyed, NOT keyed by date. A fast crosses midnight
    // routinely, so a date key would bake an attribution decision into an
    // identifier where it could never be revised without a migration.
    expect(mockBatchSet.mock.calls[0][0].path).toBe('users/u1/fasts');
  });

  it('clears the timer without archiving when no fast was running', async () => {
    mockGetDoc.mockResolvedValue(runningSince(null));
    await breakFast(UID, END);

    expect(archived()).toBeNull();
    expect(mockBatchUpdate.mock.calls[0][1].fastStartedAt).toBeNull();
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('still clears the timer when the interval is one the rules would refuse', async () => {
    // Fifteen days is a timer someone forgot, not a fast, and the rules cap the
    // stored interval at fourteen. Attempting it would fail the batch and strand
    // the user with a counter they cannot stop — so the record is dropped and
    // the timer is cleared. That is the deliberately chosen failure.
    mockGetDoc.mockResolvedValue(runningSince(new Date(END.getTime() - MAX_FAST_MS - 1000)));
    await breakFast(UID, END);

    expect(archived()).toBeNull();
    expect(mockBatchUpdate.mock.calls[0][1].fastStartedAt).toBeNull();
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('archives a fast one second inside the ceiling', async () => {
    mockGetDoc.mockResolvedValue(runningSince(new Date(END.getTime() - MAX_FAST_MS + 1000)));
    await breakFast(UID, END);
    expect(archived()).not.toBeNull();
  });

  it('drops an inverted interval rather than writing it', async () => {
    mockGetDoc.mockResolvedValue(runningSince(new Date(END.getTime() + 60_000)));
    await breakFast(UID, END);
    expect(archived()).toBeNull();
    expect(mockCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps a fast far too short for a competitor to bother with', async () => {
    // ADR-0032 refuses to discard a fast for being short. Zero and Simple do,
    // and the review complaints the ADR quotes are the result.
    mockGetDoc.mockResolvedValue(runningSince(new Date(END.getTime() - 20 * 60_000)));
    await breakFast(UID, END);
    expect(archived()).not.toBeNull();
  });
});
