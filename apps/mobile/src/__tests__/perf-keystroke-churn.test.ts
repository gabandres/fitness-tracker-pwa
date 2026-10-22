import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// The setup file's AsyncStorage is the package's jest mock: its methods are
// already `jest.fn`s, used directly (a `spyOn` + `mockRestore` on them strips
// their implementation for the rest of the file).

/**
 * A digit typed into a set row must cost a render of that row — not a rebuild
 * of the Train tab's history, and not a disk write.
 *
 * The live workout's document is one of the 50 the recent-sessions listener
 * watches, so every set edit re-delivers all 50 as fresh objects. The
 * completed ones `useTrain` keeps have not changed, and a new array would re-run
 * every derivation keyed on `recentSessions` (deload, rotation, suggestions,
 * the PR engine), hand every memoized ExerciseCard a new prop, and re-serialize
 * all 50 to AsyncStorage — `useCachedState`'s equality skip is what keeps the
 * held array, and these cases pin it from the Train side. A real edit and a
 * server-side cardio rewrite that leaves `updatedAt` alone
 * (`enforceHealthTombstones`) must still land.
 *
 * `publishActiveWorkout`, called from the same `setActive`, wrote its unchanged
 * three-field hint to AsyncStorage once per keystroke too.
 */

const mockNoop = jest.fn();
let mockDeliver: ((s: unknown[], meta?: { fromCache: boolean }) => void) | null = null;

jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb]);
  },
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportWorkout: jest.fn() }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeExercises: () => mockNoop,
  subscribeTemplates: () => mockNoop,
  subscribeTemplateDrafts: () => mockNoop,
  subscribeRecentSessions: (_u: string, _n: number, cb: (s: unknown[], meta?: { fromCache: boolean }) => void) => {
    mockDeliver = cb;
    return mockNoop;
  },
  readActiveSession: () => Promise.resolve({ session: null, fromCache: false }),
  startSession: jest.fn(),
  updateSession: jest.fn(),
  addExercise: jest.fn(),
  addTemplate: jest.fn(),
  deleteExercise: jest.fn(),
  deleteSession: jest.fn(),
  deleteTemplate: jest.fn(),
  editExercise: jest.fn(),
  mergeExercises: jest.fn(),
  markExercised: jest.fn(),
  setDailySleep: jest.fn(),
  setDailyWeight: jest.fn(),
  updateTemplate: jest.fn(),
}));

import { useTrain } from '@/hooks/useTrain';
import { clearOfflineCache } from '@/lib/offline-cache';
import { __resetActiveWorkoutSignal, publishActiveWorkout } from '@/lib/active-workout-signal';
import type { WorkoutSession } from '@/lib/workout';

/** A freshly MAPPED snapshot every call — new objects, as `toSession` makes. */
function completed(id: string, opts: { reps?: number; cardio?: unknown[]; updatedAt?: number } = {}): WorkoutSession {
  return {
    id,
    status: 'completed',
    templateId: undefined,
    date: new Date(Date.UTC(2026, 9, 1)),
    exercises: [{ exerciseId: 'bench', name: 'Bench', sets: [{ weight: 100, reps: opts.reps ?? 8, done: true }] }],
    ...(opts.cardio ? { cardio: opts.cardio } : {}),
    createdAt: new Date(Date.UTC(2026, 9, 1)),
    updatedAt: new Date(opts.updatedAt ?? Date.UTC(2026, 9, 1, 1)),
  } as unknown as WorkoutSession;
}
function live(reps: number): WorkoutSession {
  return { ...completed('live', { reps }), status: 'active' } as WorkoutSession;
}

beforeEach(() => {
  clearOfflineCache();
  mockDeliver = null;
});

