import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { templateToSessionExercises, type WorkoutSession, type WorkoutTemplate } from '@/lib/workout';

/**
 * Supersets on the device (2026-10-11): the session snapshot, the alternating
 * flow with its timers and "next station" line, the template editor's
 * guardrails, and the drafts' activate / revert. The pure rules (flow, rests,
 * pair types, baselines, the report) are pinned in `packages/core`
 * (`superset*.test.ts`); this file pins that the screens use them.
 */

const day = (n: number) => new Date(2026, 9, n);
const mockConfirm = jest.fn();
const mockRestStart = jest.fn();
let mockRestRemaining = 0;

type Sets = WorkoutSession['exercises'][number]['sets'];
const myo = (clusters: number): Sets =>
  Array.from({ length: clusters }, (_, c) => [
    { kind: 'activation' as const, group: c + 1, weight: 90, targetReps: 10 },
    { kind: 'mini' as const, group: c + 1, weight: 90, targetReps: 4 },
    { kind: 'mini' as const, group: c + 1, weight: 90, targetReps: 3 },
  ]).flat();

const legTemplate = {
  id: 'leg', name: 'Leg Day', restMiniSec: 10, restClusterSec: 90,
  exercises: [
    { exerciseId: 'ext', name: 'Leg Extensions', logStyle: 'weight-reps', targetLoad: 90, supersetGroup: 'A', pairPosition: 1, transitionRestSec: 35, roundRestSec: 40,
      plannedSets: myo(2).map(({ kind, group }) => ({ kind, group })) },
    { exerciseId: 'curl', name: 'Leg Curls', logStyle: 'weight-reps', targetLoad: 90, supersetGroup: 'A', pairPosition: 2,
      plannedSets: myo(2).map(({ kind, group }) => ({ kind, group })) },
    { exerciseId: 'knee', name: 'Hanging Knee Raise', logStyle: 'bodyweight', plannedSets: myo(1).map(({ kind, group }) => ({ kind, group })) },
  ],
  createdAt: day(1), updatedAt: day(1),
} as unknown as WorkoutTemplate;

const mockTrain = {
  loading: false,
  error: null as Error | null,
  errorKind: null,
  clearError: jest.fn(),
  catalog: [
    { id: 'ext', name: 'Leg Extensions', muscles: ['quads'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'curl', name: 'Leg Curls', muscles: ['hamstrings'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'flat', name: 'DB Flat Press', muscles: ['chest', 'triceps'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'incline', name: 'Incline DB Press', muscles: ['chest', 'shoulders'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
  ],
  templates: [legTemplate] as WorkoutTemplate[],
  drafts: [] as unknown[],
  planDraftActivation: jest.fn(),
  planDraftRevert: jest.fn(),
  activateDraft: jest.fn().mockResolvedValue(undefined),
  revertDraft: jest.fn().mockResolvedValue(undefined),
  pendingLoadTestFor: jest.fn((row: { exerciseId: string }) => null as { from: number; to: number } | null),
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

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o) }));
jest.mock('@/components/Toast', () => ({ ...jest.requireActual('@/components/Toast'), showToast: jest.fn() }));
jest.mock('@/lib/a11y', () => ({ ...jest.requireActual('@/lib/a11y'), announce: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
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
    label: `0:${String(mockRestRemaining).padStart(2, '0')}`,
  }),
}));

import TrainScreen from '@/app/(app)/train';
import { __resetRestActivity } from '@/lib/rest-timer-activity';

/** A live Leg Day session started from the paired template. */
function live(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'live', status: 'active', templateId: 'leg', templateName: 'Leg Day',
    date: day(11), createdAt: day(11), updatedAt: day(11),
    exercises: templateToSessionExercises(legTemplate).map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, targetReps: 10 })) })),
    ...over,
  } as WorkoutSession;
}

beforeEach(() => {
  jest.clearAllMocks();
  __resetRestActivity();
  mockRestRemaining = 0;
  mockTrain.active = null;
  mockTrain.templates = [legTemplate];
  mockTrain.drafts = [];
  mockTrain.pendingLoadTestFor.mockImplementation(() => null);
});

describe('the session snapshot', () => {
  it('myo-rep sets inside a pair are built exactly as for a straight exercise, plus the group', () => {
    const straight = templateToSessionExercises({
      ...legTemplate,
      exercises: legTemplate.exercises.map(({ supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...e }) => e),
    });
    const paired = templateToSessionExercises(legTemplate);
    paired.forEach((e, i) => expect(e.sets).toEqual(straight[i].sets));
    expect(paired.map((e) => [e.supersetGroup, e.pairPosition, e.transitionRestSec, e.roundRestSec])).toEqual([
      ['A', 1, 35, 40], ['A', 2, 35, 40], [undefined, undefined, undefined, undefined],
    ]);
  });
});

