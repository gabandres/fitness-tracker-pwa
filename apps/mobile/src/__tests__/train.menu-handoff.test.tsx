import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Train re-score 3, bug 5: a pick from the SYSTEM ⋯ menu opens its sheet at
 * once. `handoff` waits 350 ms for a native sheet to finish dismissing, and
 * every menu pick paid it — but a native menu has already closed when its pick
 * fires. Here the binary "has" the native menu and native sheets, so the only
 * thing between the pick and the rest picker is that wait.
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
    NATIVE_SHEETS: true,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
/** Every `actions` array each ⋯ was rendered with, by testID. */
const mockMenuRenders = new Map<string, unknown[]>();
jest.mock('@/components/MenuButton', () => {
  const actual = jest.requireActual('@/components/MenuButton');
  return {
    ...actual,
    hasNativeMenuButton: true,
    MenuButton: (p: { testID?: string; actions: unknown }) => {
      if (p.testID) mockMenuRenders.set(p.testID, [...(mockMenuRenders.get(p.testID) ?? []), p.actions]);
      return actual.MenuButton(p);
    },
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



beforeEach(() => {
  jest.clearAllMocks();
  mockTrain.active = session();
});

it('a native ⋯ pick opens its sheet without the 350 ms handoff', async () => {
  const ui = await render(<TrainScreen />);
  jest.useFakeTimers();
  try {
    // `MenuButton` falls back to the sheet under jest (no native view); the
    // pick itself is what is under test.
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    expect(ui.getByText('Rest after each set')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('but a confirm still hands off — that one IS a sheet going away', async () => {
  const ui = await render(<TrainScreen />);
  jest.useFakeTimers();
  try {
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-replace'));
    // Bench has a logged set, so Replace asks first.
    const opts = mockConfirm.mock.calls[0][0] as { onConfirm: () => void };
    opts.onConfirm();
    expect(ui.queryByTestId('exercise-name')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(400);
    });
    expect(ui.getByTestId('exercise-name')).toBeTruthy();
  } finally {
    jest.useRealTimers();
  }
});

it('the open card keeps ONE menu array across a keystroke (re-score 3, performance)', async () => {
  const ui = await render(<TrainScreen />);
  const before = mockMenuRenders.get('exercise-menu-0')?.at(-1);
  expect(before).toBeDefined();
  mockMenuRenders.clear();
  // A typed weight: the session object changes, the menu's shape does not.
  const typed = session();
  typed.exercises[0].sets[1] = { kind: 'working', weight: 105 };
  mockTrain.active = typed;
  await ui.rerender(<TrainScreen />);
  const seen = mockMenuRenders.get('exercise-menu-0') ?? [];
  expect(seen.length).toBeGreaterThan(0);
  expect(seen.every((a) => a === before)).toBe(true);
});
