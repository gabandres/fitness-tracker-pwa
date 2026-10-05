import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * The Train re-score (S20, 2026-10-04, 79/100) — every verified bug and gap
 * that is JS-only, pinned at the screen.
 *
 * Bugs: an Activity that outlived a JS restart is re-adopted (2), removals
 * come with an Undo (3), the exercise chart says what it is (5), the idle
 * save error says Dismiss (7), accepting a recommendation writes once (9).
 * Gaps: auto-advance, an Undo on set delete, drag reorder (its rotor half),
 * a read-only history detail, a per-lift rest that can be kept, a rest bar
 * with localized buttons and a 10-second warning, the template card's menu,
 * the rest on the pill, a share card and the PR heading.
 *
 * The rest TIMER's own rules (late buzz, the notification sweep) are pinned at
 * the hook in `rest-timer*.test.ts`; the seam's in `rest-timer-activity.test.ts`.
 */

const day = (n: number) => new Date(2026, 8, n);

const mockConfirm = jest.fn();
const mockShowToast = jest.fn();
const mockAnnounce = jest.fn();
let mockRestRemaining = 0;
const mockRestStart = jest.fn();
const mockStatus = jest.fn(async () => 'stopped');

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
  saveTemplate: jest.fn().mockResolvedValue(undefined),
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
  undoRemoval: jest.fn(),
  dispatch: jest.fn().mockResolvedValue(undefined),
  commitActive: jest.fn().mockResolvedValue(undefined),
  finishWorkout: jest.fn().mockResolvedValue(true),
  discardWorkout: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  reopenSession: jest.fn(),
  finishEdit: jest.fn(),
  cancelEdit: jest.fn(),
};

jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: (...a: unknown[]) => mockAnnounce(...a),
}));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/shareCapture', () => ({ captureAndShare: jest.fn(async () => undefined) }));
jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: jest.fn(async () => null),
  updateRestActivity: jest.fn(async () => null),
  endRestActivity: jest.fn(async () => null),
  getRestActivityStatus: () => mockStatus(),
}));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({
    endsAt: mockRestRemaining > 0 ? 1_000_000 : null,
    remainingNow: () => mockRestRemaining,
    start: mockRestStart,
    stop: jest.fn(),
    rearm: jest.fn(),
  }),
  useRestCountdown: (endsAt: number | null) => ({
    remaining: endsAt == null ? 0 : mockRestRemaining,
    label: `0:${String(mockRestRemaining).padStart(2, '0')}`,
  }),
}));
// The system menu is iOS-native and renders its child alone under jest; this
// draws its actions as buttons so a test can choose one.
jest.mock('@/components/ContextMenu', () => {
  const { View: V, Text: T, TouchableOpacity: Btn } = require('react-native');
  return {
    CONTEXT_MENUS: false,
    ContextMenu: ({ children, actions, title }: {
      children: React.ReactNode;
      title?: string;
      actions: { key: string; title: string; onPress: () => void }[];
    }) => (
      <V>
        {children}
        {actions.map((a) => (
          <Btn key={a.key} onPress={a.onPress} testID={`menu-${title}-${a.key}`}>
            <T>{a.title}</T>
          </Btn>
        ))}
      </V>
    ),
  };
});

import TrainScreen from '@/app/(app)/train';
import { ActiveWorkoutPill } from '@/components/train/ActiveWorkoutPill';
import { ExerciseDetailSheet } from '@/components/train/ExerciseDetailSheet';
import { __resetActiveWorkoutSignal, publishActiveWorkout, publishRestEndsAt } from '@/lib/active-workout-signal';
import { __resetRestActivity } from '@/lib/rest-timer-activity';

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
        sets: [{ kind: 'working', weight: 100, reps: 5, done: true }, { kind: 'working', targetReps: 5 }],
      },
      { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
    ],
    ...over,
  } as WorkoutSession;
}

