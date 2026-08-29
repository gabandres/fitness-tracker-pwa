/**
 * The hand-edit write path for fasts (ADR-0032 decision 3, issue #97).
 *
 * `breakFast` — covered next door in `fasting-archive-write.test.ts` — is the
 * write the TIMER makes. These three are the writes a PERSON makes, and they
 * carry two obligations that file's contract does not:
 *
 * 1. **Every one of them is `source: 'manual'`.** The field is enumerated in
 *    `firestore.rules` rather than trusted, and it is the only thing separating
 *    a fast the app measured from one somebody asserted afterwards. A
 *    correction that kept `'timer'` would let a hand-typed interval claim the
 *    timer produced it, which is precisely the claim `dailySleep.source` exists
 *    to prevent making about sleep.
 * 2. **A correction REPLACES the document.** `isValidFast` is written with
 *    `hasOnly` over three fields and validates the post-merge result, so a
 *    partial update leaves whatever the row happened to carry before —
 *    including a stale `'timer'`. `setDoc` with no merge option is what makes
 *    the stored shape exactly the three fields the rules describe, every time.
 *
 * The third thing pinned here is that an impossible interval THROWS rather than
 * being silently dropped. That is deliberately the opposite of `breakFast`,
 * which drops one — and the asymmetry is the point. `breakFast` has a running
 * timer to rescue, so refusing to clear it would strand the user in front of a
 * counter they cannot stop; there is no timer at stake here, and a person who
 * just typed an interval needs to be told it was refused rather than watching
 * it vanish.
 *
 * Mocked the same way and for the same reason as the sibling file: the real
 * `firebase/firestore` is ESM and jest cannot parse it in this project, and
 * `Timestamp` has to be a real class because `ledger.ts` narrows with
 * `instanceof`.
 */
jest.mock('firebase/firestore', () => {
  // Declared inside the factory — `jest.mock` is hoisted above every
  // declaration in this file, so a class at module scope is still in its
  // temporal dead zone when the factory runs.
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
    doc: (...a: unknown[]) => {
      const [first, ...rest] = a as [{ path?: string }, ...unknown[]];
      if (!rest.length && first && typeof first.path === 'string') {
        return { path: first.path, id: 'generated-id' };
      }
      const parts = rest.map(String);
      return { path: parts.join('/'), id: parts[parts.length - 1] };
    },
    collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
    writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
    deleteField: () => ({ __delete: true }),
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
jest.mock('@/lib/connectivity', () => ({ reportSnapshotMeta: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { addFast, deleteFast, updateFast } from '@/lib/ledger';
import { MAX_FAST_MS } from '@macrolog/core';

const fs = jest.requireMock('firebase/firestore') as {
  setDoc: jest.Mock;
  updateDoc: jest.Mock;
  deleteDoc: jest.Mock;
};

const UID = 'u1';
const START = new Date('2026-08-24T20:00:00.000Z');
const END = new Date('2026-08-25T12:00:00.000Z');

beforeEach(() => {
  fs.setDoc.mockReset().mockResolvedValue(undefined);
  fs.updateDoc.mockReset().mockResolvedValue(undefined);
  fs.deleteDoc.mockReset().mockResolvedValue(undefined);
});

/** The payload of the single document write, or null when nothing was written. */
const written = () => (fs.setDoc.mock.calls.length ? fs.setDoc.mock.calls[0][1] : null);

describe('addFast — a fast nobody timed', () => {
  it('files it under users/{uid}/fasts with a generated id', async () => {
    await addFast(UID, START, END);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    expect(fs.setDoc.mock.calls[0][0]).toEqual({ path: 'users/u1/fasts', id: 'generated-id' });
  });

  it('stamps it manual, and stores exactly the three fields the rules allow', async () => {
    await addFast(UID, START, END);
    const doc = written();
    expect(doc.source).toBe('manual');
    expect(Object.keys(doc).sort()).toEqual(['endedAt', 'source', 'startedAt']);
    expect(doc.startedAt.toDate()).toEqual(START);
    expect(doc.endedAt.toDate()).toEqual(END);
  });

  it('refuses an inverted interval LOUDLY, and writes nothing', async () => {
    // The opposite of `breakFast`, which drops one silently — there is no
    // running timer to strand here, and a person who just typed this needs to
    // know it was refused rather than watch it disappear.
    await expect(addFast(UID, END, START)).rejects.toThrow('fast/invalid-interval');
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  it('refuses a zero-length interval', async () => {
    await expect(addFast(UID, START, START)).rejects.toThrow('fast/invalid-interval');
    expect(fs.setDoc).not.toHaveBeenCalled();
  });

  it('accepts a fast one millisecond inside the ceiling and refuses one past it', async () => {
    await addFast(UID, START, new Date(START.getTime() + MAX_FAST_MS));
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    await expect(
      addFast(UID, START, new Date(START.getTime() + MAX_FAST_MS + 1)),
    ).rejects.toThrow('fast/invalid-interval');
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
  });

  it('keeps a fast far too short for a competitor to bother with', async () => {
    // ADR-0032 refuses to discard a fast for being short; Simple will not log
    // one under 12 hours and the review complaints are the result.
    await addFast(UID, START, new Date(START.getTime() + 60_000));
    expect(written().source).toBe('manual');
  });
});

describe('updateFast — correcting a stored fast', () => {
  it('writes the document the user named, not a new one', async () => {
    await updateFast(UID, 'fast-abc', START, END);
    expect(fs.setDoc).toHaveBeenCalledTimes(1);
    expect(fs.setDoc.mock.calls[0][0].id).toBe('fast-abc');
  });

  it('REPLACES rather than merges, so no stale field can survive', async () => {
    await updateFast(UID, 'fast-abc', START, END);
    // A merge option here would let `isValidFast`'s `hasOnly` pass against
    // fields this write never intended to keep.
    expect(fs.setDoc.mock.calls[0][2]).toBeUndefined();
    expect(fs.updateDoc).not.toHaveBeenCalled();
    expect(Object.keys(written()).sort()).toEqual(['endedAt', 'source', 'startedAt']);
  });

  it('demotes a timer fast to manual once a human has moved the hands', async () => {
    await updateFast(UID, 'fast-abc', START, END);
    expect(written().source).toBe('manual');
  });

  it('refuses an impossible interval without touching the stored one', async () => {
    await expect(updateFast(UID, 'fast-abc', END, START)).rejects.toThrow('fast/invalid-interval');
    expect(fs.setDoc).not.toHaveBeenCalled();
    expect(fs.deleteDoc).not.toHaveBeenCalled();
  });
});

describe('deleteFast', () => {
  it('deletes the named fast and nothing else', async () => {
    await deleteFast(UID, 'fast-abc');
    expect(fs.deleteDoc).toHaveBeenCalledTimes(1);
    expect(fs.deleteDoc.mock.calls[0][0].id).toBe('fast-abc');
    expect(fs.setDoc).not.toHaveBeenCalled();
  });
});
