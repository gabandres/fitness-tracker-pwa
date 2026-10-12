import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import { StyleSheet } from 'react-native';
import { TARGET } from '@/theme';

/**
 * Round-2 Train UX pass, agent L (2026-10-12, `reviews/FIX-L2.md`): the live
 * logger's rest bar at large text and its end padding (S23-3 / F7), the
 * reorder sheet's names at AX sizes (F3), one unit across the header and the
 * cards (S23-6 / F9), the RIR cell's width (F13) and the engine vocabulary
 * on default rows (S23-5 / F8).
 *
 * jest's react-native mock reports `fontScale: 2` — the session renders at
 * LARGE text unless a test says otherwise.
 */

const day = (n: number) => new Date(2026, 9, n);
const mockShowToast = jest.fn();
const mockAnnounce = jest.fn();
const mockRestStart = jest.fn();
let mockRestRemaining = 0;

const pushTemplate = {
  id: 'push', name: 'Push A', restMiniSec: 60, restClusterSec: 90,
  exercises: [
    { exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }, { kind: 'working' }] },
    { exerciseId: 'row', name: 'Row', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }] },
  ],
  createdAt: day(1), updatedAt: day(1),
} as unknown as WorkoutTemplate;

const bench = (sets: object[]) => ({ exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', cues: [], sets });
const live = (exercises: object[]) => ({
  id: 'live-s', date: day(11), status: 'active', templateId: 'push', templateName: 'Push A', exercises,
}) as unknown as WorkoutSession;

const mockTrain = {
  loading: false,
  error: null,
  errorKind: null,
  clearError: jest.fn(),
  catalog: [
    { id: 'bench', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'row', name: 'Row', muscles: ['back'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
  ],
  templates: [pushTemplate],
  drafts: [] as unknown[],
  pendingLoadTestFor: () => null,
  recentSessions: [] as WorkoutSession[],
  active: null as WorkoutSession | null,
  saving: false,
  editingExisting: false,
  startWorkout: jest.fn(),
  startFromTemplate: jest.fn(),
  startCardioWorkout: jest.fn(),
  saveTemplate: jest.fn().mockResolvedValue(undefined),
  addLibraryExerciseToActive: jest.fn().mockResolvedValue(undefined),
  addExerciseToActive: jest.fn().mockResolvedValue(undefined),
  addManyToActive: jest.fn().mockResolvedValue(undefined),
  moveExerciseInActive: jest.fn((_from: number, to: number) => ({ newIndex: to })),
  undoMove: jest.fn(),
  undoRemoval: jest.fn(),
  dispatch: jest.fn().mockResolvedValue(undefined),
  commitActive: jest.fn().mockResolvedValue(undefined),
  finishWorkout: jest.fn().mockResolvedValue(true),
  discardWorkout: jest.fn().mockResolvedValue(undefined),
  deleteSession: jest.fn(),
  reopenSession: jest.fn(),
  finishEdit: jest.fn(),
  cancelEdit: jest.fn(),
  editCatalogExercise: jest.fn(),
};

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: (...a: unknown[]) => mockAnnounce(...a),
  isScreenReaderOn: () => false,
}));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
// A fresh object per render, as the real hook's result is.
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => ({ ...mockTrain }) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/components/train/rest-notify-priming', () => ({
  decideRestNotifyPriming: async () => false,
  markRestNotifyPrimed: async () => undefined,
}));
jest.mock('../../modules/rest-timer-activity', () => ({
  startRestActivity: jest.fn(async () => null),
  updateRestActivity: jest.fn(async () => null),
  endRestActivity: jest.fn(async () => null),
  getRestActivityStatus: jest.fn(async () => 'stopped'),
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
    label: `1:${String(mockRestRemaining % 60).padStart(2, '0')}`,
  }),
}));

import TrainScreen from '@/app/(app)/train';
import { liftUsesRir } from '@/components/train/train-summary';

const rn = jest.requireActual('react-native');
const atFontScale = (fontScale: number) =>
  jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });

const patches = () => mockTrain.dispatch.mock.calls
  .map((c) => c[0])
  .filter((a: { type: string }) => a.type === 'patchSet')
  .map((a: { patch: Record<string, unknown> }) => a.patch);
const hidden = { includeHiddenElements: true };

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockRestRemaining = 0;
  mockTrain.recentSessions = [];
  mockTrain.active = live([bench([{ kind: 'working', done: false }, { kind: 'working', done: false }])]);
});

