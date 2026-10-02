/**
 * Zero is a value, from the set row to the CSV (2026-09-30).
 *
 * The report: twelve 2026-09-29 sets logged "at RIR 0" had no `rir` in
 * Firestore, and a bodyweight pull-up stored its load as 0 one week and as
 * nothing the next. No falsy check turned out to be the cause — but RIR 0 is
 * the effort standard (ADR-0039) and load 0 is the bodyweight representation
 * (CONTEXT.md, "Set load"), so a stray `if (rir)` anywhere on this path would
 * blank the single most common value in each column. This pins the UI half:
 * a real tap on RIR "0" and a real "0" typed into the load cell reach the
 * reducer as 0, and — replayed through the same core writer, reader and CSV
 * export the app uses — come out the other end as "0". The core half has its
 * own test (`packages/core/src/set-zero-roundtrip.test.ts`).
 */
import React from 'react';
import {
  applySessionAction,
  buildCsv,
  pruneUndefined,
  toSessionPatch,
  toWorkoutSession,
  type SessionAction,
} from '@macrolog/core';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession } from '@/lib/workout';

const mockActive = {
  id: 'live',
  date: new Date(2026, 8, 30, 8),
  status: 'active',
  exercises: [
    {
      exerciseId: 'pullup',
      name: 'Neutral-grip pull-up',
      logStyle: 'weight-reps',
      cues: [],
      sets: [
        { kind: 'activation', group: 1, done: false },
        { kind: 'mini', group: 1, done: false },
        { kind: 'mini', group: 1, done: false },
      ],
    },
  ],
} as unknown as WorkoutSession;

const mockDispatch = jest.fn().mockResolvedValue(undefined);

jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [
      { id: 'pullup', name: 'Neutral-grip pull-up', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
    ],
    templates: [],
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

beforeEach(() => mockDispatch.mockClear());

const patchesFor = (setIndex: number) =>
  mockDispatch.mock.calls
    .map((c) => c[0] as SessionAction)
    .filter((a): a is Extract<SessionAction, { type: 'patchSet' }> => a.type === 'patchSet' && a.setIndex === setIndex)
    .map((a) => a.patch);

async function logSetAtZero(ui: Awaited<ReturnType<typeof render>>, j: number, reps: string) {
  await fireEvent.changeText(ui.getByTestId(`set-weight-0-${j}`), '0');
  await fireEvent.changeText(ui.getByTestId(`set-count-0-${j}`), reps);
  await fireEvent.press(ui.getByTestId(`set-rir-0-${j}`));
  await waitFor(() => expect(ui.getByTestId('set-sheet-rir-0')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('set-sheet-rir-0'));
}

describe('RIR 0 and load 0 from the set row', () => {
  it('a tap on RIR "0" dispatches rir: 0, and a typed "0" load dispatches weight: 0', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-weight-0-0')).toBeTruthy());
    await logSetAtZero(ui, 0, '11');

    expect(patchesFor(0)).toContainEqual({ rir: 0 });
    expect(patchesFor(0)).toContainEqual({ weight: 0 });
  });

  it('what the row dispatched exports as "0" in setRir and setWeight', async () => {
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('set-weight-0-0')).toBeTruthy());
    const reps = ['11', '4', '3'];
    for (let j = 0; j < reps.length; j++) {
      // eslint-disable-next-line no-await-in-loop -- one set at a time, like a lifter
      await logSetAtZero(ui, j, reps[j]);
    }

    // The same reducer, writer and reader the hook and the export use.
    const session = mockDispatch.mock.calls
      .map((c) => c[0] as SessionAction)
      .reduce((s, a) => applySessionAction(s, a), mockActive);
    const patch = pruneUndefined(
      toSessionPatch({ exercises: session.exercises }, { timestamp: (d) => d.toISOString(), remove: () => null }),
    );
    const stored = { ...JSON.parse(JSON.stringify(patch)), status: 'completed', timestamp: { toDate: () => mockActive.date } };
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
      workoutSessions: [toWorkoutSession('live', stored)],
    });
    const [head, ...lines] = csv.trim().split('\n');
    const cols = head.split(',');
    const rows = lines
      .map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])))
      .filter((r) => r.type === 'workout_set');

    expect(rows.map((r) => [r.setWeight, r.setReps, r.setRir])).toEqual([
      ['0', '11', '0'],
      ['0', '4', '0'],
      ['0', '3', '0'],
    ]);
  });
});
