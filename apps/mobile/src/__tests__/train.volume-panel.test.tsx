import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { muscleSignals, volumeCalls, weeklyClusterAudit } from '@macrolog/core';
import type { Exercise, WorkoutSession } from '@/lib/workout';

/**
 * The volume panel (progression engine layer 5), under the weekly cluster
 * chips: the training phase, the per-muscle volume call — held in a cut,
 * otherwise +1 cluster where one is earned, with why — and the lifter's
 * volume gate with the 7-day average read from the on-disk weigh-ins (one
 * cache read, no listener).
 */

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);
const pad = (n: number) => String(n).padStart(2, '0');
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

let mockProfile: Record<string, unknown> | null = null;
let mockWeights: Record<string, number> | null = null;

const bench: Exercise = {
  id: 'e1', name: 'DB Bench Press', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: daysAgo(60),
};

/** One valid myo-reps cluster: activation to failure, first mini in 2-5. */
const session = (id: string, ago: number, load: number): WorkoutSession => ({
  id, status: 'completed', date: daysAgo(ago), createdAt: daysAgo(ago), updatedAt: daysAgo(ago),
  exercises: [{
    exerciseId: 'e1', name: 'DB Bench Press', logStyle: 'weight-reps', cues: [],
    sets: [
      { kind: 'activation', group: 1, weight: load, reps: 12, rir: 0, done: true },
      { kind: 'mini', group: 1, weight: load, reps: 4, done: true },
      { kind: 'mini', group: 1, weight: load, reps: 3, done: true },
    ],
  }],
} as WorkoutSession);

// Load went up across the fortnight: every chest lift progressed.
const SESSIONS = [session('s2', 2, 25), session('s1', 5, 20)];

const mockTrain = {
  loading: false, error: null, errorKind: null, clearError: jest.fn(),
  catalog: [bench], templates: [], recentSessions: SESSIONS, active: null,
  saving: false, editingExisting: false,
  startWorkout: jest.fn(), startFromTemplate: jest.fn(), startCardioWorkout: jest.fn(),
  saveTemplate: jest.fn(), cloneStarterTemplate: jest.fn(), deleteTemplate: jest.fn(),
  addCatalogExercise: jest.fn(), addLibraryExercise: jest.fn(), addLibraryExerciseToActive: jest.fn(),
  editCatalogExercise: jest.fn(), deleteCatalogExercise: jest.fn(), mergeCatalogExercises: jest.fn(),
  addExerciseToActive: jest.fn(), moveExerciseInActive: jest.fn(), dispatch: jest.fn(),
  commitActive: jest.fn(), finishWorkout: jest.fn(), discardWorkout: jest.fn(), deleteSession: jest.fn(),
  reopenSession: jest.fn(), finishEdit: jest.fn(), cancelEdit: jest.fn(),
};

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }) }));
jest.mock('@/lib/offline-cache', () => ({
  ...jest.requireActual('@/lib/offline-cache'),
  readCache: jest.fn((_uid: string, slice: string) => Promise.resolve(slice === 'weights' ? mockWeights : null)),
}));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ endsAt: null, remainingNow: () => 0, start: jest.fn(), stop: jest.fn(), rearm: jest.fn() }),
  useRestCountdown: () => ({ remaining: 0, label: '0:00' }),
}));

import TrainScreen from '@/app/(app)/train';

beforeEach(() => {
  mockProfile = null;
  mockWeights = null;
});

async function openPanel() {
  const ui = await render(<TrainScreen />);
  await fireEvent.press(ui.getByTestId('cluster-audit-toggle'));
  return ui;
}

it('the fixture is what it claims: outside a cut, chest earns +1 because everything progressed', () => {
  const now = Date.now();
  const calls = volumeCalls(
    weeklyClusterAudit(SESSIONS, [bench], now),
    'maintenance',
    muscleSignals(SESSIONS, [bench], now),
  );
  expect(calls).toEqual([{ muscle: 'chest', clusters: 2, add: 1, reason: 'all-progressing' }]);
});

it('reads an unset phase as a cut, and says volume is held — even where a cluster was earned', async () => {
  const ui = await openPanel();
  expect(ui.getByTestId('volume-phase')).toHaveTextContent('Phase: Cut');
  expect(ui.getByTestId('volume-cut-hold')).toHaveTextContent('Volume is held in a cut — recovery comes first.');
  expect(ui.queryByTestId('volume-add-chest')).toBeNull();
  // The existing 2-6 audit is still there above it.
  expect(ui.getByTestId('cluster-audit-chest')).toBeTruthy();
  // No gate set: no gate line, and no cache read for it.
  expect(ui.queryByTestId('volume-gate')).toBeNull();
});

it('suggests +1 cluster with its reason outside a cut', async () => {
  mockProfile = { trainingPhase: 'maintenance' };
  const ui = await openPanel();
  expect(ui.getByTestId('volume-phase')).toHaveTextContent('Phase: Maintenance');
  expect(ui.getByTestId('volume-add-chest')).toHaveTextContent(
    'Chest: +1 cluster this week — every lift for it progressed over two weeks',
  );
  expect(ui.queryByTestId('volume-cut-hold')).toBeNull();
});

it('states the volume gate with the 7-day average, met outside a cut', async () => {
  mockProfile = { trainingPhase: 'bulk', volumeGateLb: 185 };
  mockWeights = { [dateKey(daysAgo(0))]: 184, [dateKey(daysAgo(1))]: 186, [dateKey(daysAgo(30))]: 200 };
  const ui = await openPanel();
  await waitFor(() => expect(ui.getByTestId('volume-gate')).toHaveTextContent(/7-day average: 185 lb/));
  expect(ui.getByTestId('volume-gate')).toHaveTextContent(
    /^Phase 2 volume unlocks at 185 lb on the 7-day average AND maintenance calories\. 7-day average: 185 lb · Unlocked\.$/,
  );
});

it('is never met in a cut, and omits the average when there is none', async () => {
  mockProfile = { trainingPhase: 'cut', volumeGateLb: 185 };
  mockWeights = null;
  const ui = await openPanel();
  await waitFor(() => expect(ui.getByTestId('volume-gate')).toHaveTextContent(/Not yet\.$/));
  expect(ui.getByTestId('volume-gate')).not.toHaveTextContent(/7-day average:/);
});
