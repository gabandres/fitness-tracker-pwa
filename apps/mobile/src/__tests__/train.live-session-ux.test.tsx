import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { finishSummary } from '@macrolog/core';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * The live logger's Train UX pass (2026-10-11, review `L-live-session.md`),
 * pinned at the screen. The superset rest rules (L1) are core's and pinned in
 * `packages/core/src/superset.test.ts`. (L17, the mid-workout relayout
 * release, was reverted by fix R: it remounted the screen mid-workout.)
 */

const day = (n: number) => new Date(2026, 9, n);
const mockConfirm = jest.fn();
const mockAnnounce = jest.fn();
const mockRestStart = jest.fn();
let mockRestRemaining = 0;

const pushTemplate = {
  id: 'push', name: 'Push A', restMiniSec: 60, restClusterSec: 90,
  exercises: [{ exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', plannedSets: [{ kind: 'working' }, { kind: 'working' }] }],
  createdAt: day(1), updatedAt: day(1),
} as unknown as WorkoutTemplate;

/** Last Push A: 135 × 8, 135 × 6 — what an untyped tick accepts. */
const lastPush = {
  id: 's-last', date: day(4), status: 'completed', templateId: 'push',
  exercises: [{
    exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', cues: [],
    sets: [{ kind: 'working', weight: 135, reps: 8, done: true }, { kind: 'working', weight: 135, reps: 6, done: true }],
  }],
} as unknown as WorkoutSession;

const live = (sets: object[] = [{ kind: 'working', done: false }, { kind: 'working', done: false }]) => ({
  id: 'live', date: day(11), status: 'active', templateId: 'push', templateName: 'Push A',
  exercises: [{ exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', cues: [], sets }],
}) as unknown as WorkoutSession;

const mockTrain = {
  loading: false,
  error: null,
  errorKind: null,
  clearError: jest.fn(),
  catalog: [{ id: 'bench', name: 'Bench', muscles: ['chest'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) }],
  templates: [pushTemplate],
  drafts: [] as unknown[],
  pendingLoadTestFor: () => null,
  recentSessions: [lastPush] as WorkoutSession[],
  active: null as WorkoutSession | null,
  saving: false,
  editingExisting: false,
  startWorkout: jest.fn(),
  startFromTemplate: jest.fn(),
  startCardioWorkout: jest.fn(),
  saveTemplate: jest.fn().mockResolvedValue(undefined),
  addLibraryExerciseToActive: jest.fn(),
  addExerciseToActive: jest.fn(),
  moveExerciseInActive: jest.fn(),
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
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: (...a: unknown[]) => mockAnnounce(...a),
  isScreenReaderOn: () => false,
}));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
// A fresh object per render, as the real hook's result is: the screen is
// compiler-memoized on it, so the same object would never show a new session.
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
    remaining: mockRestRemaining,
    running: mockRestRemaining > 0,
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

const patches = () => mockTrain.dispatch.mock.calls
  .map((c) => c[0])
  .filter((a: { type: string }) => a.type === 'patchSet')
  .map((a: { patch: Record<string, unknown> }) => a.patch);

beforeEach(() => {
  jest.clearAllMocks();
  mockRestRemaining = 0;
  mockTrain.active = live();
  mockTrain.recentSessions = [lastPush];
});

describe('L2 — an untick takes back what the tick accepted', () => {
  it('reps TYPED, load filled by the tick: untick takes back only the load — the row is as it was before the tick (fix R)', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.changeText(ui.getByTestId('set-count-0-0'), '8');
    expect(patches()).toContainEqual({ reps: 8 });
    mockTrain.active = live([{ kind: 'working', reps: 8, done: false }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    mockTrain.dispatch.mockClear();
    // The tick keeps the typed 8 and fills only the load.
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).not.toContainEqual({ reps: 8 });
    expect(patches()).toContainEqual({ weight: 135 });
    mockTrain.active = live([{ kind: 'working', weight: 135, reps: 8, done: true }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    mockTrain.dispatch.mockClear();
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    // Exactly the pre-tick fields: the typed reps stay, the filled load goes.
    expect(patches()).toEqual([{ done: false, weight: undefined }]);
    await waitFor(() => expect(ui.getByTestId('set-weight-0-0').props.value).toBe(''));
    expect(ui.getByTestId('set-count-0-0').props.value).toBe('8');
    // That row — typed, never left ticked — is what Finish names (F9): "1 set
    // has numbers but no tick", before anything is saved.
    const after = live([{ kind: 'working', reps: 8, done: false }, { kind: 'working', done: false }]);
    expect(finishSummary(after, [lastPush], Date.now()).untickedSets).toBe(1);
  });

  it('tick (accepts 135 × 8) then untick clears reps and load in the same write', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toContainEqual({ reps: 8 });
    expect(patches()).toContainEqual({ weight: 135 });
    mockTrain.active = live([{ kind: 'working', weight: 135, reps: 8, done: true }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    mockTrain.dispatch.mockClear();
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([{ done: false, reps: undefined, weight: undefined }]);
    await waitFor(() => expect(ui.getByTestId('set-count-0-0').props.value).toBe(''));
    expect(ui.getByTestId('set-weight-0-0').props.value).toBe('');
  });

  it('never erases what was typed: typed reps, then tick, then untick → only done:false', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.changeText(ui.getByTestId('set-count-0-0'), '10');
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    // The load was still accepted from last time; the reps were typed.
    mockTrain.active = live([{ kind: 'working', weight: 135, reps: 10, done: true }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    mockTrain.dispatch.mockClear();
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([{ done: false, weight: undefined }]);
  });

  it('an edit after the tick makes the values the lifter\'s: the untick keeps them', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    mockTrain.active = live([{ kind: 'working', weight: 135, reps: 8, done: true }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    await fireEvent.changeText(ui.getByTestId('set-weight-0-0'), '140');
    mockTrain.active = live([{ kind: 'working', weight: 140, reps: 8, done: true }, { kind: 'working', done: false }]);
    await ui.rerender(<TrainScreen />);
    mockTrain.dispatch.mockClear();
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([{ done: false }]);
  });
});

describe('L6 — five stops per set, and the tick says what it logged', () => {
  it('PREVIOUS is not a focus stop', async () => {
    // The jest window renders the large-text layout, so this is the line
    // above the row; the column at standard sizes carries the same two props.
    const ui = await render(<TrainScreen />);
    const line = ui.getByTestId('set-prev-line-0-0', { includeHiddenElements: true });
    expect(line.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(line.props.accessibilityElementsHidden).toBe(true);
  });

  it('one announcement: the logged values, then the rest', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(mockAnnounce).toHaveBeenLastCalledWith('Set 1 logged, 135 lb, 8 reps. Rest, 1 minute');
  });
});

describe('L4 — the workout gets the screen', () => {
  it('hides the page header during a workout; the glossary is in the session ⋯', async () => {
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('train-glossary-open')).toBeNull();
    await fireEvent.press(ui.getByTestId('session-menu'));
    expect(ui.getByTestId('session-menu-glossary')).toHaveTextContent('Glossary', { exact: false });
  });

  it('keeps it on the idle screen', async () => {
    mockTrain.active = null;
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('train-glossary-open')).toBeTruthy();
  });
});

describe('L12 — the discard question names the workout and the loss', () => {
  it('"Discard Push A?" / "1 logged set will be lost."', async () => {
    mockTrain.active = live([{ kind: 'working', weight: 135, reps: 8, done: true }, { kind: 'working', done: false }]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-discard'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Discard Push A?',
      body: "1 logged set will be lost. This can't be undone.",
      destructive: true,
    }));
  });

  it('nothing logged: the general body', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('session-menu'));
    await fireEvent.press(ui.getByTestId('session-menu-discard'));
    expect(mockConfirm.mock.calls.at(-1)?.[0].body).toBe('Discard this workout? Sets logged so far will be lost.');
  });
});

describe('L9 — the set sheet offers the kinds this lift can use', () => {
  const catalog = mockTrain.catalog;
  afterEach(() => { mockTrain.catalog = catalog; });

  it('a DECLARED straight lift: warm-up, working, drop — no cluster vocabulary', async () => {
    mockTrain.catalog = [{ ...catalog[0], setStructure: 'straight' } as (typeof catalog)[0]];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-kind-0-0'));
    expect(ui.getByTestId('set-sheet-kind-warmup')).toBeTruthy();
    expect(ui.getByTestId('set-sheet-kind-working')).toBeTruthy();
    expect(ui.getByTestId('set-sheet-kind-drop')).toBeTruthy();
    for (const k of ['activation', 'mini', 'continuation', 'mobility']) {
      expect(ui.queryByTestId(`set-sheet-kind-${k}`)).toBeNull();
    }
  });

  it('an UNDECLARED lift (added mid-workout) keeps the cluster vocabulary — rest-pause stays reachable (flow 22)', async () => {
    mockTrain.active = {
      ...live(), templateId: undefined, templateName: undefined,
      exercises: [{ exerciseId: 'bench', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', done: false }, { kind: 'working', done: false }] }],
    } as unknown as WorkoutSession;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-kind-0-1'));
    for (const k of ['warmup', 'working', 'activation', 'mini', 'continuation', 'drop']) {
      expect(ui.getByTestId(`set-sheet-kind-${k}`)).toBeTruthy();
    }
    await fireEvent.press(ui.getByTestId('set-sheet-kind-continuation'));
    expect(mockTrain.dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'setSetKind', setIndex: 1, kind: 'continuation' }));
  });

  it('the exercise ⋯ for an undeclared straight-looking lift is as at HEAD: no add cluster / add block', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    expect(ui.getByTestId('ex-menu-replace')).toBeTruthy();
    expect(ui.queryByTestId('ex-menu-cluster')).toBeNull();
    expect(ui.queryByTestId('ex-menu-block')).toBeNull();
  });
});

