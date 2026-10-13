/**
 * "RIR missing — enter it?" (2026-10-13).
 *
 * The 10/13 DB RDL was saved with RIR blank on every row, and the engine
 * answered by repeating the load with nothing on screen saying why. The engine
 * now reads a blank as 0 (core `progression-engine.ts`); this pins the other
 * half: a ticked working set (`activation`, or a straight `working` set) with
 * no RIR shows a prompt that opens the RIR picker, and nothing else about the
 * row changes — the tick is not refused and no sheet opens on its own.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession } from '@/lib/workout';

const mockActive = {
  id: 'live',
  date: new Date(2026, 9, 13, 7),
  status: 'active',
  exercises: [
    {
      exerciseId: 'rdl',
      name: 'DB Romanian deadlift',
      logStyle: 'weight-reps',
      cues: [],
      sets: [
        // As logged on 10/13: done, reps and load, no RIR.
        { kind: 'activation', group: 1, weight: 35, reps: 13, done: true },
        { kind: 'mini', group: 1, weight: 35, reps: 4, done: true },
        { kind: 'activation', group: 2, weight: 35, reps: 12, rir: 0, done: true },
        { kind: 'activation', group: 3, weight: 35, done: false },
      ],
    },
  ],
} as unknown as WorkoutSession;

const mockDispatch = jest.fn().mockResolvedValue(undefined);

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
      { id: 'rdl', name: 'DB Romanian deadlift', muscles: ['hamstrings'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
    ],
    templates: [],
    drafts: [],
    pendingLoadTestFor: () => null,
    recentSessions: [],
    active: mockActive,
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
    dispatch: (...a: unknown[]) => mockDispatch(...a),
    commitActive: jest.fn().mockResolvedValue(undefined),
    finishWorkout: jest.fn(),
    discardWorkout: jest.fn(),
    deleteSession: jest.fn(),
    reopenSession: jest.fn(),
    finishEdit: jest.fn(),
    cancelEdit: jest.fn(),
  }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn(), rearm: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';

describe('RIR missing — enter it?', () => {
  it('shows under a ticked activation with no RIR, and only there', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-rir-missing-0-0')).toBeTruthy());
    expect(ui.getByText('RIR missing — enter it?')).toBeTruthy();
    // A mini is not the read; an activation with its RIR has nothing missing;
    // an unticked set has not been saved.
    expect(ui.queryByTestId('set-rir-missing-0-1')).toBeNull();
    expect(ui.queryByTestId('set-rir-missing-0-2')).toBeNull();
    expect(ui.queryByTestId('set-rir-missing-0-3')).toBeNull();
  });

  it('a tap opens the RIR picker for that set; nothing is blocked before it', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-rir-missing-0-0')).toBeTruthy());
    expect(ui.queryByTestId('set-sheet-rir-0')).toBeNull();
    await fireEvent.press(ui.getByTestId('set-rir-missing-0-0'));
    await waitFor(() => expect(ui.getByTestId('set-sheet-rir-0')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('set-sheet-rir-0'));
    expect(mockDispatch.mock.calls.map((c) => c[0])).toContainEqual(
      expect.objectContaining({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { rir: 0 } }),
    );
  });
});
