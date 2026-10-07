import React from 'react';
import { renderWithProviders as render, within } from '@/test-utils';
import type { Exercise, WorkoutTemplate } from '@/lib/workout';

/**
 * The exercise's history lists every move of its TEMPLATE load (2026-10-07):
 * when, from → to, whether the engine or the lifter made it, why, and in
 * which template — read from each template row's `loadLog` through core
 * `loadChangesFor`. Newest first, like the session history above it.
 */

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { ExerciseDetailSheet } from '@/components/train/ExerciseDetailSheet';

const at = (iso: string) => new Date(iso);

const squat: Exercise = {
  id: 'sq', name: 'Smith squat', muscles: ['quads'], defaultCues: [], logStyle: 'weight-reps', createdAt: at('2026-09-01T00:00:00Z'),
};

const template = (name: string, loadLog: NonNullable<WorkoutTemplate['exercises'][number]['loadLog']>): WorkoutTemplate => ({
  id: name, name, createdAt: at('2026-09-01T00:00:00Z'), updatedAt: at('2026-09-01T00:00:00Z'),
  exercises: [
    { exerciseId: 'sq', name: 'Smith squat', plannedSets: [], targetLoad: 30, loadLog },
    // Another lift's log must not leak into this one's history.
    { exerciseId: 'other', name: 'Row', plannedSets: [], loadLog: [{ at: '2026-10-03T12:00:00.000Z', to: 99, by: 'user', reason: 'x' }] },
  ],
});

function renderSheet(templates?: WorkoutTemplate[]) {
  const train = {
    recentSessions: [],
    catalog: [squat],
    templates,
    editCatalogExercise: jest.fn(),
    deleteCatalogExercise: jest.fn(),
    mergeCatalogExercises: jest.fn(),
  } as unknown as React.ComponentProps<typeof ExerciseDetailSheet>['train'];
  return render(<ExerciseDetailSheet visible exercise={squat} train={train} onClose={() => {}} />);
}

it('lists every load change for the lift, newest first, with who made it, why and where', async () => {
  const ui = await renderSheet([
    template('Legs A', [
      { at: '2026-09-20T12:00:00.000Z', from: 20, to: 25, by: 'engine', reason: 'Both clusters reached 12; add load.' },
      { at: '2026-10-02T12:00:00.000Z', from: 25, to: 30, by: 'user', reason: 'Edited by hand in the template editor' },
    ]),
    template('Legs B', [
      { at: '2026-09-25T12:00:00.000Z', to: 25, by: 'engine', reason: 'First load.' },
    ]),
  ]);

  const log = ui.getByTestId('exercise-load-log');
  expect(log).toHaveTextContent(/Load changes/);
  const rows = [0, 1, 2].map((i) => within(log).getByTestId(`exercise-load-change-${i}`));
  expect(within(log).queryByTestId('exercise-load-change-3')).toBeNull();

  expect(rows[0]).toHaveTextContent(/25 lb → 30 lb/);
  expect(rows[0]).toHaveTextContent(/You · Legs A/);
  expect(rows[0]).toHaveTextContent(/Edited by hand in the template editor/);

  // A first load has nothing to move from: it says what it was set to.
  expect(rows[1]).toHaveTextContent(/Set to 25 lb/);
  expect(rows[1]).toHaveTextContent(/Engine · Legs B/);

  expect(rows[2]).toHaveTextContent(/20 lb → 25 lb/);
  expect(rows[2]).toHaveTextContent(/Engine · Legs A/);
  expect(rows[2]).toHaveTextContent(/Both clusters reached 12; add load\./);
});

it('shows no load section when nothing has moved', async () => {
  const ui = await renderSheet([template('Legs A', [])]);
  expect(ui.queryByTestId('exercise-load-log')).toBeNull();
});

it('renders the rest of the history without templates at all', async () => {
  const ui = await renderSheet(undefined);
  expect(ui.queryByTestId('exercise-load-log')).toBeNull();
  expect(ui.getByText('Smith squat')).toBeTruthy();
});