describe('QA v2 item 10 — a tick never accepts last time\'s WARM-UP into an effort row', () => {
  it('PREVIOUS stays positional (105×8), but the tick takes the target reps and never the warm-up load', async () => {
    mockTrain.recentSessions = [{
      ...lastPush,
      exercises: [{ ...lastPush.exercises[0], sets: [
        { kind: 'warmup', weight: 105, reps: 8, done: true },
        { kind: 'working', weight: 190, reps: 8, done: true },
      ] }],
    } as unknown as WorkoutSession];
    mockTrain.active = live([
      { kind: 'activation', group: 1, targetReps: 10, done: false },
      { kind: 'mini', group: 1, targetReps: 4, done: false },
    ]);
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-prev-0-0', { includeHiddenElements: true })).toHaveTextContent('105×8');
    // No load to take (last time's row 1 was a warm-up): the tick asks for
    // the weight first (fix S, L-N2) rather than logging "× 10" at no load.
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toEqual([]);
    await fireEvent.changeText(ui.getByTestId('set-weight-0-0'), '150');
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    const all = patches();
    expect(all).toContainEqual(expect.objectContaining({ reps: 10 }));
    expect(all.some((p) => p.weight === 105)).toBe(false);
  });

  it('a same-kind row still accepts last time (working ← working 190 × 8)', async () => {
    mockTrain.recentSessions = [{
      ...lastPush,
      exercises: [{ ...lastPush.exercises[0], sets: [
        { kind: 'warmup', weight: 105, reps: 8, done: true },
        { kind: 'working', weight: 190, reps: 8, done: true },
      ] }],
    } as unknown as WorkoutSession];
    mockTrain.active = live([{ kind: 'warmup', done: false }, { kind: 'working', done: false }]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-1'));
    expect(patches()).toContainEqual({ weight: 190 });
  });

  it('v3 QA: an unprescribed working row 1 after a warm-up offers the lift\'s target (8), not 0, and the tick logs it', async () => {
    mockTrain.recentSessions = [{
      ...lastPush,
      exercises: [{ ...lastPush.exercises[0], sets: [
        { kind: 'warmup', weight: 94, reps: 8, done: true },
        { kind: 'working', weight: 175, reps: 8, done: true },
      ] }],
    } as unknown as WorkoutSession];
    const session = live([{ kind: 'working', done: false }, { kind: 'working', done: false }]);
    (session.exercises[0] as { progression?: object }).progression = { targetReps: 8, holdSessions: 2, incrementLb: 5 };
    mockTrain.active = session;
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('set-count-0-0').props.placeholder).toBe('8');
    expect(ui.getByTestId('set-count-0-1').props.placeholder).toBe('8');
    await fireEvent.changeText(ui.getByTestId('set-weight-0-0'), '175');
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(patches()).toContainEqual(expect.objectContaining({ reps: 8 }));
    expect(patches().some((p) => 'weight' in p && p.weight === 94)).toBe(false);
  });
});