function completed(id: string, d: number, weight: number, extra: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id,
    status: 'completed',
    date: day(d),
    createdAt: day(d),
    updatedAt: day(d),
    exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight, reps: 5, done: true }] }],
    ...extra,
  } as WorkoutSession;
}

const pushA = {
  id: 't1',
  name: 'Push A',
  exercises: [
    { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }, { kind: 'working' }] },
    { exerciseId: 'e2', name: 'Row', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
  ],
  createdAt: day(1),
  updatedAt: day(1),
} as unknown as WorkoutTemplate;

/** The last toast's options. */
const lastToast = () =>
  mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1] as [string, { action?: { label: string; onPress: () => void } }?];

beforeEach(() => {
  jest.clearAllMocks();
  __resetRestActivity();
  __resetActiveWorkoutSignal();
  mockRestRemaining = 0;
  mockStatus.mockImplementation(async () => 'stopped');
  mockTrain.active = null;
  mockTrain.error = null;
  mockTrain.errorKind = null;
  mockTrain.templates = [];
  mockTrain.recentSessions = [];
  mockTrain.editingExisting = false;
});

describe('removals come with an Undo (bug 3, the set-delete gap)', () => {
  it('a set deleted from the rotor is put back by the toast\'s Undo, by exercise id', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent(ui.getByTestId('set-kind-0-0'), 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
    const [msg, opts] = lastToast();
    expect(msg).toBe('Set removed');
    expect(opts?.action?.label).toBe('Undo');
    opts?.action?.onPress();
    expect(mockTrain.undoRemoval).toHaveBeenCalledWith({
      kind: 'set',
      exerciseIndex: 0,
      exerciseId: 'e1',
      setIndex: 0,
      set: { kind: 'working', weight: 100, reps: 5, done: true },
    });
  });

  it('the swipe\'s delete goes the same way', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-swipe-delete-0-1'));
    expect(lastToast()[0]).toBe('Set removed');
  });

  it('Remove exercise — which used to drop logged sets with no confirm and no undo — is undoable', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-remove'));
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'removeExercise', exerciseIndex: 0 });
    const [msg, opts] = lastToast();
    expect(msg).toBe('Bench removed');
    opts?.action?.onPress();
    expect(mockTrain.undoRemoval).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'exercise', index: 0, exercise: expect.objectContaining({ exerciseId: 'e1' }) }),
    );
  });
});

