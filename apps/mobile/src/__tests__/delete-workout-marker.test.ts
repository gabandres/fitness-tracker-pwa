/**
 * S23-15: deleting a finished workout left that day's "exercised" row in the
 * food log, so the day went on counting as trained. A finish stopped writing
 * that row on 2026-10-15; `deleteWorkout` removes the one an older finish left.
 *
 * The real ledger over the in-memory Firestore.
 */
jest.mock('firebase/firestore', () => require('@/test-support/memory-firestore').firestoreModule);
jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/sentry', () => ({ captureError: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportWorkout: jest.fn() }));

import { type DateKey, MIDNIGHT, workoutMarkerEntry } from '@macrolog/core';
import { addLog, getLogsForRange, startSession } from '@/lib/ledger';
import { deleteWorkout } from '@/lib/ledger-ops';
import { captureError } from '@/lib/sentry';
import { memory } from '@/test-support/memory-firestore';
import type { SessionDraft } from '@/lib/workout';

const UID = 'u1';
const OLD = new Date(2026, 9, 10, 18, 0);
const worked = [{ exerciseId: 'e1', name: 'Squat', sets: [{ reps: 5, weight: 100, done: true }] }];
const session = (id: string, date: Date, over: Partial<SessionDraft> = {}) =>
  startSession(UID, { status: 'completed', date, exercises: worked, ...over } as SessionDraft, id);
const rowsOn = async (key: string) => getLogsForRange(UID, key as DateKey, key as DateKey, MIDNIGHT);

beforeEach(() => {
  memory.reset();
  jest.clearAllMocks();
});

describe('deleteWorkout', () => {
  it('takes the old "exercised" row with the workout, and leaves the meals', async () => {
    await session('s1', OLD);
    await addLog(UID, { ...workoutMarkerEntry(), timestamp: OLD });
    await addLog(UID, { calories: 500, protein: 40, mealLabel: 'Lunch', timestamp: new Date(2026, 9, 10, 13, 0) });

    await deleteWorkout(UID, { id: 's1', date: OLD, status: 'completed' }, MIDNIGHT);

    expect(memory.read(`users/${UID}/workoutSessions/s1`)).toBeUndefined();
    expect((await rowsOn('2026-10-10')).map((r) => r.mealLabel)).toEqual(['Lunch']);
  });

  it('keeps the row while another finished workout with logged work is on that day', async () => {
    await session('s1', OLD);
    await session('s2', new Date(2026, 9, 10, 20, 0));
    await addLog(UID, { ...workoutMarkerEntry(), timestamp: OLD });

    await deleteWorkout(UID, { id: 's1', date: OLD, status: 'completed' }, MIDNIGHT);

    expect(await rowsOn('2026-10-10')).toHaveLength(1);
  });

  it('an empty workout left on that day does not keep the row', async () => {
    await session('s1', OLD);
    await session('s2', new Date(2026, 9, 10, 20, 0), { exercises: [] });
    await addLog(UID, { ...workoutMarkerEntry(), timestamp: OLD });

    await deleteWorkout(UID, { id: 's1', date: OLD, status: 'completed' }, MIDNIGHT);

    expect(await rowsOn('2026-10-10')).toHaveLength(0);
  });

  it('reads nothing more for a workout from after the row stopped being written', async () => {
    const recent = new Date(2026, 10, 20, 18, 0);
    await session('s1', recent);
    await addLog(UID, { ...workoutMarkerEntry(), timestamp: recent });
    memory.writes.length = 0;

    await deleteWorkout(UID, { id: 's1', date: recent, status: 'completed' }, MIDNIGHT);

    expect(memory.writes).toEqual([{ op: 'delete', path: `users/${UID}/workoutSessions/s1` }]);
  });

  it('a discarded draft takes nothing from the food log', async () => {
    await session('s1', OLD, { status: 'active' });
    await addLog(UID, { ...workoutMarkerEntry(), timestamp: OLD });

    await deleteWorkout(UID, { id: 's1', date: OLD, status: 'active' }, MIDNIGHT);

    expect(await rowsOn('2026-10-10')).toHaveLength(1);
    expect(captureError).not.toHaveBeenCalled();
  });
});
