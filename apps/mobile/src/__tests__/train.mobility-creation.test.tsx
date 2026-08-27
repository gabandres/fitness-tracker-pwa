import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * The exercise-creation chip, and the defect it closes.
 *
 * ADR-0028 made `mobility` a SetKind and excluded it from every strength
 * derivation. The seeded path produced it correctly; the HAND path did not —
 * `appendEx` scaffolded three `working` sets whatever log style was picked, so
 * a stretch a user typed themselves came out `logStyle: 'time'` with
 * `kind: 'working'`. It could take a `maxDurationSec` PR, and the dose note
 * never fired on it: precisely the outcome decision 1 exists to prevent,
 * reached through the hand-authoring door instead of the seeded one.
 *
 * Both directions are asserted. A chip that silently made every timed exercise
 * mobility would pass the first test and break planks, which are genuinely
 * working sets — that is why a fourth chip exists instead of a default.
 */

const mockSaveTemplate = jest.fn().mockResolvedValue(undefined);
const mockAddCatalogExercise = jest.fn().mockResolvedValue('new-ex-id');

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  exercises: [
    { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
  ],
  createdAt: new Date('2026-08-27T00:00:00Z'),
  updatedAt: new Date('2026-08-27T00:00:00Z'),
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
    addCatalogExercise: mockAddCatalogExercise,
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';
import { CREATION_STYLES, logStyleFor, setKindFor } from '@/components/train/train-shared';

beforeEach(() => {
  mockSaveTemplate.mockClear().mockResolvedValue(undefined);
  mockAddCatalogExercise.mockClear().mockResolvedValue('new-ex-id');
});

/** Open the editor, type a name, pick a chip by its visible label, create. */
async function createExercise(ui: any, name: string, chipLabel: string) {
  await fireEvent.press(ui.getByTestId('edit-template-t1'));
  await fireEvent.changeText(ui.getByTestId('template-add-exercise'), name);
  await fireEvent.press(ui.getByText(chipLabel));
  await fireEvent.press(ui.getByTestId('template-create-exercise'));
  await fireEvent.press(ui.getByTestId('save-template'));
  await waitFor(() => expect(mockSaveTemplate).toHaveBeenCalled());
  return mockSaveTemplate.mock.calls[0][0];
}

it('offers Mobility as a fourth chip beside the three log styles', () => {
  expect(CREATION_STYLES.map((c) => c.value))
    .toEqual(['weight-reps', 'bodyweight', 'time', 'mobility']);
});

it('resolves the mobility choice to a timed log style and mobility sets', () => {
  expect(logStyleFor('mobility')).toBe('time');
  expect(setKindFor('mobility')).toBe('mobility');
  // ...and leaves the three real log styles exactly as they were.
  for (const s of ['weight-reps', 'bodyweight', 'time'] as const) {
    expect(logStyleFor(s)).toBe(s);
    expect(setKindFor(s)).toBe('working');
  }
});

it('creates a hand-typed stretch with mobility sets', async () => {
  const ui = await render(<TrainScreen />);
  const draft = await createExercise(ui, 'Couch Stretch', 'Mobility');

  expect(mockAddCatalogExercise).toHaveBeenCalledWith('Couch Stretch', 'time');
  const added = draft.exercises[draft.exercises.length - 1];
  expect(added.logStyle).toBe('time');
  expect(added.plannedSets.every((s: { kind: string }) => s.kind === 'mobility')).toBe(true);
});

it('still creates a TIMED exercise with working sets — a plank is not mobility', async () => {
  // The regression the fourth chip exists to avoid. Defaulting `time` to
  // mobility would silently stop a plank earning a duration PR.
  const ui = await render(<TrainScreen />);
  const draft = await createExercise(ui, 'Plank', 'Time');

  expect(mockAddCatalogExercise).toHaveBeenCalledWith('Plank', 'time');
  const added = draft.exercises[draft.exercises.length - 1];
  expect(added.logStyle).toBe('time');
  expect(added.plannedSets.every((s: { kind: string }) => s.kind === 'working')).toBe(true);
});
