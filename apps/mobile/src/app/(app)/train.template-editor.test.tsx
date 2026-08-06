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

import TrainScreen from './train';

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