describe('L16 — the countdown opens this lift\'s rest', () => {
  it('a tap on the running rest opens the rest picker', async () => {
    mockRestRemaining = 60;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(ui.getByTestId('rest-label').props.accessibilityHint).toBe("Change this lift's rest");
    await fireEvent.press(ui.getByTestId('rest-label'));
    await waitFor(() => expect(ui.getByTestId('rest-pick-default')).toBeTruthy());
  });
});

describe('L18 — plates read as plates, not weight × reps', () => {
  it('"45 + 25 per side"', async () => {
    mockTrain.active = live([{ kind: 'working', weight: 185, done: false }]);
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-plates'));
    await waitFor(() => expect(ui.getByTestId('plates-panel-0')).toHaveTextContent('45 + 25 per side', { exact: false }));
  });
});

describe('L11 — cardio: one-tap target, and a run is called a run', () => {
  it('"Log 10 min" logs the target; the header says "Run"', async () => {
    mockTrain.active = {
      id: 'run', date: day(11), status: 'active', exercises: [],
      cardio: [{ modality: 'run', source: 'manual', durationSec: 0, targetDurationSec: 600 }],
    } as unknown as WorkoutSession;
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('session-header')).toHaveTextContent('Run', { exact: false });
    await fireEvent.press(ui.getByTestId('cardio-accept-target-0'));
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'patchCardio', blockIndex: 0, patch: { durationSec: 600 } }, { defer: true });
    expect(mockTrain.commitActive).toHaveBeenCalled();
  });
});
