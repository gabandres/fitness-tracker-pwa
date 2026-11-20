/**
 * "Day fully logged?" storage (2026-10-24): `users/{uid}/dailyLogged/{dateKey}
 * = { complete, updatedAt }`. Yes/No are writes of the whole doc (the rules
 * require both fields and a server `updatedAt`); unset is a DELETE, never a
 * third stored value; and the reader keeps only boolean answers.
 *
 * Runs the real ledger over the in-memory Firestore (2026-11-20; it was a
 * hand-written fake of thirteen SDK functions until then).
 */
jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));

import { clearDailyLogged, setDailyLogged, subscribeDailyLogged } from '@/lib/ledger';
import { firestoreModule, memory } from '@/test-support/memory-firestore';

const PATH = 'users/u1/dailyLogged/2026-10-24';
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => memory.reset());

describe('dailyLogged writes', () => {
  it.each([true, false])('answers %s with the whole doc and a server timestamp', async (complete) => {
    await setDailyLogged('u1', '2026-10-24', complete);
    expect(memory.writes).toEqual([{ op: 'set', path: PATH }]);
    const stored = memory.read(PATH) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(['complete', 'updatedAt']);
    expect(stored.complete).toBe(complete);
    expect(stored.updatedAt).toBeInstanceOf(firestoreModule.Timestamp);
  });

  it('clearing the answer deletes the doc — unset is not a stored value', async () => {
    memory.seed(PATH, { complete: true });
    await clearDailyLogged('u1', '2026-10-24');
    expect(memory.writes).toEqual([{ op: 'delete', path: PATH }]);
    expect(memory.read(PATH)).toBeUndefined();
  });

  it('refuses a non-boolean before it reaches the network', async () => {
    await expect(setDailyLogged('u1', '2026-10-24', 'yes' as never)).rejects.toThrow(/boolean/);
    expect(memory.writes).toEqual([]);
  });
});

describe('subscribeDailyLogged', () => {
  it('maps day → answer and leaves a doc without a boolean out', async () => {
    memory.seed('users/u1/dailyLogged/2026-10-22', { complete: true });
    memory.seed('users/u1/dailyLogged/2026-10-23', { complete: false });
    memory.seed('users/u1/dailyLogged/2026-10-24', { complete: 'yes' });
    const cb = jest.fn();
    const stop = subscribeDailyLogged('u1', cb);
    await settle();
    expect(cb).toHaveBeenLastCalledWith({ '2026-10-22': true, '2026-10-23': false }, { fromCache: false });
    stop();
  });
});
