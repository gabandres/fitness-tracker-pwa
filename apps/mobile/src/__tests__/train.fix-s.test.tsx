import React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Final Train UX fix round, agent S (2026-10-12, `reviews/FIX-S.md`): the live
 * logger, the rest picker, the reorder sheet, the Finish notes and the
 * cross-tab pill — each re-score finding pinned where it can be.
 *
 * Note: jest's react-native mock reports `fontScale: 2`, so the session here
 * renders at LARGE text (`largeText` is ≥ 1.5).
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
import { needsLoad } from '@/components/train/SetRow';
import { pillSceneInset, PILL_TAB_CLEARANCE } from '@/components/train/ActiveWorkoutPill';
import { unloggedCardioNames } from '@/components/train/train-summary';
import { UNDO_TOAST_MS } from '@/components/Toast';

const patches = () => mockTrain.dispatch.mock.calls
  .map((c) => c[0])
  .filter((a: { type: string }) => a.type === 'patchSet')
  .map((a: { patch: Record<string, unknown> }) => a.patch);
const toastTexts = () => mockShowToast.mock.calls.map((c) => c[0]);

beforeEach(() => {
  jest.clearAllMocks();
  mockRestRemaining = 0;
  mockTrain.recentSessions = [];
  mockTrain.active = live([bench([{ kind: 'working', done: false }, { kind: 'working', done: false }])]);
});

describe('L-N1 / J-N3 — a row with nothing to offer shows a dash, never "0"', () => {
  it('reps and weight read "–" with no prescription and no last time', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-count-0-0').props.placeholder).toBe('–');
    expect(ui.getByTestId('set-weight-0-0').props.placeholder).toBe('–');
  });

  it('…and the tick on it is refused out loud, with the reason on screen', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([]);
    expect(toastTexts()).toContain('Enter the reps first.');
  });
});