describe('S23-5 / F8 — the RIR column only where the lift uses RIR', () => {
  it('pure rule: logged RIR, a cluster (sets or declared), or RIR last time', () => {
    const w = { kind: 'working' as const };
    expect(liftUsesRir([w, w], [], undefined)).toBe(false);
    expect(liftUsesRir([w, w], [], 'straight')).toBe(false);
    expect(liftUsesRir([w, { ...w, rir: 2 }], [], undefined)).toBe(true); // never hide a logged value
    expect(liftUsesRir([w, { ...w, rir: 0 }], [], 'straight')).toBe(true); // 0 is a value
    expect(liftUsesRir([{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }], [], undefined)).toBe(true);
    expect(liftUsesRir([w], [], 'myoreps')).toBe(true);
    expect(liftUsesRir([w], [], 'rest-pause')).toBe(true);
    expect(liftUsesRir([w], [{ kind: 'working', reps: 8, rir: 1 }], undefined)).toBe(true);
    expect(liftUsesRir([w], [undefined, { kind: 'working', reps: 8 }], undefined)).toBe(false);
  });

  it('a straight lift with no RIR anywhere shows no RIR cell and no RIR header', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-count-0-0')).toBeTruthy();
    expect(ui.queryByTestId('set-rir-0-0')).toBeNull();
    expect(ui.queryByTestId('set-head-rir-0', hidden)).toBeNull();
  });

  it('…but RIR stays loggable from the set sheet, and a logged value brings the column back', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-kind-0-0'));
    await waitFor(() => expect(ui.getByTestId('set-sheet-rir-2')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('set-sheet-rir-2'));
    expect(patches()).toContainEqual({ rir: 2 });
    mockTrain.active = live([bench([{ kind: 'working', rir: 2, done: false }, { kind: 'working', done: false }])]);
    await ui.rerender(<TrainScreen />);
    expect(ui.getByTestId('set-rir-0-0').props.accessibilityValue).toEqual({ text: '2' });
    expect(ui.getByTestId('set-rir-0-1')).toBeTruthy();
    expect(ui.getByTestId('set-head-rir-0', hidden)).toBeTruthy();
  });

  it('a myo-rep cluster keeps the column — the activation\'s RIR is what the engine reads', async () => {
    mockTrain.active = live([bench([{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }])]);
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-rir-0-0')).toBeTruthy();
    expect(ui.getByTestId('set-rir-0-1')).toBeTruthy();
  });

  it('a lift that logged RIR last session keeps the column', async () => {
    mockTrain.recentSessions = [{
      id: 'prev', date: day(4), status: 'completed', templateId: 'push', templateName: 'Push A',
      exercises: [bench([{ kind: 'working', weight: 100, reps: 8, rir: 1, done: true }])],
    } as unknown as WorkoutSession];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-rir-0-0')).toBeTruthy();
  });
});

describe('F13 — the RIR cell is a full target wide', () => {
  it('minWidth is the platform target, not 38', async () => {
    mockTrain.active = live([bench([{ kind: 'activation', group: 1 }])]);
    const ui = await render(<TrainScreen />);
    const style = StyleSheet.flatten(ui.getByTestId('set-rir-0-0').props.style);
    expect(style.minWidth).toBeGreaterThanOrEqual(44);
    expect(style.minWidth).toBe(TARGET);
  });
});

