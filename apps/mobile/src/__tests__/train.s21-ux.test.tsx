import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Train, S21 — the S20 / Impeccable review's JS-only items, pinned at the
 * screen: a live set field that is EMPTY says so (its grey number is last
 * time's, read as a hint, not as a value), removing a cardio block comes with
 * an Undo, a rest can be started by hand, the Finish sheet's fields are named,
 * and the engine's call is computed once per exercise state, not per caller.
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
import { recommendationFor } from '@/components/train/train-summary';
import { undoCardioRemoval } from '@/lib/train-removal';

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

function completed(id: string, d: number, weight: number): WorkoutSession {
  return {
    id,
    status: 'completed',
    date: day(d),
    createdAt: day(d),
    updatedAt: day(d),
    exercises: [{ exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight, reps: 5, done: true }] }],
  } as WorkoutSession;
}

const lastToast = () =>
  mockShowToast.mock.calls[mockShowToast.mock.calls.length - 1] as [string, { action?: { label: string; onPress: () => void } }?];

beforeEach(() => {
  jest.clearAllMocks();
  mockRestRemaining = 0;
  mockTrain.active = null;
  mockTrain.templates = [];
  mockTrain.recentSessions = [];
  mockTrain.editingExisting = false;
});

describe('a live set field says when it is empty', () => {
  it('an empty field is labelled empty, and its placeholder becomes the hint', async () => {
    mockTrain.recentSessions = [completed('c1', 10, 90)];
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    // Logged: no "empty"; last time's load is offered as a hint.
    const w0 = ui.getByTestId('set-weight-0-0');
    expect(w0.props.accessibilityLabel).toBe('Set 1 weight');
    expect(w0.props.accessibilityHint).toBe('Last time 90 lb');
    // Empty with a prescription: "empty", and the target as the hint.
    const c1 = ui.getByTestId('set-count-0-1');
    expect(c1.props.accessibilityLabel).toBe('Set 2 reps, empty');
    expect(c1.props.accessibilityHint).toBe('Target 5');
    // Empty with nothing to offer: "empty", no hint.
    const w2 = ui.getByTestId('set-weight-0-1');
    expect(w2.props.accessibilityLabel).toBe('Set 2 weight, empty');
    expect(w2.props.accessibilityHint).toBeUndefined();
  });

  it('a typed value drops the "empty"', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.changeText(ui.getByTestId('set-count-0-1'), '6');
    expect(ui.getByTestId('set-count-0-1').props.accessibilityLabel).toBe('Set 2 reps');
  });
});

describe('removing a cardio block', () => {
  it('comes with an Undo that puts the same block back at its index', async () => {
    const block = { modality: 'run', durationSec: 1800, source: 'health', sourceId: 'hk-1' };
    mockTrain.active = session({ cardio: [block] } as Partial<WorkoutSession>);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('cardio-remove-0'));
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'removeCardio', blockIndex: 0 });
    const [msg, opts] = lastToast();
    expect(msg).toBe('Cardio removed');
    expect(opts?.action?.label).toBe('Undo');
    opts?.action?.onPress();
    expect(mockTrain.undoRemoval).toHaveBeenCalledWith({ kind: 'cardio', index: 0, block });
  });

  it('the restore is positional and clamped', () => {
    const a = { modality: 'run', durationSec: 60, source: 'manual' } as const;
    const b = { modality: 'ride', durationSec: 60, source: 'manual' } as const;
    const x = { modality: 'swim', durationSec: 60, source: 'manual' } as const;
    expect(undoCardioRemoval({ cardio: [a, b] }, { index: 1, block: x }).cardio).toEqual([a, x, b]);
    expect(undoCardioRemoval({ cardio: [a] }, { index: 5, block: x }).cardio).toEqual([a, x]);
    expect(undoCardioRemoval<{ cardio?: (typeof x)[] }>({}, { index: 0, block: x }).cardio).toEqual([x]);
  });
});

describe('a rest can be started by hand', () => {
  it('the exercise menu starts the lift\'s rest without a ticked set', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest-now'));
    expect(mockRestStart).toHaveBeenCalledTimes(1);
    expect(mockRestStart.mock.calls[0][0]).toBeGreaterThan(0);
  });
});

describe('the Finish sheet names its fields', () => {
  it('body weight and sleep are labelled, not read as their dash', async () => {
    mockTrain.active = session();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('finish-workout'));
    await waitFor(() => expect(ui.getByTestId('finish-extras')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('finish-extras'));
    expect(ui.getByTestId('finish-bodyweight').props.accessibilityLabel).toBe('Bodyweight (lb)');
    expect(ui.getByTestId('finish-sleep').props.accessibilityLabel).toBe('Sleep, hours');
  });
});

describe('the engine\'s call is computed once per exercise state', () => {
  it('identical inputs return the identical answer; a new exercise object recomputes', () => {
    const live = session();
    const data = { recentSessions: [completed('c1', 10, 90)], catalog: mockTrain.catalog as never };
    const ex = live.exercises[0];
    const first = recommendationFor(data, 'e1', undefined, ex);
    expect(recommendationFor({ ...data }, 'e1', undefined, ex)).toBe(first);
    const typed = { ...ex, sets: [...ex.sets] };
    expect(recommendationFor(data, 'e1', undefined, typed)).not.toBe(first);
    expect(recommendationFor(data, 'e1', undefined, typed)).toEqual(first);
  });
});