describe('L-N2 / J-N4 — a weighted tick with no load asks for the weight', () => {
  it('pure rule: weighted, nothing typed, no last-time load', () => {
    expect(needsLoad(true, '', undefined)).toBe(true);
    expect(needsLoad(true, '0', undefined)).toBe(false); // a deliberate 0
    expect(needsLoad(true, '', { kind: 'working', weight: 135, reps: 8 })).toBe(false);
    expect(needsLoad(false, '', undefined)).toBe(false); // bodyweight / time
  });

  it('a target-reps row with no load is not logged as "× 8"', async () => {
    mockTrain.active = live([bench([{ kind: 'working', targetReps: 8, done: false }])]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([]);
    expect(toastTexts()).toContain('Enter the weight first.');
    // A typed weight — even 0 — lets the same tick through, reps accepted.
    await fireEvent.changeText(ui.getByTestId('set-weight-0-0'), '0');
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toContainEqual(expect.objectContaining({ reps: 8 }));
    expect(patches()).toContainEqual({ done: true });
  });

  it('a bodyweight lift is exempt: the tick accepts the target reps as before', async () => {
    mockTrain.active = live([{ exerciseId: 'pu', name: 'Pull-up', logStyle: 'bodyweight', cues: [], sets: [{ kind: 'working', targetReps: 6 }] }]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toContainEqual(expect.objectContaining({ reps: 6 }));
    expect(toastTexts()).not.toContain('Enter the weight first.');
  });
});

describe('L-N3 / L-N4 — a record sits inside its row and is said with the tick', () => {
  const best = [{
    id: 'old', date: day(4), status: 'completed', templateId: 'push',
    exercises: [bench([{ kind: 'working', weight: 90, reps: 5, done: true }])],
  } as unknown as WorkoutSession];

  it('the PR badge is drawn in the set-number cell, and the cell says it', async () => {
    mockTrain.recentSessions = best;
    mockTrain.active = live([bench([{ kind: 'working', weight: 100, reps: 5, done: true }, { kind: 'working' }])]);
    const ui = await render(<TrainScreen />);
    const cell = ui.getByTestId('set-kind-0-0');
    expect(within(cell).getByTestId('set-pr-0-0')).toBeTruthy();
    expect(cell.props.accessibilityLabel).toBe('Set 1, type: Working, New personal record');
  });

  it('a record tick announces it in the same breath as the rest', async () => {
    mockTrain.recentSessions = best;
    mockTrain.active = live([bench([{ kind: 'working', weight: 100, targetReps: 5 }, { kind: 'working', weight: 100 }])]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    const spoken = mockAnnounce.mock.calls.map((c) => c[0] as string).find((s) => s.startsWith('Set 1 logged'));
    expect(spoken).toMatch(/^Set 1 logged, 100 lb, 5 reps\. New personal record\. /);
  });
});

describe('L-N14 / L-N15 — removing a set names it, and the Undo stays 10 s', () => {
  it('the swipe action carries words and the set\'s label', async () => {
    const ui = await render(<TrainScreen />);
    const action = ui.getByTestId('set-swipe-delete-0-1');
    expect(action.props.accessibilityLabel).toBe('Remove set 2');
    expect(within(action).getByText('Remove 2')).toBeTruthy();
    await fireEvent.press(action);
    const [msg, opts] = mockShowToast.mock.calls.at(-1) as [string, { durationMs?: number }];
    expect(msg).toBe('Set 2 removed · Bench');
    expect(opts.durationMs).toBe(UNDO_TOAST_MS);
    expect(UNDO_TOAST_MS).toBeGreaterThanOrEqual(10_000);
  });
});

describe('L-N8 / J-N5 — the session header stays compact at large text', () => {
  it('drops the eyebrow, caps the title and keeps the meta on one shrinking line', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('session-eyebrow')).toBeNull();
    const title = ui.getByTestId('session-title');
    expect(title.props.accessibilityRole).toBe('header');
    expect(title.props.maxFontSizeMultiplier).toBe(1.4);
    const meta = ui.getByTestId('session-elapsed');
    expect(meta.props.numberOfLines).toBe(1);
    expect(meta.props.adjustsFontSizeToFit).toBe(true);
  });
});

describe('L-N5 / L-N6 / L-N7 — the plain rest picker', () => {
  it('a pick no longer closes it; Keep ticked AFTER the pick still saves, on Done', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await waitFor(() => expect(ui.getByTestId('rest-pick-180')).toBeTruthy());
    await fireEvent.press(ui.getByTestId('rest-pick-180'));
    expect(ui.getByTestId('rest-pick-180').props.accessibilityState).toEqual({ selected: true, checked: true });
    await fireEvent.press(ui.getByTestId('rest-keep-for-lift'));
    expect(mockTrain.saveTemplate).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('rest-picker-done'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalled());
    const [draft] = mockTrain.saveTemplate.mock.calls[0] as [WorkoutTemplate];
    expect(draft.exercises.find((e) => e.exerciseId === 'bench')?.restMiniSec).toBe(180);
  });

  it('opened from a running countdown it says the pick is for the next rests', async () => {
    mockRestRemaining = 45;
    mockTrain.active = live([bench([{ kind: 'working', weight: 100, targetReps: 5 }, { kind: 'working', weight: 100, targetReps: 5 }])]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    await fireEvent.press(ui.getByTestId('rest-label'));
    await waitFor(() => expect(ui.getByTestId('rest-picker-running-hint')).toHaveTextContent(/applies from the next rest/));
  });
});

describe('J-N2 — reorder without a drag', () => {
  it('each row has visible up/down arrows; a block edge disables the one that cannot move', async () => {
    mockTrain.active = live([
      bench([{ kind: 'working' }]),
      { exerciseId: 'row', name: 'Row', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
    ]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-reorder'));
    // Hidden from screen readers (the row's own Move up / Move down actions
    // serve them), so the query has to include hidden elements.
    const hidden = { includeHiddenElements: true };
    await waitFor(() => expect(ui.getByTestId('reorder-down-0', hidden)).toBeTruthy());
    expect(ui.getByTestId('reorder-up-0', hidden).props.accessibilityState).toEqual(expect.objectContaining({ disabled: true }));
    await fireEvent.press(ui.getByTestId('reorder-down-0', hidden));
    expect(mockTrain.moveExerciseInActive).toHaveBeenCalledWith(0, 1);
  });
});

describe('L-N10 / J-N8 — an exercise added mid-workout lands open', () => {
  it('the new card is the open one once it arrives', async () => {
    mockTrain.active = live([bench([{ kind: 'working' }])]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('add-exercise'));
    await fireEvent.changeText(ui.getByTestId('exercise-name'), 'Zercher Squat');
    await fireEvent.press(ui.getByTestId('create-exercise'));
    if (mockTrain.addExerciseToActive.mock.calls.length === 0) {
      // With style chips folded, the first tap opens them (L10).
      await fireEvent.press(ui.getByTestId('create-exercise'));
    }
    await waitFor(() => expect(mockTrain.addExerciseToActive).toHaveBeenCalled());
    mockTrain.active = live([
      bench([{ kind: 'working' }]),
      { exerciseId: 'z', name: 'Zercher Squat', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working' }] },
    ]);
    await ui.rerender(<TrainScreen />);
    await waitFor(() => expect(ui.getByTestId('exercise-head-1').props.accessibilityState).toEqual(expect.objectContaining({ expanded: true })));
    expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual(expect.objectContaining({ expanded: false }));
  });
});

describe('L-N13 — the set sheet checks the kind in force', () => {
  it('a check on the selected kind only', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-kind-0-0'));
    await waitFor(() => expect(ui.getByTestId('set-sheet-kind-working-check', { includeHiddenElements: true })).toBeTruthy());
    expect(ui.queryByTestId('set-sheet-kind-warmup-check', { includeHiddenElements: true })).toBeNull();
  });
});

describe('L-N12 — an unlogged planned cardio block is named before it is dropped', () => {
  const t = ((k: string) => ({ 'cardio.modality.run': 'Run', 'cardio.modality.ride': 'Ride' } as Record<string, string>)[k] ?? k) as never;
  it('names blocks with no duration, by label else modality; logged ones are not named', () => {
    expect(unloggedCardioNames({ cardio: [
      { modality: 'run', durationSec: 0 },
      { modality: 'ride', durationSec: 600 },
      { modality: 'ride', durationSec: 0, label: 'Zone 2 ride' },
    ] } as never, t)).toEqual(['Run', 'Zone 2 ride']);
    expect(unloggedCardioNames({}, t)).toEqual([]);
  });
});

describe('L-N11 / H-N3 / J-N7 — the pill never sits over a tab\'s content', () => {
  it('under the opaque bar it is in flow already: no inset', () => {
    expect(pillSceneInset(false, null, 34)).toBe(0);
    expect(pillSceneInset(false, 200, 34)).toBe(0);
  });

  it('under glass the content stops at the pill\'s top: the measured stack, else its parts', () => {
    expect(pillSceneInset(true, 187, 34)).toBe(187);
    // 44 pill + 4 margin + clearance + 64 capsule + 26 gap (34 inset − 8).
    expect(pillSceneInset(true, null, 34)).toBe(44 + 4 + PILL_TAB_CLEARANCE + 64 + 26);
  });

  it('the tab layout applies it as scene padding on every tab but Train', () => {
    const src = readFileSync(join(__dirname, '..', 'app/(app)/_layout.tsx'), 'utf8');
    expect(src).toMatch(/pillSceneInset\(GLASS_TAB_BAR, pillBand, insets\.bottom\)/);
    expect(src).toMatch(/route\.name !== 'train'/);
    expect(src).toMatch(/sceneStyle: \{ paddingBottom: pillInset, backgroundColor: colors\.paper \}/);
    // The font-scale hold is untouched.
    expect(src).toMatch(/hold=\{route\.name === 'train' && workoutActive\}/);
  });
});