describe('S23-5 / F8 — plain set-type words, the engine term in the description', () => {
  it('the set sheet says "First set" / "Mini-set" and names the activation set once, in the line under it', async () => {
    mockTrain.active = live([bench([{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }])]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-kind-0-0'));
    await waitFor(() => expect(ui.getByTestId('set-sheet-kind-activation')).toBeTruthy());
    const row = within(ui.getByTestId('set-sheet-kind-activation'));
    expect(row.getByText('First set')).toBeTruthy();
    expect(row.getByText(/Myo-reps calls it the activation set/)).toBeTruthy();
    expect(within(ui.getByTestId('set-sheet-kind-mini')).getByText('Mini-set')).toBeTruthy();
    expect(ui.queryByText('Activation')).toBeNull();
    expect(ui.getByTestId('set-kind-0-0').props.accessibilityLabel).toBe('Set 1a, type: First set');
  });

  it('an undeclared clustered lift offers "Add cluster" but not "Add continuation"', async () => {
    mockTrain.templates = [];
    mockTrain.active = { ...live([bench([{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }])]), templateId: undefined } as WorkoutSession;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await waitFor(() => expect(ui.getByTestId('ex-menu-replace')).toBeTruthy());
    expect(ui.getByTestId('ex-menu-cluster')).toBeTruthy();
    expect(ui.queryByTestId('ex-menu-block')).toBeNull();
    mockTrain.templates = [pushTemplate];
  });
});

describe('S23-6 / F9 — the header counts SETS, the unit the cards count', () => {
  it('"0 of 2 sets" with nothing logged, "1 of 3 sets" once one is', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-elapsed')).toHaveTextContent(/· 0 of 2 sets$/);
    mockTrain.active = live([
      bench([{ kind: 'working', weight: 100, reps: 8, done: true }, { kind: 'working' }]),
      { exerciseId: 'row', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
    ]);
    await ui.rerender(<TrainScreen />);
    expect(ui.getByTestId('session-elapsed')).toHaveTextContent(/· 1 of 3 sets$/);
    expect(ui.getByTestId('session-elapsed').props.accessibilityLabel).toMatch(/, 1 of 3 sets$/);
  });

  it('one set planned reads singular', async () => {
    mockTrain.active = live([bench([{ kind: 'working' }])]);
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-elapsed')).toHaveTextContent(/· 0 of 1 set$/);
  });
});

describe('S23-3 / F7 — the rest bar', () => {
  const tickFirst = async (ui: Awaited<ReturnType<typeof render>>) => {
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    await waitFor(() => expect(ui.getByTestId('rest-bar')).toBeTruthy());
  };
  beforeEach(() => {
    mockRestRemaining = 45;
    mockTrain.active = live([bench([{ kind: 'working', weight: 100, targetReps: 5 }, { kind: 'working', weight: 100, targetReps: 5 }])]);
  });

  it('large text: one line, its words capped — no stacked rows', async () => {
    const ui = await render(<TrainScreen />);
    await tickFirst(ui);
    expect(ui.getByTestId('rest-time').props.maxFontSizeMultiplier).toBe(1.4);
    expect(ui.getByTestId('rest-time').props.numberOfLines).toBe(1);
    expect(within(ui.getByTestId('rest-skip')).getByText('Skip').props.maxFontSizeMultiplier).toBe(1.3);
    // The label and the actions share ONE row (the stacked bar was a column).
    let row = ui.getByTestId('rest-label').parent;
    while (row && !within(row).queryByTestId('rest-skip')) row = row.parent;
    expect(StyleSheet.flatten(row?.props.style)).toEqual(expect.objectContaining({ flexDirection: 'row' }));
    expect(ui.queryByTestId('rest-next')).toBeNull();
  });

  it('default text: nothing capped, as before', async () => {
    atFontScale(1);
    const ui = await render(<TrainScreen />);
    await tickFirst(ui);
    expect(ui.getByTestId('rest-time').props.maxFontSizeMultiplier).toBeUndefined();
  });

  it('the list pads its end by the bar\'s height while it runs, so nothing is stuck under it', async () => {
    const ui = await render(<TrainScreen />);
    expect(StyleSheet.flatten(ui.getByTestId('session-end-pad').props.style).height).toBe(40);
    await tickFirst(ui);
    await fireEvent(ui.getByTestId('rest-bar'), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 340, height: 67.4 } } });
    expect(StyleSheet.flatten(ui.getByTestId('session-end-pad').props.style).height).toBe(40 + 68);
  });
});

describe('S23-3 / F3 — reorder names at accessibility sizes', () => {
  const open = async () => {
    mockTrain.active = live([
      { exerciseId: 'rdl', name: 'Romanian Deadlift', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
      bench([{ kind: 'working' }]),
    ]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-reorder'));
    await waitFor(() => expect(ui.getByTestId('reorder-name-0', hidden)).toBeTruthy());
    return ui;
  };

  it('large text: the name wraps to two lines, capped at 2×, with the arrows on a line of their own', async () => {
    const ui = await open();
    const name = ui.getByTestId('reorder-name-0', hidden);
    expect(name.props.numberOfLines).toBe(2);
    expect(name.props.maxFontSizeMultiplier).toBe(2);
    expect(within(ui.getByTestId('reorder-tail-0', hidden)).getByTestId('reorder-down-0', hidden)).toBeTruthy();
  });

  it('default text: one row, as before', async () => {
    atFontScale(1);
    const ui = await open();
    expect(ui.queryByTestId('reorder-tail-0', hidden)).toBeNull();
    expect(ui.getByTestId('reorder-down-0', hidden)).toBeTruthy();
  });
});
