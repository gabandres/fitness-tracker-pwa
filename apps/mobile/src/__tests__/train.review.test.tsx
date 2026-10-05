import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * The Train review (2026-10-04, scored 67/100) — the screen half.
 *
 * The offline semantics are pinned at the hook (`train.offline-first.test.ts`)
 * and in core; this suite pins what the SCREEN does with them, and the
 * confirms, labels and affordances the review asked for. `confirm` is mocked
 * so a test can see the question asked and answer it.
 */

const day = (n: number) => new Date(2026, 8, n);

const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
let mockOffline = false;
let mockProfile: { unitSystem?: string } | null = null;
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
  useRestTimer: () => ({
    remaining: mockRestRemaining,
    label: '1:00',
    start: mockRestStart,
    stop: jest.fn(),
    rearm: jest.fn(),
  }),
}));

import TrainScreen from '@/app/(app)/train';
import * as haptics from '@/lib/haptics';

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

/** Answer the last confirm asked. */
function answerConfirm() {
  const opts = mockConfirm.mock.calls[mockConfirm.mock.calls.length - 1][0] as { onConfirm: () => void };
  opts.onConfirm();
}

beforeEach(() => {
  jest.clearAllMocks();
  mockOffline = false;
  mockProfile = null;
  mockRestRemaining = 0;
  mockTrain.active = null;
  mockTrain.error = null;
  mockTrain.errorKind = null;
  mockTrain.templates = [];
  mockTrain.recentSessions = [];
  mockTrain.editingExisting = false;
  mockTrain.finishWorkout.mockResolvedValue(true);
});

describe('Finish (bugs 2, 10)', () => {
  it('opens the sheet at once — it does not wait on a commit that offline never resolves', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    await waitFor(() => expect(ui.getByTestId('finish-confirm')).toBeTruthy());
    expect(mockTrain.commitActive).not.toHaveBeenCalled();
  });

  it('with nothing logged, offers to discard instead of saving an empty workout', async () => {
    mockTrain.active = session({
      exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight: 100 }] }],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    expect(ui.queryByTestId('finish-confirm')).toBeNull();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Nothing logged — discard instead?' }));
    answerConfirm();
    expect(mockTrain.discardWorkout).toHaveBeenCalled();
  });

  it('says "saved on this phone" when the finish is recorded offline', async () => {
    mockTrain.active = session();
    mockOffline = true;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() =>
      expect(mockShowToast).toHaveBeenCalledWith("Saved on this phone — syncs when you're back online."),
    );
    expect(haptics.success).toHaveBeenCalled();
  });

  it('summarises the workout: volume, sets, a new best', async () => {
    mockTrain.recentSessions = [completed('old', 10, [{ kind: 'working', weight: 90, reps: 5 }])];
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    const summary = await waitFor(() => ui.getByTestId('finish-summary'));
    expect(within(summary).getByText('500 lb')).toBeTruthy();
    expect(ui.getByTestId('finish-pr-e1')).toBeTruthy();
    expect(ui.getByText('New best: Bench 100 lb × 5')).toBeTruthy();
    // Body weight and sleep are optional, behind one row.
    expect(ui.queryByTestId('finish-bodyweight')).toBeNull();
    await fireEvent.press(ui.getByTestId('finish-extras'));
    expect(ui.getByTestId('finish-bodyweight')).toBeTruthy();
  });
});

