import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Train re-score 3 (2026-10-05, 85.3/100) — the screen half of its bugs and
 * gaps. The hook half (`activePending`, `addManyToActive`) is pinned in
 * `train.offline-first.test.ts`, the Lock Screen sweep in
 * `rest-timer-activity.test.ts`, the finish summary's new lines in core.
 * Same harness as `train.review.test.tsx`.
 */

const day = (n: number) => new Date(2026, 8, n);

const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
let mockOffline = false;
let mockProfile: { unitSystem?: string; preferredLocale?: string } | null = null;
let mockRestRemaining = 0;
const mockRestStart = jest.fn();

const mockTrain = {
  loading: false,
  error: null as Error | null,
  errorKind: null as 'save' | 'load' | null,
  clearError: jest.fn(),
  catalog: [
    { id: 'e1', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'e2', name: 'Row', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
  ],
  templates: [] as WorkoutTemplate[],
  recentSessions: [] as WorkoutSession[],
  active: null as WorkoutSession | null,
  activePending: false,
  saving: false,
  editingExisting: false,
  startWorkout: jest.fn(),
  startFromTemplate: jest.fn(),
  startCardioWorkout: jest.fn(),
  saveTemplate: jest.fn(),
  cloneStarterTemplate: jest.fn(),
  deleteTemplate: jest.fn().mockResolvedValue(undefined),
  addCatalogExercise: jest.fn(),
  addLibraryExercise: jest.fn(),
  addLibraryExerciseToActive: jest.fn(),
  addManyToActive: jest.fn().mockResolvedValue(undefined),
  editCatalogExercise: jest.fn().mockResolvedValue(undefined),
  deleteCatalogExercise: jest.fn().mockResolvedValue(undefined),
  mergeCatalogExercises: jest.fn().mockResolvedValue(undefined),
  addExerciseToActive: jest.fn(),
  moveExerciseInActive: jest.fn(),
  dispatch: jest.fn().mockResolvedValue(undefined),
  // Never resolves — what a commit is with no signal. Finish must not wait on it.
  commitActive: jest.fn(() => new Promise<void>(() => {})),
  finishWorkout: jest.fn().mockResolvedValue(true),
  discardWorkout: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  reopenSession: jest.fn(),
  finishEdit: jest.fn(),
  cancelEdit: jest.fn(),
};

// Native sheets present through a root `sheet` route that does not exist
// under jest; the JS sheet renders its children in place.
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/lib/connectivity', () => ({
  useIsOffline: () => mockOffline,
  isOffline: () => mockOffline,
}));
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  // The deadline is what the session reads; the bar's own countdown is
  // `useRestCountdown`, faked here to the same number.
  useRestTimer: () => ({
    endsAt: mockRestRemaining > 0 ? 1_000_000 : null,
    remainingNow: () => mockRestRemaining,
    start: mockRestStart,
    stop: jest.fn(),
    rearm: jest.fn(),
  }),
  useRestCountdown: (endsAt: number | null) => ({
    remaining: endsAt == null ? 0 : mockRestRemaining,
    label: '1:00',
  }),
}));

import TrainScreen from '@/app/(app)/train';

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'live',
    status: 'active',
    date: day(16),
    createdAt: day(16),
    updatedAt: day(16),
    exercises: [
      {
        exerciseId: 'e1',
        name: 'Bench',
        logStyle: 'weight-reps',
        cues: [],
        sets: [{ kind: 'working', weight: 100, reps: 5, done: true }, { kind: 'working' }],
      },
    ],
    ...over,
  } as WorkoutSession;
}

const pushA = {
  id: 't1',
  name: 'Push A',
  exercises: [
    { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
    { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
  ],
  createdAt: day(1),
  updatedAt: day(1),
} as unknown as WorkoutTemplate;

function completed(id: string, d: number, sets: WorkoutSession['exercises'][number]['sets'], exerciseId = 'e1'): WorkoutSession {
  return {
    id,
    status: 'completed',
    date: day(d),
    createdAt: day(d),
    updatedAt: day(d),
    exercises: [{ exerciseId, name: exerciseId === 'e1' ? 'Bench' : 'Row', logStyle: 'weight-reps', cues: [], sets }],
  } as WorkoutSession;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  mockProfile = null;
  mockRestRemaining = 0;
  mockTrain.active = null;
  mockTrain.activePending = false;
  mockTrain.error = null;
  mockTrain.errorKind = null;
  mockTrain.templates = [];
  mockTrain.recentSessions = [];
  mockTrain.editingExisting = false;
  mockTrain.finishWorkout.mockResolvedValue(true);
});

describe('bug 2 — no Start before the device has answered', () => {
  it('shows the spinner, not the Start buttons, while the journal read is out', async () => {
    mockTrain.activePending = true;
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('start-workout')).toBeNull();
    expect(ui.queryByTestId('start-run')).toBeNull();
  });

  it('and the open workout the moment the journal brings it', async () => {
    mockTrain.activePending = true;
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-header')).toBeTruthy();
  });
});

