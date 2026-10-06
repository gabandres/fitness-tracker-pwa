import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { setRowLabels } from '@macrolog/core';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Template editor, S21 — every field names itself (a placeholder dash or "12"
 * was all a screen reader had), a cluster's rows are named by the label the
 * row SHOWS ("1a"), not their index, and every number pad has a Done.
 */

const mockSaveTemplate = jest.fn().mockResolvedValue(undefined);

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  notes: 'Chest, shoulders, triceps.',
  restMiniSec: 90,
  restClusterSec: 120,
  seedKey: 'push-day',
  exercises: [
    {
      exerciseId: 'e1',
      name: 'DB Flat Press',
      logStyle: 'weight-reps',
      targetLoad: 25,
      cues: ['Elbows 45°', 'Full stretch'],
      progression: { targetReps: 12, holdSessions: 2, incrementLb: 2.5 },
      restMiniSec: 45,
      plannedSets: [
        { kind: 'activation', group: 1 },
        { kind: 'mini', group: 1 },
        { kind: 'mini', group: 1 },
      ],
    },
    // A second exercise exists so reordering has something to reorder. Every
    // other test indexes exercise 0, which this leaves untouched.
    {
      exerciseId: 'e2',
      name: 'Incline DB Press',
      logStyle: 'weight-reps',
      plannedSets: [{ kind: 'working' }],
    },
  ],
  createdAt: new Date('2026-07-05T02:51:12Z'),
  updatedAt: new Date('2026-08-06T16:08:19Z'),
};

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
    catalog: [],
    templates: [mockTemplate],
    recentSessions: [],
    active: null,
    editingExisting: false,
    saveTemplate: mockSaveTemplate,
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    addCatalogExercise: jest.fn(),
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));

// The screen's chrome reaches Firebase through auth; the editor under test
// does not. Stub the seam rather than boot the SDK.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));

jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';


it('names a cluster row by its shown label, and gives the number pads a Done', async () => {
  const { getByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  const labels = setRowLabels(mockTemplate.exercises[0].plannedSets);
  for (let si = 0; si < labels.length; si++) {
    const w = getByTestId(`template-set-weight-0-${si}`);
    expect(w.props.accessibilityLabel).toBe(`Set ${labels[si]} target weight`);
    expect(w.props.returnKeyType).toBe('done');
    expect(getByTestId(`template-set-reps-0-${si}`).props.accessibilityLabel).toBe(`Set ${labels[si]} target reps`);
  }
  // The third row of a cluster is not "set 3".
  expect(labels[2]).not.toBe('3');
});

it('labels the template and per-exercise fields, with the exercise named', async () => {
  const { getByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  expect(getByTestId('template-name').props.accessibilityLabel).toBe('Name');
  expect(getByTestId('template-add-exercise').props.accessibilityLabel).toBe('Add an exercise by name');
  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  await fireEvent.press(getByTestId('template-more-0'));
  const load = getByTestId('template-load-0');
  expect(load.props.accessibilityLabel).toBe('Target weight (lb), DB Flat Press');
  expect(load.props.returnKeyType).toBe('done');
  expect(getByTestId('template-cues-0').props.accessibilityLabel).toBe('Cues (one per line), DB Flat Press');
  expect(getByTestId('template-target-reps-0').props.accessibilityLabel).toBe('Target reps, DB Flat Press');
  expect(getByTestId('template-hold-sessions-0').props.accessibilityLabel).toBe('Workouts in a row, DB Flat Press');
  expect(getByTestId('template-increment-0').props.accessibilityLabel).toBe('Weight step (lb), DB Flat Press');
});
