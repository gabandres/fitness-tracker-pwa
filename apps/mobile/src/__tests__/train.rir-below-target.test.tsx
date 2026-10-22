/**
 * "Logged RIR 0, target 1" — the RIR-compliance hint (Program v2.2, 2026-10-22).
 *
 * On a `rir1` / `rir2` lift, a ticked read set (a cluster's activation, or a
 * straight lift's working set) logged closer to failure than the target shows
 * the two numbers under the row. A note, never a gate: the set stays ticked
 * and nothing else about the row changes. A set at or above its target, a mini,
 * and a lift taken to failure show nothing.
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
      setStructure: 'straight',
      cues: [],
      sets: [
        { kind: 'working', weight: 35, reps: 12, rir: 1, done: true },
        { kind: 'working', weight: 35, reps: 12, rir: 2, done: true },
      ],
    },
    {
      exerciseId: 'squat',
      name: 'Smith squat',
      logStyle: 'weight-reps',
      cues: [],
      sets: [
        { kind: 'activation', group: 1, weight: 35, reps: 13, rir: 0, done: true },
        { kind: 'mini', group: 1, weight: 35, reps: 4, rir: 0, done: true },
      ],
    },
    {
      exerciseId: 'ext',
      name: 'Leg Extensions',
      logStyle: 'weight-reps',
      cues: [],
      sets: [{ kind: 'activation', group: 1, weight: 100, reps: 14, rir: 0, done: true }],
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
      { id: 'rdl', name: 'DB Romanian deadlift', muscles: ['hamstrings', 'glutes'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir2', setStructure: 'straight', createdAt: new Date() },
      { id: 'squat', name: 'Smith squat', muscles: ['quads'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'rir1', createdAt: new Date() },
      { id: 'ext', name: 'Leg Extensions', muscles: ['quads'], defaultCues: [], logStyle: 'weight-reps', effortStandard: 'failure', createdAt: new Date() },
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

describe('RIR below target — the compliance hint', () => {
  it('names the logged RIR and the target under a read set logged too close to failure', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-rir-below-0-0')).toBeTruthy());
    expect(ui.getByTestId('set-rir-below-0-0')).toHaveTextContent('Logged RIR 1, target 2');
    // The squat's card opens on a tap (one card is expanded at a time).
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await waitFor(() => expect(ui.getByTestId('set-rir-below-1-0')).toHaveTextContent('Logged RIR 0, target 1'));
  });

  it('is silent at the target, on a mini, and on a lift taken to failure', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-rir-below-0-0')).toBeTruthy());
    // At the target (12 @ RIR 2 on a rir2 lift): nothing.
    expect(ui.queryByTestId('set-rir-below-0-1')).toBeNull();
    // A mini is not the read.
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await waitFor(() => expect(ui.getByTestId('set-rir-below-1-0')).toBeTruthy());
    expect(ui.queryByTestId('set-rir-below-1-1')).toBeNull();
    // A failure lift at RIR 0 is AT its target.
    await fireEvent.press(ui.getByTestId('exercise-head-2'));
    await waitFor(() => expect(ui.getByTestId('set-kind-2-0')).toBeTruthy());
    expect(ui.queryByTestId('set-rir-below-2-0')).toBeNull();
  });
});