describe('the live session', () => {
  it('finishing a lift opens the next unfinished one by itself', async () => {
    jest.useFakeTimers();
    try {
      mockTrain.active = session();
      const ui = await render(<TrainScreen />);
      expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual({ expanded: true });
      await fireEvent.press(ui.getByTestId('set-done-0-1'));
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-1').props.accessibilityState).toEqual({ expanded: true });
      expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual({ expanded: false });
    } finally {
      jest.useRealTimers();
    }
  });

  it('the rest bar\'s buttons read through i18n and −30 s works from the clock', async () => {
    mockTrain.active = session();
    mockRestRemaining = 45;
    const ui = await render(<TrainScreen />);
    expect(within(ui.getByTestId('rest-minus')).getByText('−30s')).toBeTruthy();
    expect(within(ui.getByTestId('rest-plus')).getByText('+30s')).toBeTruthy();
    expect(ui.getByTestId('rest-label')).toHaveTextContent('Rest · 0:45');
    await fireEvent.press(ui.getByTestId('rest-minus'));
    expect(mockRestStart).toHaveBeenCalledWith(15);
  });

  it('says "10 seconds of rest left" once on the way down', async () => {
    mockTrain.active = session();
    mockRestRemaining = 12;
    const ui = await render(<TrainScreen />);
    expect(mockAnnounce).not.toHaveBeenCalledWith('10 seconds of rest left');
    mockRestRemaining = 9;
    await ui.rerender(<TrainScreen />);
    expect(mockAnnounce).toHaveBeenCalledWith('10 seconds of rest left');
  });

  it('puts back a rest the Lock Screen was still counting after a JS restart (bug 2)', async () => {
    mockStatus.mockImplementation(async () => `running:${Date.now() + 40_000}`);
    mockTrain.active = session();
    await render(<TrainScreen />);
    await waitFor(() => expect(mockRestStart).toHaveBeenCalled());
    const secs = mockRestStart.mock.calls[0][0] as number;
    expect(secs).toBeGreaterThanOrEqual(39);
    expect(secs).toBeLessThanOrEqual(40);
  });

  it('a rest picked for one lift can be kept on the template row (the lost-on-restart gap)', async () => {
    mockTrain.templates = [pushA];
    mockTrain.active = session({ templateId: 't1', templateName: 'Push A' });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await waitFor(() => expect(ui.getByTestId('rest-keep-for-lift')).toBeTruthy());
    expect(ui.getByTestId('rest-keep-for-lift').props.accessibilityState).toEqual({ checked: false });
    await fireEvent.press(ui.getByTestId('rest-keep-for-lift'));
    await fireEvent.press(ui.getByTestId('rest-pick-180'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalled());
    const [draft, id] = mockTrain.saveTemplate.mock.calls[0] as [WorkoutTemplate, string];
    expect(id).toBe('t1');
    expect(draft.exercises.find((e) => e.exerciseId === 'e1')?.restMiniSec).toBe(180);
    expect(draft.exercises.find((e) => e.exerciseId === 'e2')?.restMiniSec).toBeUndefined();
    expect(draft).not.toHaveProperty('id');
  });

  it('an ad-hoc lift has no template to keep a rest on, so it is not offered', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await waitFor(() => expect(ui.getByTestId('rest-pick-default')).toBeTruthy());
    expect(ui.queryByTestId('rest-keep-for-lift')).toBeNull();
  });

  it('Reorder exercises: the sheet\'s rows move with the rotor (the drag is device-proven)', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-reorder'));
    await waitFor(() => expect(ui.getByTestId('reorder-row-0')).toBeTruthy());
    await fireEvent(ui.getByTestId('reorder-row-0'), 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    expect(mockTrain.moveExerciseInActive).toHaveBeenCalledWith(0, 1);
  });
});