describe('the alternating flow', () => {
  it('labels the stations A1 / A2', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('superset-tag-0')).toHaveTextContent('A1 · Superset');
    expect(ui.getByTestId('superset-tag-1')).toHaveTextContent('A2 · Superset');
    expect(ui.queryByTestId('superset-tag-2')).toBeNull();
  });

  it('A1 cluster done → the transition timer, the next station named, and A2 opens', async () => {
    jest.useFakeTimers();
    try {
      mockTrain.active = live();
      mockRestRemaining = 35;
      const ui = await render(<TrainScreen />);
      // Inside the cluster the mini-set rest is unchanged.
      await fireEvent.press(ui.getByTestId('set-done-0-0'));
      expect(mockRestStart).toHaveBeenLastCalledWith(10);
      // The cluster's last mini hands over to A2.
      await fireEvent.press(ui.getByTestId('set-done-0-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(35);
      expect(ui.getByTestId('rest-next')).toHaveTextContent('Next: A2 · Leg Curls');
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-1').props.accessibilityState).toEqual({ expanded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('A2 cluster done → the round timer, back to A1', async () => {
    jest.useFakeTimers();
    try {
      mockTrain.active = live();
      mockRestRemaining = 40;
      const ui = await render(<TrainScreen />);
      await fireEvent.press(ui.getByTestId('exercise-head-1'));
      await fireEvent.press(ui.getByTestId('set-done-1-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(40);
      expect(ui.getByTestId('rest-next')).toHaveTextContent('Next: A1 · Leg Extensions');
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual({ expanded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('a leftover cluster runs alone on the exercise\'s normal rest (2 clusters ↔ 1)', async () => {
    const session = live();
    session.exercises[1] = { ...session.exercises[1], sets: session.exercises[1].sets.slice(0, 3) };
    mockTrain.active = session;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await fireEvent.press(ui.getByTestId('set-done-1-2'));
    // Not the 40 s round rest: the template's 90 s between clusters.
    expect(mockRestStart).toHaveBeenLastCalledWith(90);
  });
});

describe('the template editor\'s guardrails', () => {
  it('labels an opposing-muscle pair "best supported"', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    expect(ui.getByTestId('template-superset-tag-0')).toHaveTextContent('A1 · Superset');
    expect(ui.getByTestId('template-pair-agonist-antagonist-1')).toHaveTextContent('Agonist–antagonist (best supported)');
  });

  it('warns on a same-muscle pair, and still saves', async () => {
    mockTrain.templates = [{
      ...legTemplate, id: 'push', name: 'Push Day',
      exercises: [
        { ...legTemplate.exercises[0], exerciseId: 'flat', name: 'DB Flat Press' },
        { ...legTemplate.exercises[1], exerciseId: 'incline', name: 'Incline DB Press' },
      ],
    } as WorkoutTemplate];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-push'));
    expect(ui.getByTestId('template-pair-same-muscle-1'))
      .toHaveTextContent('Same-muscle superset — expected to reduce total reps/volume (Zhang 2025)');
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
  });

  it('warns when a paired lift has a load test pending', async () => {
    mockTrain.pendingLoadTestFor.mockImplementation((row) => (row.exerciseId === 'curl' ? { from: 80, to: 90 } : null));
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    expect(ui.getByTestId('template-load-test-1'))
      .toHaveTextContent('Leg Curls: load test pending — run straight sets this session.');
  });

  it('pairs with the next row, and saves group, position and the leader\'s rests', async () => {
    mockTrain.templates = [{
      ...legTemplate,
      exercises: legTemplate.exercises.map(({ supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...e }) => e),
    } as WorkoutTemplate];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    // Beside the lift's other rest settings, under More.
    await fireEvent.press(ui.getByTestId('template-more-0'));
    await fireEvent.press(ui.getByTestId('template-pair-next-0'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.map((e: { supersetGroup?: string; pairPosition?: number }) => [e.supersetGroup, e.pairPosition]))
      .toEqual([['A', 1], ['A', 2], [undefined, undefined]]);
    expect(draft.exercises[0]).toMatchObject({ transitionRestSec: 30, roundRestSec: 30 });
    // Added to a superset is a context change: both rows start a new baseline.
    expect(draft.exercises[0].baseline?.reason).toBe('context changed: superset');
    expect(draft.exercises[1].baseline?.reason).toBe('context changed: superset');
    expect(draft.exercises[2].baseline).toBeUndefined();
  });

  it('an untouched superset template saves without new baselines', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.every((e: { baseline?: unknown }) => e.baseline === undefined)).toBe(true);
    expect(draft.exercises[0]).toMatchObject({ supersetGroup: 'A', pairPosition: 1, transitionRestSec: 35, roundRestSec: 40 });
  });
});

describe('drafts', () => {
  const draft = {
    id: 'd1', draftOf: 'leg', label: 'Leg Day — superset draft', status: 'draft',
    template: { name: 'Leg Day', exercises: legTemplate.exercises },
    createdAt: day(11), updatedAt: day(11),
  };

  it('lists a draft with its labelled order, and Activate says what the swap does before doing it', async () => {
    mockTrain.drafts = [draft];
    mockTrain.planDraftActivation.mockReturnValue({
      changes: new Map([['ext', ['superset']], ['curl', ['superset']], ['knee', ['position']]]),
      overlap: { doubled: [], dropped: [{ exerciseId: 'calf', name: 'Single-leg DB calf raise' }] },
    });
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('draft-d1')).toHaveTextContent(/A1\s+Leg Extensions/);
    await fireEvent.press(ui.getByTestId('draft-activate-d1'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toBe('Activate Leg Day — superset draft?');
    expect(opts.body).toContain('3 lifts start a new baseline');
    expect(opts.body).toContain('Single-leg DB calf raise will be in no template');
    expect(mockTrain.activateDraft).not.toHaveBeenCalled();
    opts.onConfirm();
    expect(mockTrain.activateDraft).toHaveBeenCalledWith(draft);
  });

  it('an active draft offers the one-tap revert', async () => {
    const active = { ...draft, status: 'active', previous: { name: 'Leg Day', exercises: [] } };
    mockTrain.drafts = [active];
    mockTrain.planDraftRevert.mockReturnValue({ changes: new Map(), overlap: { doubled: [], dropped: [] } });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('draft-revert-d1'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toBe('Revert Leg Day?');
    opts.onConfirm();
    expect(mockTrain.revertDraft).toHaveBeenCalledWith(active);
  });
});