describe('the header clock (a11y)', () => {
  it('is one Text whose label says the elapsed time in words, then volume and progress', async () => {
    mockTrain.active = session({ date: new Date(Date.now() - 754_000) });
    const ui = await render(<TrainScreen />);
    const meta = ui.getByTestId('session-elapsed');
    expect(meta.props.accessibilityLabel).toMatch(/^12 minutes 3\d seconds elapsed, 500 lb, 0 of 1 done$/);
    expect(meta).toHaveTextContent(/^12:3\d · 500 lb · 0 of 1 done$/);
  });
});

describe('the set row', () => {
  it('a tick with nothing to accept says why, on screen', async () => {
    mockTrain.active = session({
      exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] }],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(mockShowToast).toHaveBeenCalledWith('Enter the reps first.', expect.anything());
    expect(mockTrain.dispatch).not.toHaveBeenCalled();
  });

  it('counts are whole: a number pad, and 8.5 is stored as 9', async () => {
    mockTrain.active = session({
      exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] }],
    });
    const ui = await render(<TrainScreen />);
    const reps = ui.getByTestId('set-count-0-0');
    expect(reps.props.keyboardType).toBe('number-pad');
    await fireEvent.changeText(reps, '8.5');
    expect(mockTrain.dispatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ type: 'patchSet', patch: { reps: 9 } }),
      { defer: true },
    );
  });

  it('writes a load with the locale\'s decimal mark (pt-BR: 102,5)', async () => {
    mockProfile = { unitSystem: 'metric', preferredLocale: 'pt-BR' };
    mockTrain.active = session({
      exercises: [{
        exerciseId: 'e1',
        name: 'Bench',
        logStyle: 'weight-reps',
        cues: [],
        // 102.5 kg, stored in pounds.
        sets: [{ kind: 'working', weight: 102.5 / 0.45359237 }],
      }],
    });
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-weight-0-0').props.value).toBe('102,5');
  });

  it('the set number reaches past its 36pt box', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-kind-0-0').props.hitSlop).toEqual({ left: 8, right: 8 });
  });
});

describe('the exercise ⋯ — history from inside the workout', () => {
  it('opens the lift\'s records read-only: no Edit, Merge or Delete mid-set', async () => {
    mockTrain.recentSessions = [completed('old', 10, [{ kind: 'working', weight: 90, reps: 5 }])];
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-history'));
    await waitFor(() => expect(ui.getByText('History')).toBeTruthy());
    expect(ui.queryByTestId('exercise-edit')).toBeNull();
    expect(ui.queryByTestId('exercise-delete')).toBeNull();
  });

  it('is not offered for a lift with no catalog entry', async () => {
    mockTrain.active = session({
      exercises: [{ exerciseId: 'gone', name: 'Old lift', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] }],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    expect(ui.getByTestId('ex-menu-replace')).toBeTruthy();
    expect(ui.queryByTestId('ex-menu-history')).toBeNull();
  });
});

describe('add several exercises at once', () => {
  it('ticks build a pick, a row tap joins it, and "Add (n)" adds them in one call', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('add-exercise'));
    await fireEvent.press(ui.getByTestId('add-ex-mine-0-pick'));
    // Once picking, a tap on a row ticks it rather than adding it alone.
    await fireEvent.press(ui.getByTestId('add-ex-mine-1'));
    expect(mockTrain.addExerciseToActive).not.toHaveBeenCalled();
    expect(ui.getByText('Add (2)')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('add-picked'));
    await waitFor(() => expect(mockTrain.addManyToActive).toHaveBeenCalledTimes(1));
    const picks = mockTrain.addManyToActive.mock.calls[0][0] as { kind: string; exercise: { id: string } }[];
    expect(picks.map((p) => [p.kind, p.exercise.id])).toEqual([['catalog', 'e1'], ['catalog', 'e2']]);
  });

  it('with nothing ticked, a row tap still adds that one at once', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('add-exercise'));
    await fireEvent.press(ui.getByTestId('add-ex-mine-1'));
    await waitFor(() => expect(mockTrain.addExerciseToActive).toHaveBeenCalledWith('Row', 'weight-reps', 'e2', 'working', undefined));
    expect(mockTrain.addManyToActive).not.toHaveBeenCalled();
  });
});

describe('Finish names what will not be saved, and the best set', () => {
  it('lists the lifts not started, and leads with the top set when there is no record', async () => {
    mockTrain.active = session({
      exercises: [
        { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight: 100, reps: 5, done: true }] },
        { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
      ],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    await waitFor(() => expect(ui.getByTestId('finish-unstarted')).toBeTruthy());
    expect(ui.getByText('Not started: Row. It won’t be saved.')).toBeTruthy();
    expect(ui.getByText('Top set: Bench 100 lb × 5')).toBeTruthy();
  });
});

describe('templates off iOS — Duplicate and Delete on the card', () => {
  it('a ⋯ beside Start opens them where there is no context menu', async () => {
    mockTrain.templates = [pushA];
    mockTrain.saveTemplate.mockResolvedValue(undefined);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('template-menu-t1'));
    await fireEvent.press(ui.getByTestId('template-menu-t1-duplicate'));
    expect(mockTrain.saveTemplate).toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('Push A') }));
    await fireEvent.press(ui.getByTestId('template-menu-t1'));
    await fireEvent.press(ui.getByTestId('template-menu-t1-delete'));
    expect(mockConfirm).toHaveBeenCalled();
  });
});