describe('useTrain recent sessions under a live workout', () => {
  it('keeps the same array when only the live session moved', async () => {
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(mockDeliver).not.toBeNull());
    await act(async () => mockDeliver!([live(5), completed('a'), completed('b')], { fromCache: false }));
    const first = hook.result.current.recentSessions;
    expect(first.map((s) => s.id)).toEqual(['a', 'b']);

    // A keystroke in the live session: all 50 re-delivered, freshly mapped.
    await act(async () => mockDeliver!([live(6), completed('a'), completed('b')], { fromCache: false }));
    expect(hook.result.current.recentSessions).toBe(first);
  });

  it('takes a real change to a completed session', async () => {
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(mockDeliver).not.toBeNull());
    await act(async () => mockDeliver!([completed('a')], { fromCache: false }));
    const first = hook.result.current.recentSessions;
    await act(async () => mockDeliver!([completed('a', { reps: 10, updatedAt: Date.UTC(2026, 9, 2) })], { fromCache: false }));
    expect(hook.result.current.recentSessions).not.toBe(first);
    expect(hook.result.current.recentSessions[0]?.exercises[0]?.sets[0]?.reps).toBe(10);
  });

  it('takes a server-side cardio rewrite that left `updatedAt` alone', async () => {
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(mockDeliver).not.toBeNull());
    await act(async () => mockDeliver!([completed('a', { cardio: [{ modality: 'run', sourceId: 'x' }] })], { fromCache: false }));
    const first = hook.result.current.recentSessions;
    await act(async () => mockDeliver!([completed('a', { cardio: [] })], { fromCache: false }));
    expect(hook.result.current.recentSessions).not.toBe(first);
  });

  it('never skips the first SERVER answer after a cache-only one', async () => {
    // That delivery is what latches `useCachedState` live and writes the disk
    // cache; skipping it as "unchanged" would leave the slice un-persisted.
    const setItem = (AsyncStorage.setItem as jest.Mock);
    setItem.mockClear();
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(mockDeliver).not.toBeNull());
    await act(async () => mockDeliver!([completed('a')], { fromCache: true }));
    expect(hook.result.current.recentSessions.map((s) => s.id)).toEqual(['a']);
    // A cache-only value is never persisted…
    expect(setItem.mock.calls.some(([k]) => String(k).includes('workoutSessions'))).toBe(false);
    // …so the identical SERVER answer must still get through, and write.
    await act(async () => mockDeliver!([completed('a')], { fromCache: false }));
    await waitFor(() =>
      expect(setItem.mock.calls.some(([k]) => String(k).includes('workoutSessions'))).toBe(true),
    );
  });
});

describe('publishActiveWorkout', () => {
  beforeEach(() => __resetActiveWorkoutSignal());

  it('writes the cached hint only when it changes', async () => {
    const setItem = (AsyncStorage.setItem as jest.Mock);
    const removeItem = (AsyncStorage.removeItem as jest.Mock);
    setItem.mockClear();
    removeItem.mockClear();
    const date = new Date(Date.UTC(2026, 9, 1));
    // Three keystrokes into the same session: one write.
    for (let i = 0; i < 3; i++) publishActiveWorkout('u1', { templateName: 'Push', date, status: 'active' });
    expect(setItem).toHaveBeenCalledTimes(1);
    // A different session name is a different hint.
    publishActiveWorkout('u1', { templateName: 'Pull', date, status: 'active' });
    expect(setItem).toHaveBeenCalledTimes(2);
    // Finish: one removal, then nothing more to remove.
    publishActiveWorkout('u1', null);
    publishActiveWorkout('u1', null);
    expect(removeItem).toHaveBeenCalledTimes(1);
  });

  it('retries after a failed write rather than trusting it landed', async () => {
    const setItem = (AsyncStorage.setItem as jest.Mock);
    setItem.mockClear();
    setItem.mockImplementationOnce(() => Promise.reject(new Error('disk full')));
    const date = new Date(Date.UTC(2026, 9, 1));
    publishActiveWorkout('u1', { templateName: 'Push', date, status: 'active' });
    await act(async () => {});
    publishActiveWorkout('u1', { templateName: 'Push', date, status: 'active' });
    expect(setItem).toHaveBeenCalledTimes(2);
  });
});
