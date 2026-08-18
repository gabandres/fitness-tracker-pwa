import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Template editor — the round-trip invariant.
 *
 * The editor writes `exercises` as a FULL overwrite (toTemplatePatch), so
 * anything the editor cannot represent is deleted by the next save. It used
 * to model an exercise's sets as a plain count, which meant opening a
 * cluster template written on the web and hitting Save silently flattened
 * every activation/mini cluster into N `working` sets and dropped `cues` and
 * `progression` outright. Saving with no edits must be a no-op on the doc.
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
      plannedSets: [
        { kind: 'activation', group: 1 },
        { kind: 'mini', group: 1 },
        { kind: 'mini', group: 1 },
      ],
    },
  ],
  createdAt: new Date('2026-07-05T02:51:12Z'),
  updatedAt: new Date('2026-08-06T16:08:19Z'),
};

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

beforeEach(() => {
  mockSaveTemplate.mockClear().mockResolvedValue(undefined);
});

it('round-trips clusters, cues and progression when saved unedited', async () => {
  const { getByTestId } = await render(<TrainScreen />);

  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));

  const [draft, id] = mockSaveTemplate.mock.calls[0];
  expect(id).toBe('t1');
  expect(draft.restMiniSec).toBe(90);
  expect(draft.restClusterSec).toBe(120);
  expect(draft.seedKey).toBe('push-day');
  expect(draft.exercises[0].cues).toEqual(['Elbows 45°', 'Full stretch']);
  expect(draft.exercises[0].progression).toEqual({
    targetReps: 12,
    holdSessions: 2,
    incrementLb: 2.5,
  });
  expect(draft.exercises[0].plannedSets).toEqual([
    { kind: 'activation', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'mini', group: 1 },
  ]);
});

it('renumbers clusters when one is appended', async () => {
  const { getByTestId } = await render(<TrainScreen />);

  await fireEvent.press(getByTestId('edit-template-t1'));
  // Exercise cards open collapsed — one at a time — so the set controls are
  // behind the card's own toggle now.
  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  await fireEvent.press(getByTestId('template-add-cluster-0'));
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));

  // Group numbers are derived from the activation/mini ordering, never typed.
  expect(mockSaveTemplate.mock.calls[0][0].exercises[0].plannedSets).toEqual([
    { kind: 'activation', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'mini', group: 1 },
    { kind: 'activation', group: 2 },
    { kind: 'mini', group: 2 },
    { kind: 'mini', group: 2 },
  ]);
});

/**
 * Readability behaviour (2026-08-18). The card used to render every control
 * for every exercise at once; a six-exercise template was six full forms in
 * one scroll. Cards now open collapsed behind a one-line summary, and the
 * optional half (cues, progression, the default load) sits behind "More
 * options" — so these testIDs being absent until opened IS the feature.
 */
it('opens exercise cards collapsed, showing a summary instead of the form', async () => {
  const { getByTestId, queryByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));

  expect(queryByTestId('template-add-set-0')).toBeNull();
  expect(queryByTestId('template-set-weight-0-0')).toBeNull();
  // The optional half is a further level down, not merely off-screen.
  expect(queryByTestId('template-cues-0')).toBeNull();
  expect(queryByTestId('template-progression-0')).toBeNull();

  await fireEvent.press(getByTestId('template-ex-toggle-0'));
  expect(getByTestId('template-add-set-0')).toBeTruthy();
  expect(getByTestId('template-set-weight-0-0')).toBeTruthy();

  // Still one level down, even with the card open.
  expect(queryByTestId('template-cues-0')).toBeNull();
  await fireEvent.press(getByTestId('template-more-0'));
  expect(getByTestId('template-cues-0')).toBeTruthy();
  expect(getByTestId('template-progression-0')).toBeTruthy();
});

it('round-trips per-set targets typed into the table', async () => {
  const { getByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t1'));
  await fireEvent.press(getByTestId('template-ex-toggle-0'));

  await fireEvent.changeText(getByTestId('template-set-weight-0-0'), '135');
  await fireEvent.changeText(getByTestId('template-set-reps-0-0'), '8');
  await fireEvent.press(getByTestId('save-template'));

  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalledTimes(1));
  const sets = mockSaveTemplate.mock.calls[0][0].exercises[0].plannedSets;
  expect(sets[0]).toMatchObject({ kind: 'activation', group: 1, weight: 135, reps: 8 });
  // The rows left alone prescribe nothing rather than inheriting row 1.
  expect(sets[1].weight).toBeUndefined();
  expect(sets[1].reps).toBeUndefined();
});