describe('the live session (bugs 3, 5; items 5, 18)', () => {
  it('shows a save failure ON the workout, with a retry that re-sends it', async () => {
    mockTrain.active = session();
    mockTrain.error = new Error('nope');
    mockTrain.errorKind = 'save';
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-error')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('session-retry'));
    expect(mockTrain.clearError).toHaveBeenCalled();
    expect(mockTrain.commitActive).toHaveBeenCalled();
    expect(haptics.warning).toHaveBeenCalled();
  });

  it('offline, says the writes are saved on the phone', async () => {
    mockTrain.active = session();
    mockOffline = true;
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-saved-offline')).toBeTruthy();
    expect(ui.getByTestId('session-offline-note')).toHaveTextContent("Saved on this phone — syncs when you're back online.");
  });

  it('the header carries the name, the clock, and Finish', async () => {
    mockTrain.active = session({ templateName: 'Push A' });
    const ui = await render(<TrainScreen />);
    const header = ui.getByTestId('session-header');
    expect(within(header).getByText('Push A')).toBeTruthy();
    expect(within(header).getByTestId('session-elapsed')).toBeTruthy();
    expect(within(header).getByTestId('finish-workout')).toBeTruthy();
  });

  it('a collapsed card prints last time in the TRAINING unit (bug 5)', async () => {
    mockProfile = { unitSystem: 'metric' };
    mockTrain.recentSessions = [completed('old', 10, [{ kind: 'working', weight: 220, reps: 5 }], 'e2')];
    mockTrain.active = session({
      exercises: [
        { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
        { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
      ],
    });
    const ui = await render(<TrainScreen />);
    // Card 0 is open; card 1 is collapsed and shows the ghost.
    expect(ui.getByText('Last: 99.8 kg × 5')).toBeTruthy();
  });

  it('labels the set count, the done box, and the set number with its actions', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('exercise-head-0').props.accessibilityLabel).toContain('1 of 2 sets logged');
    expect(ui.getByTestId('set-done-0-0').props.accessibilityLabel).toBe('Set 1 done');
    const num = ui.getByTestId('set-kind-0-0');
    expect(num.props.accessibilityLabel).toBe('Set 1, type: Working');
    expect(num.props.accessibilityHint).toBeTruthy();
    expect(num.props.accessibilityActions.map((a: { name: string }) => a.name)).toContain('delete');
    await fireEvent(num, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
  });

  it('a ticked set that beats the best on record wears a PR badge', async () => {
    mockTrain.recentSessions = [completed('old', 10, [{ kind: 'working', weight: 90, reps: 5 }])];
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-pr-0-0')).toBeTruthy();
  });

  it('ticking the LAST set of a lift is a success haptic; an earlier tick is a tick (item 25)', async () => {
    const bench = (sets: WorkoutSession['exercises'][number]['sets']) =>
      session({ exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets }] });

    mockTrain.active = bench([{ kind: 'working', targetReps: 5 }, { kind: 'working', targetReps: 5 }]);
    const first = await render(<TrainScreen />);
    await fireEvent.press(first.getByTestId('set-done-0-0'));
    expect(haptics.tap).toHaveBeenCalled();
    expect(haptics.success).not.toHaveBeenCalled();
    await first.unmount();

    jest.clearAllMocks();
    mockTrain.active = bench([{ kind: 'working', reps: 5, done: true }, { kind: 'working', targetReps: 5 }]);
    const last = await render(<TrainScreen />);
    await fireEvent.press(last.getByTestId('set-done-0-1'));
    expect(haptics.success).toHaveBeenCalled();
  });

  it('a tick starts the rest, and hands its deadline to the lock-screen seam (item 20)', async () => {
    const { __currentRestActivity, end } = jest.requireActual('@/lib/rest-timer-activity') as typeof import('@/lib/rest-timer-activity');
    end();
    mockTrain.active = session({
      templateId: undefined,
      exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', targetReps: 5 }, { kind: 'working' }] }],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    // An ad-hoc session: the named default, not a literal buried in the logic.
    expect(mockRestStart).toHaveBeenCalledWith(60);
    expect(__currentRestActivity()).toEqual(expect.objectContaining({ endsAt: expect.any(Number), exerciseName: 'Bench' }));
    end();
  });

  it('the rest bar takes 30 s off, and says what its buttons do', async () => {
    mockTrain.active = session();
    mockRestRemaining = 60;
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('rest-plus').props.accessibilityLabel).toBe('Add 30 seconds');
    expect(ui.getByTestId('rest-minus').props.accessibilityLabel).toBe('Subtract 30 seconds');
    await fireEvent.press(ui.getByTestId('rest-minus'));
    expect(mockRestStart).toHaveBeenCalledWith(30);
  });

  it('Discard is in the session menu, behind a confirm', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('discard-workout')).toBeNull();
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-discard'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    expect(mockTrain.discardWorkout).not.toHaveBeenCalled();
  });

  it('the exercise menu moves a lift and offers to replace it', async () => {
    mockTrain.active = session({
      exercises: [
        { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
        { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
      ],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    expect(ui.queryByTestId('ex-menu-move-up')).toBeNull();
    await fireEvent.press(ui.getByTestId('ex-menu-move-down'));
    expect(mockTrain.moveExerciseInActive).toHaveBeenCalledWith(0, 1);

    await fireEvent.press(ui.getByTestId('exercise-menu-1'));
    await fireEvent.press(ui.getByTestId('ex-menu-replace'));
    await waitFor(() => expect(ui.getByText('Replace Row')).toBeTruthy());
  });
});

describe('the home screen (bugs 6, 7, 9; items 8, 10, 14, 32)', () => {
  it('"Next session" is a sibling of the edit button, which is labelled', async () => {
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    const edit = ui.getByTestId('edit-template-t1');
    expect(edit.props.accessibilityRole).toBe('button');
    expect(edit.props.accessibilityLabel).toBe('Edit Push A');
    expect(within(edit).queryByTestId('next-session-t1')).toBeNull();
    expect(ui.getByTestId('next-session-t1')).toBeTruthy();
    expect(ui.getByTestId('start-template-t1').props.accessibilityLabel).toBe('Start Push A');
    // The row says what is in it.
    expect(ui.getByText('Bench · Row')).toBeTruthy();
  });

  it('prints "no templates" once, not twice', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.getAllByText('No templates yet. Create one to start a workout in a tap.')).toHaveLength(1);
  });

  it('"Log a run" starts a cardio-only session', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('start-run'));
    expect(mockTrain.startCardioWorkout).toHaveBeenCalledWith('run');
  });

  it('deleting a template asks first', async () => {
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-t1'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('delete-template')));
    expect(mockTrain.deleteTemplate).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Delete this template?' }));
    answerConfirm();
    await waitFor(() => expect(mockTrain.deleteTemplate).toHaveBeenCalledWith('t1'));
  });

  it('a refused template delete is said, not swallowed', async () => {
    mockTrain.templates = [pushA];
    mockTrain.deleteTemplate.mockRejectedValueOnce(new Error('denied'));
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-t1'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('delete-template')));
    answerConfirm();
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    expect(haptics.warning).toHaveBeenCalled();
  });

  it('dismissing the editor with changes asks; without changes it just closes (bug 8)', async () => {
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-t1'));
    await waitFor(() => expect(ui.getByTestId('template-name')).toBeTruthy());

    await fireEvent.changeText(ui.getByTestId('template-name'), 'Push B');
    await fireEvent.press(ui.getByTestId('template-backdrop'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Discard changes?' }));
    expect(ui.getByTestId('template-name')).toBeTruthy();

    await fireEvent.changeText(ui.getByTestId('template-name'), 'Push A');
    mockConfirm.mockClear();
    await fireEvent.press(ui.getByTestId('template-backdrop'));
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('merging an exercise asks first — and refuses offline', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-e1'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('exercise-merge')));
    await fireEvent.press(ui.getByTestId('merge-into-e2'));
    expect(mockTrain.mergeCatalogExercises).not.toHaveBeenCalled();
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Merge into Row?' }));
    answerConfirm();
    await waitFor(() => expect(mockTrain.mergeCatalogExercises).toHaveBeenCalledWith('e1', 'e2'));

    mockOffline = true;
    mockConfirm.mockClear();
    await fireEvent.press(ui.getByTestId('exercise-e1'));
    await fireEvent.press(await waitFor(() => ui.getByTestId('exercise-merge')));
    await fireEvent.press(ui.getByTestId('merge-into-e2'));
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalledWith("Merging needs a connection. Try again when you're back online.");
  });

  it('history rows are buttons with Delete as an accessibility action', async () => {
    mockTrain.recentSessions = [completed('s1', 10, [{ kind: 'working', weight: 100, reps: 5 }])];
    const ui = await render(<TrainScreen />);
    const row = ui.getByTestId('session-s1');
    expect(row.props.accessibilityRole).toBe('button');
    expect(row.props.accessibilityHint).toBe('Opens this workout to edit.');
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Delete' }));
  });

  it('caps history at ten rows, with Show all for the rest', async () => {
    mockTrain.recentSessions = Array.from({ length: 12 }, (_, i) =>
      completed(`s${i}`, 1 + i, [{ kind: 'working', weight: 100, reps: 5 }]),
    );
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('session-s11')).toBeNull();
    expect(ui.getByTestId('history-show-all')).toHaveTextContent('Show all (12)');
  });
});