describe('the idle screen', () => {
  it('a save error there says Dismiss — there is nothing to retry (bug 7)', async () => {
    mockTrain.error = new Error('x');
    mockTrain.errorKind = 'save';
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('retry')).toHaveTextContent('Dismiss');
    await fireEvent.press(ui.getByTestId('retry'));
    expect(mockTrain.clearError).toHaveBeenCalled();
  });

  it('a history row opens a read-only detail; Edit is inside it', async () => {
    mockTrain.recentSessions = [completed('s2', 10, 120, { templateName: 'Push A' }), completed('s1', 3, 100)];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-s2'));
    expect(mockTrain.reopenSession).not.toHaveBeenCalled();
    const detail = await waitFor(() => ui.getByTestId('session-detail'));
    // Judged against the sessions BEFORE it: 120 × 5 beats the 100 × 5 of the 3rd.
    expect(within(detail).getByTestId('detail-pr-e1')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('session-detail-edit'));
    // After the sheet has gone (`afterSheet`): a native sheet's owner must
    // still be mounted to close it.
    await waitFor(() => expect(mockTrain.reopenSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's2' })));
  });

  it('the oldest workout is credited with no record (nothing came before it)', async () => {
    mockTrain.recentSessions = [completed('s2', 10, 120), completed('s1', 3, 100)];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-s1'));
    await waitFor(() => expect(ui.getByTestId('session-detail')).toBeTruthy());
    expect(ui.queryByTestId('detail-pr-e1')).toBeNull();
  });

  it('the history menu still edits straight away, and offers Share', async () => {
    mockTrain.recentSessions = [completed('s1', 3, 100)];
    const ui = await render(<TrainScreen />);
    const title = ui.getAllByTestId(/^menu-.*-edit$/)[0];
    await fireEvent.press(title);
    expect(mockTrain.reopenSession).toHaveBeenCalledWith(expect.objectContaining({ id: 's1' }));
    expect(ui.getAllByTestId(/^menu-.*-share$/).length).toBeGreaterThan(0);
  });

  it('the template card\'s menu starts, duplicates and deletes (behind a confirm)', async () => {
    mockTrain.templates = [pushA];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('menu-Push A-start'));
    expect(mockTrain.startFromTemplate).toHaveBeenCalledWith(pushA);

    await fireEvent.press(ui.getByTestId('menu-Push A-duplicate'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalled());
    const [draft, id] = mockTrain.saveTemplate.mock.calls[0] as [WorkoutTemplate, string | undefined];
    expect(id).toBeUndefined();
    expect(draft.name).toBe('Push A (copy)');
    expect(draft.exercises).toHaveLength(2);
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Template duplicated', expect.anything()));

    await fireEvent.press(ui.getByTestId('menu-Push A-delete'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true, title: 'Delete this template?' }));
    expect(mockTrain.deleteTemplate).not.toHaveBeenCalled();
  });

  it('the Finish receipt offers Share; finishing a record leads with it', async () => {
    mockTrain.recentSessions = [completed('s1', 3, 100)];
    mockTrain.active = session({
      exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight: 150, reps: 5, done: true }] }],
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    await waitFor(() => expect(ui.getByTestId('finish-pr-hero')).toHaveTextContent(/New personal record!/));
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
    const [msg, opts] = lastToast();
    expect(msg).toBe('Workout saved');
    expect(opts?.action?.label).toBe('Share');
  });
});

describe('the exercise chart says what it is (bug 5)', () => {
  it('names the metric and counts SESSIONS, with the unit in the points', async () => {
    const train = {
      recentSessions: [completed('s3', 12, 110), completed('s2', 8, 105), completed('s1', 3, 100)],
      catalog: mockTrain.catalog,
      editCatalogExercise: jest.fn(),
      deleteCatalogExercise: jest.fn(),
      mergeCatalogExercises: jest.fn(),
    } as unknown as React.ComponentProps<typeof ExerciseDetailSheet>['train'];
    const ui = await render(
      <ExerciseDetailSheet visible exercise={mockTrain.catalog[0] as never} train={train} onClose={() => {}} />,
    );
    const label = ui.getByTestId('exercise-chart').props.accessibilityLabel as string;
    expect(label).toMatch(/^Estimated 1RM trend, last 3 sessions, \d+ lb to \d+ lb, trending up$/);
    expect(label).not.toMatch(/Weight|days/);
  });
});

describe('the pill carries the rest', () => {
  it('shows the rest countdown instead of the elapsed clock while one runs', async () => {
    mockRestRemaining = 30;
    publishActiveWorkout(undefined, { templateName: 'Push A', date: new Date(), status: 'active' });
    const ui = await render(<ActiveWorkoutPill onResume={() => {}} />);
    expect(ui.queryByTestId('active-workout-pill-rest')).toBeNull();
    await act(async () => publishRestEndsAt(Date.now() + 30_000));
    expect(ui.getByTestId('active-workout-pill-rest')).toHaveTextContent('Rest 0:30');
    expect(ui.getByTestId('active-workout-pill').props.accessibilityLabel).toBe('Push A, rest 0:30 left. Resume workout');
    await act(async () => publishRestEndsAt(null));
    expect(ui.queryByTestId('active-workout-pill-rest')).toBeNull();
  });

  it('a late rest from a closed session cannot light the pill', async () => {
    publishRestEndsAt(Date.now() + 30_000);
    mockRestRemaining = 30;
    const ui = await render(<ActiveWorkoutPill onResume={() => {}} />);
    expect(ui.queryByTestId('active-workout-pill')).toBeNull();
  });
});
