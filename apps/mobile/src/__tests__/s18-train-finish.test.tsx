/**
 * Train — the Finish sheet honours `finishWorkout`'s boolean, Discard asks
 * first (UX_AUDIT S18-6), and the set row is readable (S18-3).
 *
 * A failed save used to close the sheet and fire the review prompt as if the
 * workout had been recorded; the user learned otherwise from an error line on
 * the idle tab, with their bodyweight and sleep already gone.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession } from '@/lib/workout';

const day = (n: number) => new Date(2026, 8, n);

const mockActiveSession = {
  id: 'live',
  date: day(16),
  status: 'active',
  exercises: [
    {
      exerciseId: 'e1',
      name: 'Bench',
      logStyle: 'weight-reps',
      cues: [],
      // One LOGGED set: Finish on a session with nothing logged offers to
      // discard instead of opening the sheet (Train review bug 10).
      sets: [{ kind: 'working', done: true, weight: 100, reps: 5 }, { kind: 'working', done: false }],
    },
  ],
} as unknown as WorkoutSession;

const mockFinishWorkout = jest.fn();
const mockDiscardWorkout = jest.fn().mockResolvedValue(undefined);
const mockRecordPositiveMoment = jest.fn();

// Native sheets present through a root `sheet` route that does not exist
// under jest; the JS sheet renders its children in place, which is what this
// suite asserts against (Train sheets went native in the 2026-10-04 review).
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [
      { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
    ],
    templates: [],
    recentSessions: [],
    active: mockActiveSession,
    saving: false,
    editingExisting: false,
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    startCardioWorkout: jest.fn(),
    saveTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    deleteTemplate: jest.fn(),
    addCatalogExercise: jest.fn(),
    addLibraryExercise: jest.fn(),
    addLibraryExerciseToActive: jest.fn(),
    editCatalogExercise: jest.fn(),
    deleteCatalogExercise: jest.fn(),
    mergeCatalogExercises: jest.fn(),
    addExerciseToActive: jest.fn(),
    dispatch: jest.fn().mockResolvedValue(undefined),
    commitActive: jest.fn().mockResolvedValue(undefined),
    finishWorkout: (...a: unknown[]) => mockFinishWorkout(...a),
    discardWorkout: (...a: unknown[]) => mockDiscardWorkout(...a),
    deleteSession: jest.fn(),
    reopenSession: jest.fn(),
    finishEdit: jest.fn(),
    cancelEdit: jest.fn(),
  }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: () => mockRecordPositiveMoment() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn(), rearm: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';

beforeEach(() => {
  mockFinishWorkout.mockReset();
  mockDiscardWorkout.mockClear();
  mockRecordPositiveMoment.mockClear();
});

async function openFinish() {
  const screen = await render(<TrainScreen />);
  await fireEvent.press(screen.getByTestId('finish-workout'));
  await waitFor(() => expect(screen.getByTestId('finish-confirm')).toBeTruthy());
  return screen;
}

describe('Finish sheet', () => {
  it('a failed save keeps the sheet open, says so, and spends no review prompt', async () => {
    mockFinishWorkout.mockResolvedValue(false);
    const screen = await openFinish();

    await fireEvent.press(screen.getByTestId('finish-confirm'));

    await waitFor(() => expect(screen.getByTestId('finish-save-error')).toBeTruthy());
    expect(screen.getByTestId('finish-confirm')).toBeTruthy();
    expect(mockRecordPositiveMoment).not.toHaveBeenCalled();
  });

  it('the Complete button IS the retry: a second tap after a failed save re-runs the write and closes on success', async () => {
    mockFinishWorkout.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const screen = await openFinish();

    await fireEvent.press(screen.getByTestId('finish-confirm'));
    await waitFor(() => expect(screen.getByTestId('finish-save-error')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('finish-confirm'));
    await waitFor(() => expect(mockFinishWorkout).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockRecordPositiveMoment).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('finish-save-error')).toBeNull();
  });

  it('the Complete button carries a role and its busy state (S18-15)', async () => {
    mockFinishWorkout.mockResolvedValue(true);
    const screen = await openFinish();
    const btn = screen.getByTestId('finish-confirm');
    expect(btn.props.accessibilityRole).toBe('button');
    expect(btn.props.accessibilityState).toEqual({ disabled: false, busy: false });
  });

  it('a successful save closes the sheet and records the positive moment', async () => {
    mockFinishWorkout.mockResolvedValue(true);
    const screen = await openFinish();

    await fireEvent.press(screen.getByTestId('finish-confirm'));

    await waitFor(() => expect(mockRecordPositiveMoment).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('finish-save-error')).toBeNull();
  });

  it('a legacy void resolve still reads as success', async () => {
    mockFinishWorkout.mockResolvedValue(undefined);
    const screen = await openFinish();
    await fireEvent.press(screen.getByTestId('finish-confirm'));
    await waitFor(() => expect(mockRecordPositiveMoment).toHaveBeenCalledTimes(1));
  });
});

describe('Discard', () => {
  it('asks before discarding — with no confirm host mounted, nothing is deleted', async () => {
    const screen = await render(<TrainScreen />);
    // Discard lives in the session's ⋯ menu since the sticky header (Train
    // review item 5) — a destructive action no longer sits beside Finish.
    await fireEvent.press(screen.getByTestId('session-menu'));
    await fireEvent.press(screen.getByTestId('session-menu-discard'));
    expect(mockDiscardWorkout).not.toHaveBeenCalled();
  });
});

describe('Set row accessibility', () => {
  it('names the inputs and exposes Done as a checked checkbox', async () => {
    const screen = await render(<TrainScreen />);
    // A live set's own number, not a template target (UX_AUDIT S20) — and
    // with a value in it, so no "empty".
    expect(screen.getByTestId('set-weight-0-0').props.accessibilityLabel).toBe('Set 1 weight');
    expect(screen.getByTestId('set-count-0-0').props.accessibilityLabel).toBe('Set 1 reps');
    const done = screen.getByTestId('set-done-0-0');
    expect(done.props.accessibilityRole).toBe('checkbox');
    expect(done.props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId('set-done-0-1').props.accessibilityState).toEqual({ checked: false });
  });
});
