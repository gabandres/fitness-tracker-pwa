import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import { templateToSessionExercises, type WorkoutSession, type WorkoutTemplate } from '@/lib/workout';

/**
 * Supersets on the device (2026-10-11): the session snapshot, the alternating
 * flow with its timers, headings and "next station" line, the template
 * editor's guardrails and pairing, the drafts' switch on / back, and the
 * report. The pure rules (flow, rests, pair types, baselines, report math,
 * reorders) are pinned in `packages/core` (`superset*.test.ts`); this file
 * pins that the screens use them.
 */

const day = (n: number) => new Date(2026, 9, n);
const mockConfirm = jest.fn();
const mockRestStart = jest.fn();
const mockAnnounce = jest.fn();
const mockShowToast = jest.fn();
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
const pushTemplate = {
  id: 'push', name: 'Push Day', restMiniSec: 10, restClusterSec: 90,
  exercises: [
    { exerciseId: 'flat', name: 'DB Flat Press', logStyle: 'weight-reps', targetLoad: 25, plannedSets: myo(2).map(({ kind, group }) => ({ kind, group })) },
  ],
  createdAt: day(1), updatedAt: day(1),
} as unknown as WorkoutTemplate;
const straightLeg = {
  ...legTemplate,
  exercises: legTemplate.exercises.map(({ supersetGroup: _g, pairPosition: _p, transitionRestSec: _t, roundRestSec: _r, ...e }) => e),
} as WorkoutTemplate;

const mockTrain = {
  loading: false,
  error: null as Error | null,
  errorKind: null,
  clearError: jest.fn(),
  catalog: [
    { id: 'ext', name: 'Leg Extensions', muscles: ['quads'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'curl', name: 'Leg Curls', muscles: ['hamstrings'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'knee', name: 'Hanging Knee Raise', muscles: ['core'], defaultCues: [], logStyle: 'bodyweight', createdAt: day(1) },
    { id: 'flat', name: 'DB Flat Press', muscles: ['chest', 'triceps'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
    { id: 'incline', name: 'Incline DB Press', muscles: ['chest', 'shoulders'], defaultCues: [], logStyle: 'weight-reps', createdAt: day(1) },
  ],
  templates: [legTemplate] as WorkoutTemplate[],
  drafts: [] as unknown[],
  planDraftSwaps: jest.fn(),
  switchDrafts: jest.fn().mockResolvedValue(undefined),
  deleteDraft: jest.fn().mockResolvedValue(undefined),
  pendingLoadTestFor: jest.fn((_row: { exerciseId: string }) => null as { from: number; to: number } | null),
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
  undoMove: jest.fn(),
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
const mockFocus = jest.fn();
// The real input, with `focus()` observed: "Edit rests" must land on a field.
jest.mock('@/components/SheetTextInput', () => {
  const R = jest.requireActual('react');
  const actual = jest.requireActual('@/components/SheetTextInput');
  return {
    ...actual,
    SheetTextInput: R.forwardRef((p: { testID?: string }, ref: unknown) => {
      const inner = R.useRef(null);
      R.useImperativeHandle(ref, () => new Proxy({}, {
        get: (_t, k: string) => {
          if (k === 'focus') return () => mockFocus(p.testID);
          const v = inner.current?.[k];
          return typeof v === 'function' ? v.bind(inner.current) : v;
        },
      }));
      return R.createElement(actual.SheetTextInput, { ...p, ref: inner });
    }),
  };
});
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
jest.mock('@/hooks/useTrain', () => ({ useTrain: () => mockTrain }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/components/ContextMenu', () => ({
  CONTEXT_MENUS: false,
  ContextMenu: ({ children }: { children: React.ReactNode }) => children,
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
    label: `0:${String(mockRestRemaining).padStart(2, '0')}`,
  }),
}));

import TrainScreen from '@/app/(app)/train';
import { ExerciseSupersetReport, SessionSupersetReport } from '@/components/train/SupersetReport';
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
  mockTrain.recentSessions = [];
  mockTrain.pendingLoadTestFor.mockImplementation(() => null);
});

describe('the session snapshot', () => {
  it('myo-rep sets inside a pair are built exactly as for a straight exercise, plus the group', () => {
    const straight = templateToSessionExercises(straightLeg);
    const paired = templateToSessionExercises(legTemplate);
    paired.forEach((e, i) => expect(e.sets).toEqual(straight[i].sets));
    expect(paired.map((e) => [e.supersetGroup, e.pairPosition, e.transitionRestSec, e.roundRestSec])).toEqual([
      ['A', 1, 35, 40], ['A', 2, 35, 40], [undefined, undefined, undefined, undefined],
    ]);
  });
});

describe('the alternating flow', () => {
  it('labels the stations A1 / A2 under one group header, and names the partner to a screen reader', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('superset-header-A')).toHaveTextContent('Superset A · switch 35 s · round 40 s');
    expect(ui.getByTestId('superset-tag-0')).toHaveTextContent('A1');
    expect(ui.getByTestId('superset-tag-1')).toHaveTextContent('A2');
    expect(ui.queryByTestId('superset-tag-2')).toBeNull();
    expect(ui.getByTestId('exercise-head-0').props.accessibilityLabel).toContain('Superset A1, alternates with Leg Curls');
  });

  it('a lift whose partner is gone shows no tag — the card never claims a pairing the flow does not run', async () => {
    const s = live();
    mockTrain.active = { ...s, exercises: [s.exercises[0], s.exercises[2]] };
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('superset-tag-0')).toBeNull();
  });

  it('A1 cluster done → "Switch", the next station named on the bar, the Lock Screen and to VoiceOver, and A2 opens', async () => {
    jest.useFakeTimers();
    try {
      mockTrain.active = live();
      mockRestRemaining = 35;
      const ui = await render(<TrainScreen />);
      // Inside the cluster the mini-set rest is unchanged, and nothing is named.
      await fireEvent.press(ui.getByTestId('set-done-0-0'));
      expect(mockRestStart).toHaveBeenLastCalledWith(10, undefined);
      // The cluster's last mini hands over to A2.
      await fireEvent.press(ui.getByTestId('set-done-0-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(35, 'Next: A2 · Leg Curls');
      expect(ui.getByTestId('rest-label')).toHaveTextContent('Switch · 0:35');
      expect(ui.getByTestId('rest-next')).toHaveTextContent('Next: A2 · Leg Curls');
      // A duration, spoken as one — not "0:35", which VoiceOver reads as a time of day.
      expect(mockAnnounce.mock.calls.at(-1)?.[0]).toMatch(/^Switch, 35 seconds of rest\. Next: A2 · Leg Curls$/);
      expect(ui.getByTestId('up-next-1')).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-1').props.accessibilityState).toEqual({ expanded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('A2 cluster done → "Round 2/2", back to A1', async () => {
    jest.useFakeTimers();
    try {
      mockTrain.active = live();
      mockRestRemaining = 40;
      const ui = await render(<TrainScreen />);
      await fireEvent.press(ui.getByTestId('exercise-head-1'));
      await fireEvent.press(ui.getByTestId('set-done-1-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(40, 'Next: A1 · Leg Extensions');
      expect(ui.getByTestId('rest-label')).toHaveTextContent('Round 2/2 · 0:40');
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual({ expanded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('Program v2 (test 6): A2 and the switch took 10 s — A1\'s round rest grows so A1 rests at least 90 s between its clusters', async () => {
    jest.useFakeTimers();
    try {
      const t0 = new Date('2026-10-13T18:00:00Z').getTime();
      jest.setSystemTime(t0);
      const s0 = live();
      s0.exercises[0] = { ...s0.exercises[0], minClusterRestSec: 90 };
      mockTrain.active = s0;
      const ui = await render(<TrainScreen />);
      // A1's cluster ends at t0…
      await fireEvent.press(ui.getByTestId('set-done-0-2'));
      // …and A2's 10 s later: 10 s since A1, so the 40 s round rest becomes 80.
      jest.setSystemTime(t0 + 10_000);
      await fireEvent.press(ui.getByTestId('exercise-head-1'));
      await fireEvent.press(ui.getByTestId('set-done-1-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(80, 'Next: A1 · Leg Extensions');
    } finally {
      jest.useRealTimers();
    }
  });

  it('Program v2 (test 6): untimed (A1 ticked before this screen) — estimated as the switch plus a 70 s cluster, so no delay', async () => {
    const s0 = live();
    s0.exercises[0] = { ...s0.exercises[0], minClusterRestSec: 90 };
    mockTrain.active = s0;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await fireEvent.press(ui.getByTestId('set-done-1-2'));
    // 35 s switch + 70 s cluster = 105 s ≥ 90: the 40 s round rest as set.
    expect(mockRestStart).toHaveBeenLastCalledWith(40, 'Next: A1 · Leg Extensions');
  });

  it('a leftover cluster runs alone on the exercise\'s normal rest (2 clusters ↔ 1)', async () => {
    const session = live();
    session.exercises[1] = { ...session.exercises[1], sets: session.exercises[1].sets.slice(0, 3) };
    mockTrain.active = session;
    mockRestRemaining = 90;
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await fireEvent.press(ui.getByTestId('set-done-1-2'));
    // Not the 40 s round rest: the template's 90 s between clusters.
    // …and the two-line Next row says the partner is finished (the one-line
    // heading beside the timer would cut it off).
    expect(mockRestStart).toHaveBeenLastCalledWith(90, 'Next: A1 · Leg Extensions — its partner is done');
    expect(ui.getByTestId('rest-label')).toHaveTextContent('Round 2/2', { exact: false });
    expect(ui.getByTestId('rest-next')).toHaveTextContent('Next: A1 · Leg Extensions — its partner is done');
    // Said once — on the Next part, not again in the heading.
    expect(mockAnnounce).toHaveBeenLastCalledWith(expect.stringContaining('Round 2 of 2'));
    expect(mockAnnounce.mock.calls.at(-1)?.[0]).toContain('its partner is done');
    expect(mockAnnounce.mock.calls.at(-1)?.[0]).not.toContain('A1 only');
  });

  it('A2 already done (A1\'s station was taken): A1\'s cluster gets its own rest and stays put', async () => {
    jest.useFakeTimers();
    try {
      const s = live();
      s.exercises[1] = { ...s.exercises[1], sets: s.exercises[1].sets.map((x) => ({ ...x, reps: 10, done: true })) };
      mockTrain.active = s;
      const ui = await render(<TrainScreen />);
      // A1 is the first unfinished lift, so it opens on its own.
      await fireEvent.press(ui.getByTestId('set-done-0-2'));
      expect(mockRestStart).toHaveBeenLastCalledWith(90, undefined);
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(ui.getByTestId('exercise-head-0').props.accessibilityState).toEqual({ expanded: true });
    } finally {
      jest.useRealTimers();
    }
  });

  it('"Unpair for today" in the lift\'s ⋯ runs the superset straight for this workout only, with an Undo', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-unpair-today'));
    expect(mockTrain.dispatch).toHaveBeenCalledWith({ type: 'unpairGroup', group: 'A' });
    const [msg, opts] = mockShowToast.mock.calls.at(-1)!;
    expect(msg).toBe('Superset A runs unpaired today');
    opts.action.onPress();
    expect(mockTrain.dispatch).toHaveBeenLastCalledWith({
      type: 'restoreSuperset',
      fields: {
        ext: { supersetGroup: 'A', pairPosition: 1, transitionRestSec: 35, roundRestSec: 40 },
        curl: { supersetGroup: 'A', pairPosition: 2, transitionRestSec: 35, roundRestSec: 40 },
      },
    });
    expect(mockTrain.saveTemplate).not.toHaveBeenCalled();
  });

  it('the ⋯ rest picker on a superset lift sets the GROUP\'s switch and round rests — never the mini-set rest', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    expect(ui.getByText('Rests for superset A')).toBeTruthy();
    expect(ui.queryByTestId('rest-pick-default')).toBeNull();
    await fireEvent.press(ui.getByTestId('rest-pick-transition-45'));
    await fireEvent.press(ui.getByTestId('rest-picker-done'));
    // The mini-set rest inside A1's cluster is untouched…
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(mockRestStart).toHaveBeenLastCalledWith(10, undefined);
    // …and the switch to A2 is the picked 45 s.
    await fireEvent.press(ui.getByTestId('set-done-0-2'));
    expect(mockRestStart).toHaveBeenLastCalledWith(45, 'Next: A2 · Leg Curls');
  });
});

describe('round 4: rests and moves in the live session', () => {
  it('"Keep for superset A" saves on Done, once, on the template\'s leader row — never restMiniSec', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    // A1's card is the open one; its ⋯ is the group's rest too.
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await fireEvent.press(ui.getByTestId('rest-pick-transition-45'));
    await fireEvent.press(ui.getByTestId('rest-pick-round-60'));
    // Ticked AFTER picking — the order that saved nothing before.
    await fireEvent.press(ui.getByTestId('rest-keep-superset'));
    expect(mockTrain.saveTemplate).not.toHaveBeenCalled();
    await fireEvent.press(ui.getByTestId('rest-picker-done'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises[0]).toMatchObject({ exerciseId: 'ext', transitionRestSec: 45, roundRestSec: 60 });
    expect(draft.exercises.every((e: { restMiniSec?: number }) => e.restMiniSec === undefined)).toBe(true);
  });

  it('"Keep" also saves when the picker is dismissed instead of Done (swipe / backdrop)', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await fireEvent.press(ui.getByTestId('rest-pick-round-60'));
    await fireEvent.press(ui.getByTestId('rest-keep-superset'));
    await fireEvent.press(ui.getByTestId('rest-picker-backdrop'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    expect(mockTrain.saveTemplate.mock.calls[0][0].exercises[0]).toMatchObject({ exerciseId: 'ext', roundRestSec: 60 });
  });

  it('a lift whose partner was removed gets its own ⋯ rest again', async () => {
    const s0 = live();
    mockTrain.active = { ...s0, exercises: [s0.exercises[0], s0.exercises[2]] };
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-menu-0'));
    await fireEvent.press(ui.getByTestId('ex-menu-rest'));
    await fireEvent.press(ui.getByTestId('rest-pick-60'));
    await fireEvent.press(ui.getByTestId('set-done-0-0'));
    expect(mockRestStart).toHaveBeenLastCalledWith(60, undefined);
  });

  it('Move up is not offered on A2 when its superset is already first', async () => {
    mockTrain.active = live();
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-1'));
    await fireEvent.press(ui.getByTestId('exercise-menu-1'));
    expect(ui.queryByTestId('ex-menu-move-up')).toBeNull();
    expect(ui.getByTestId('ex-menu-move-down')).toBeTruthy();
  });

  it('Undo after a move keeps the open card on its lift (real undo rule)', async () => {
    const { moveInSession, undoMoveRows } = jest.requireActual('@macrolog/core');
    mockTrain.active = live();
    mockTrain.moveExerciseInActive.mockImplementation((from: number, to: number) => {
      const before = mockTrain.active!.exercises;
      const r = moveInSession(before, from, to);
      mockTrain.active = { ...mockTrain.active!, exercises: r.rows };
      // As if the move had taken a lift out of its pair: the Undo is offered.
      return { newIndex: r.newIndex, left: { name: 'Leg Extensions', group: 'A', before } };
    });
    mockTrain.undoMove.mockImplementation((before: WorkoutSession['exercises']) => {
      mockTrain.active = { ...mockTrain.active!, exercises: undoMoveRows(before, mockTrain.active!.exercises) };
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-2'));
    await fireEvent.press(ui.getByTestId('exercise-menu-2'));
    await fireEvent.press(ui.getByTestId('ex-menu-move-up'));
    await ui.rerender(<TrainScreen />);
    expect(ui.getByTestId('set-done-0-0')).toBeTruthy();
    const undo = mockShowToast.mock.calls.at(-1)?.[1]?.action;
    expect(undo?.label).toBe('Undo');
    await act(async () => undo.onPress());
    await ui.rerender(<TrainScreen />);
    expect(mockTrain.active!.exercises.map((e) => e.exerciseId)).toEqual(['ext', 'curl', 'knee']);
    // The knee raise is back at the end — and still the open card.
    expect(ui.getByTestId('set-done-2-0')).toBeTruthy();
    expect(ui.queryByTestId('set-done-0-0')).toBeNull();
  });

  it('the open card follows its lift when a one-step move hops it over the superset (real move rule)', async () => {
    const { moveInSession } = jest.requireActual('@macrolog/core');
    mockTrain.active = live();
    mockTrain.moveExerciseInActive.mockImplementation((from: number, to: number) => {
      const r = moveInSession(mockTrain.active!.exercises, from, to);
      mockTrain.active = { ...mockTrain.active!, exercises: r.rows };
      return { newIndex: r.newIndex };
    });
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('exercise-head-2'));
    await fireEvent.press(ui.getByTestId('exercise-menu-2'));
    await fireEvent.press(ui.getByTestId('ex-menu-move-up'));
    expect(mockTrain.moveExerciseInActive).toHaveBeenCalledWith(2, 1);
    await ui.rerender(<TrainScreen />);
    // The knee raise hopped the whole pair, and its card is still the open one.
    expect(mockTrain.active!.exercises.map((e) => e.exerciseId)).toEqual(['knee', 'ext', 'curl']);
    expect(ui.getByTestId('set-done-0-0')).toBeTruthy();
    expect(ui.queryByTestId('set-done-1-0')).toBeNull();
    expect(ui.queryByTestId('set-done-2-0')).toBeNull();
  });
});

describe('the template editor', () => {
  it('labels an opposing-muscle pair "best supported", outside the tap target, and reads the tag to a screen reader', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    expect(ui.getByTestId('template-superset-header-0')).toHaveTextContent('Superset A · switch 35 s · round 40 s');
    // Never cut off: two lines at the default size (es-PR runs ~40
    // characters), no limit at accessibility sizes (seen cut on device).
    // (Never one line — which text size jest reports decides which of the two.)
    expect([2, undefined]).toContain(ui.getByTestId('template-superset-header-0').props.numberOfLines);
    // The group's facts together, right after the tag: who, then the rests.
    expect(ui.getByTestId('template-ex-toggle-0').props.accessibilityLabel)
      .toBe('Superset A1, alternates with Leg Curls. Switch 35 s · round 40 s. Leg Extensions. 6 sets · 90 lb');
    expect(ui.getByTestId('template-pair-agonist-antagonist-1')).toHaveTextContent('Opposing muscles — best supported (more total reps)', { exact: false });
    expect(ui.getByTestId('template-ex-toggle-0').props.accessibilityLabel).toContain('Superset A1, alternates with Leg Curls');
  });

  it('warns on a same-muscle pair naming the muscle and what to do, offers "Fix muscles", and still saves', async () => {
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
      .toHaveTextContent('Same primary muscle: chest — expect fewer total reps and less volume (Zhang 2025). Pair one with a back exercise instead, or unpair.', { exact: false });
    // One fix per lift, and the line carries them as screen-reader actions.
    // The visible buttons are hidden from a screen reader on purpose: the line
    // above carries them as its actions, one stop instead of three.
    expect(ui.getByTestId('template-fix-muscles-flat', { includeHiddenElements: true })).toHaveTextContent('Fix DB Flat Press');
    expect(ui.getByTestId('template-fix-muscles-incline', { includeHiddenElements: true })).toHaveTextContent('Fix Incline DB Press');
    expect(ui.getByTestId('template-pair-same-muscle-1').props.accessibilityActions.map((a: { label: string }) => a.label))
      .toEqual(['Fix DB Flat Press', 'Fix Incline DB Press']);
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
  });

  it('says a pending load test with the numbers, and where the per-workout way out is', async () => {
    mockTrain.pendingLoadTestFor.mockImplementation((row) => (row.exerciseId === 'curl' ? { from: 80, to: 90 } : null));
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    expect(ui.getByTestId('template-load-test-1')).toHaveTextContent('Leg Curls: 80 lb → 90 lb next session', { exact: false });
    expect(ui.getByTestId('template-load-test-1')).toHaveTextContent('"Unpair for today" is in the workout\'s ⋯ menu.', { exact: false });
  });

  it('pairs from the collapsed card in one tap, and saves group, position, the leader\'s rests and fresh baselines', async () => {
    mockTrain.templates = [straightLeg];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    expect(ui.getByTestId('template-link-0').props.accessibilityLabel).toBe('Superset Leg Extensions with Leg Curls');
    await fireEvent.press(ui.getByTestId('template-link-0'));
    // Said once, by the toast (with its Undo) — not also announced.
    expect(mockShowToast.mock.calls.at(-1)?.[0]).toBe('Leg Extensions and Leg Curls are now superset A. Both start a fresh baseline.');
    expect(mockShowToast.mock.calls.at(-1)?.[1].action.label).toBe('Undo');
    expect(mockAnnounce).not.toHaveBeenCalledWith('Leg Extensions and Leg Curls are now superset A. Both start a fresh baseline.');
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.map((e: { supersetGroup?: string; pairPosition?: number }) => [e.supersetGroup, e.pairPosition]))
      .toEqual([['A', 1], ['A', 2], [undefined, undefined]]);
    expect(draft.exercises[0]).toMatchObject({ transitionRestSec: 30, roundRestSec: 30 });
    expect(draft.exercises[0].baseline?.reason).toBe('context changed: superset');
    expect(draft.exercises[1].baseline?.reason).toBe('context changed: superset');
    expect(draft.exercises[2].baseline).toBeUndefined();
  });

  it('a one-step move (VoiceOver\'s Move down) moves the whole pair — it never dissolves it', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent(ui.getByTestId('template-drag-1'), 'accessibilityAction', { nativeEvent: { actionName: 'moveDown' } });
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.map((e: { exerciseId: string; supersetGroup?: string }) => `${e.exerciseId}${e.supersetGroup ?? ''}`))
      .toEqual(['knee', 'extA', 'curlA']);
  });

  it('a screen reader can swap the order INSIDE a superset', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent(ui.getByTestId('template-drag-0'), 'accessibilityAction', { nativeEvent: { actionName: 'later' } });
    expect(mockAnnounce).toHaveBeenLastCalledWith('Leg Extensions is now A2');
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.map((e: { exerciseId: string; pairPosition?: number }) => `${e.exerciseId}${e.pairPosition ?? ''}`))
      .toEqual(['curl1', 'ext2', 'knee']);
  });

  it('a straight lift moved up hops over the whole pair, and its new position is said', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent(ui.getByTestId('template-drag-2'), 'accessibilityAction', { nativeEvent: { actionName: 'moveUp' } });
    // Counted in units: the pair is one place, so the order has 2.
    expect(mockAnnounce).toHaveBeenLastCalledWith('Hanging Knee Raise moved to 1 of 2');
    expect(ui.getByTestId('template-drag-0').props.accessibilityValue).toMatchObject({ now: 1, max: 2, text: '1 of 2' });
    await fireEvent.press(ui.getByTestId('save-template'));
    await waitFor(() => expect(mockTrain.saveTemplate).toHaveBeenCalledTimes(1));
    const [draft] = mockTrain.saveTemplate.mock.calls[0];
    expect(draft.exercises.map((e: { exerciseId: string }) => e.exerciseId)).toEqual(['knee', 'ext', 'curl']);
  });

  it('"Edit rests" from A2\'s link opens the leader and focuses its switch rest — the field is on screen, not somewhere below', async () => {
    jest.useFakeTimers();
    try {
      const ui = await render(<TrainScreen />);
      await fireEvent.press(ui.getByTestId('edit-template-leg'));
      await fireEvent.press(ui.getByTestId('template-unlink-1'));
      const opts = mockConfirm.mock.calls[0][0];
      expect(opts.confirmText).toBe('Edit rests');
      expect(opts.body).toBe('Leg Extensions + Leg Curls · switch 35 s · round 40 s');
      await act(async () => opts.onConfirm());
      expect(ui.getByTestId('template-transition-rest-0')).toBeTruthy();
      expect(mockFocus).not.toHaveBeenCalled();
      await act(async () => {
        jest.advanceTimersByTime(450);
      });
      expect(mockFocus).toHaveBeenCalledWith('template-transition-rest-0');
    } finally {
      jest.useRealTimers();
    }
  });

  it('no longer offers the dead "supersets" structure chip', async () => {
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('edit-template-leg'));
    await fireEvent.press(ui.getByTestId('template-ex-toggle-0'));
    expect(ui.queryByText('supersets')).toBeNull();
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
  const pushDraft = {
    id: 'd-push', draftOf: 'push', label: 'Push Day — superset draft', status: 'draft',
    template: { name: 'Push Day', exercises: [
      { exerciseId: 'flat', name: 'DB Flat Press', plannedSets: [], supersetGroup: 'A', pairPosition: 1 },
      { exerciseId: 'knee', name: 'Hanging Knee Raise', plannedSets: [], supersetGroup: 'A', pairPosition: 2 },
    ] },
    createdAt: day(11), updatedAt: day(11),
  };
  const legDraft = {
    id: 'd-leg', draftOf: 'leg', label: 'Leg Day — superset draft', status: 'draft',
    template: { name: 'Leg Day', exercises: legTemplate.exercises.slice(0, 2) },
    createdAt: day(11), updatedAt: day(11),
  };
  const plan = (doubled: { exerciseId: string; name: string; alsoIn: string }[] = []) =>
    ({ body: { name: '', exercises: [] }, replaced: { name: '', exercises: [] }, changes: new Map([['flat', ['superset']], ['knee', ['superset', 'day']]]), overlap: { doubled, dropped: [] } });

  it('a draft card says what changes in one line, with the order behind "Show order"', async () => {
    mockTrain.templates = [legTemplate, pushTemplate];
    mockTrain.drafts = [pushDraft];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('draft-summary-d-push')).toHaveTextContent('2 lifts · 1 superset · Hanging Knee Raise from Leg Day');
    expect(ui.queryByTestId('draft-order-list-d-push')).toBeNull();
    await fireEvent.press(ui.getByTestId('draft-order-d-push'));
    expect(ui.getByTestId('draft-order-list-d-push').props.accessibilityLabel).toBe('Order: A1 DB Flat Press, A2 Hanging Knee Raise');
    // The spoken name starts with the visible text (Voice Control can say it).
    expect(ui.getByTestId('draft-activate-d-push').props.accessibilityLabel).toBe('Switch to supersets, Push Day');
  });

  it('when a lift moves between two drafted templates, the confirm offers "Switch both" first', async () => {
    mockTrain.templates = [legTemplate, pushTemplate];
    mockTrain.drafts = [pushDraft, legDraft];
    // Alone, Push doubles the knee raise; switched together, the week is settled.
    mockTrain.planDraftSwaps.mockImplementation((list: unknown[]) => (list.length === 1
      ? [plan([{ exerciseId: 'knee', name: 'Hanging Knee Raise', alsoIn: 'Leg Day' }])]
      : list.map(() => plan())));
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('draft-activate-d-push'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toBe('Switch Push Day to supersets?');
    expect(opts.body).toContain('Hanging Knee Raise move here from Leg Day. Switch Leg Day too, or they run twice a week.');
    expect(opts.body).toContain('You can switch back in one tap.');
    expect(opts.confirmText).toBe('Switch both');
    expect(opts.secondaryText).toBe('Only Push Day');
    expect(mockTrain.switchDrafts).not.toHaveBeenCalled();
    expect(opts.body).toContain('Next session holds the load on 4 lifts if you switch both (2 lifts if you switch only Push Day)');
    opts.onConfirm();
    expect(mockTrain.switchDrafts).toHaveBeenCalledWith([pushDraft, legDraft], 'activate', expect.any(Function));
    await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith('Push Day now runs supersets. Leg Day now runs supersets.', expect.anything()));
  });

  it('"Switch both" is not offered when switching both would not settle the week', async () => {
    mockTrain.templates = [legTemplate, pushTemplate];
    mockTrain.drafts = [pushDraft, legDraft];
    mockTrain.planDraftSwaps.mockImplementation((list: unknown[]) => list.map(() => plan([{ exerciseId: 'knee', name: 'Hanging Knee Raise', alsoIn: 'Leg Day' }])));
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('draft-activate-d-push'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.confirmText).toBe('Switch to supersets');
    expect(opts.secondaryText).toBeUndefined();
  });

  it('the way back is a visible button on the template card, on every platform', async () => {
    const active = { ...legDraft, status: 'active', previous: { name: 'Leg Day', exercises: [] }, activatedAt: '2026-10-11T15:00:00.000Z' };
    mockTrain.drafts = [active];
    mockTrain.planDraftSwaps.mockReturnValue([plan()]);
    const ui = await render(<TrainScreen />);
    // State in the label, not the hint.
    expect(ui.getByTestId('edit-template-leg').props.accessibilityLabel).toMatch(/, Supersets$/);
    // …and a screen-reader action for the way back.
    await fireEvent(ui.getByTestId('edit-template-leg'), 'accessibilityAction', { nativeEvent: { actionName: 'revert' } });
    expect(mockConfirm.mock.calls[0][0].title).toBe('Switch Leg Day back?');
    mockConfirm.mockClear();
    await fireEvent.press(ui.getByTestId('template-switch-back-leg'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toBe('Switch Leg Day back?');
    opts.onConfirm();
    expect(mockTrain.switchDrafts).toHaveBeenCalledWith([active], 'revert', expect.any(Function));
  });

  it('an active draft lives on its template card — tag, date, and the way back in its menu', async () => {
    const active = { ...legDraft, status: 'active', previous: { name: 'Leg Day', exercises: [] }, activatedAt: '2026-10-11T15:00:00.000Z' };
    mockTrain.drafts = [active];
    mockTrain.planDraftSwaps.mockReturnValue([plan()]);
    const ui = await render(<TrainScreen />);
    expect(ui.queryByTestId('draft-d-leg')).toBeNull();
    expect(ui.getByTestId('template-supersets-leg')).toHaveTextContent('Supersets since Oct 11');
    await fireEvent.press(ui.getByTestId('template-menu-leg'));
    await fireEvent.press(ui.getByTestId('template-menu-leg-revert-supersets'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.title).toBe('Switch Leg Day back?');
    opts.onConfirm();
    expect(mockTrain.switchDrafts).toHaveBeenCalledWith([active], 'revert', expect.any(Function));
  });

  it('deleting a template that runs a superset draft deletes both, together', async () => {
    const active = { ...legDraft, status: 'active', previous: { name: 'Leg Day', exercises: [] }, activatedAt: '2026-10-11T15:00:00.000Z' };
    mockTrain.drafts = [active];
    const ui = await render(<TrainScreen />);
    await fireEvent.press(ui.getByTestId('template-menu-leg'));
    await fireEvent.press(ui.getByTestId('template-menu-leg-delete'));
    const opts = mockConfirm.mock.calls[0][0];
    expect(opts.body).toContain('Its superset draft is deleted too.');
    opts.onConfirm();
    expect(mockTrain.deleteTemplate).toHaveBeenCalledWith('leg', 'd-leg');
  });

  it('a draft whose template was deleted says so and can be deleted', async () => {
    mockTrain.templates = [legTemplate];
    mockTrain.drafts = [pushDraft];
    const ui = await render(<TrainScreen />);
    expect(ui.getByTestId('draft-d-push')).toHaveTextContent('Its template was deleted.', { exact: false });
    expect(ui.queryByTestId('draft-activate-d-push')).toBeNull();
    await fireEvent.press(ui.getByTestId('draft-delete-d-push'));
    mockConfirm.mock.calls[0][0].onConfirm();
    expect(mockTrain.deleteDraft).toHaveBeenCalledWith(pushDraft);
  });
});

describe('the superset report', () => {
  const cluster = (w: number, act: number, m1: number) => [
    { kind: 'activation' as const, group: 1, weight: w, reps: act, rir: 0 },
    { kind: 'mini' as const, group: 1, weight: w, reps: m1, rir: 0 },
    { kind: 'mini' as const, group: 1, weight: w, reps: 2, rir: 0 },
  ];
  const s = (d: number, act: number, paired: boolean, durationMin?: number): WorkoutSession => ({
    id: `s${d}`, status: 'completed', templateId: 'leg', date: day(d), createdAt: day(d), updatedAt: day(d),
    ...(durationMin != null ? { durationMin } : {}),
    exercises: [{ exerciseId: 'ext', name: 'Leg Extensions', cues: [], logStyle: 'weight-reps', sets: cluster(90, act, 3),
      ...(paired ? { supersetGroup: 'A', pairPosition: 1 as const } : {}) }],
  });
  const sessions = [s(1, 12, false), s(3, 11, false), s(5, 10, false), s(7, 9, true, 50), s(9, 8, true, 48)];

  it('leads with the warning when it applies, compares one load, and labels each row for a screen reader', async () => {
    const ui = await render(<ExerciseSupersetReport sessions={sessions} exerciseId="ext" />);
    expect(ui.getByTestId('superset-report-flag')).toHaveTextContent(
      'Consider unpairing Leg Extensions: activation reps down vs straight-set baseline. In the template, tap the link icon beside Leg Extensions, then Unpair Leg Extensions.', { exact: false });
    // Every session here was at 90 lb: the same-load line would only repeat the averages.
    expect(ui.queryByTestId('superset-report-same-load')).toBeNull();
    expect(ui.getByText('Unpaired: last 3 sessions · Superset: 2 sessions')).toBeTruthy();
    expect(ui.getByLabelText('Activation reps (average): 11 unpaired, 8.5 in a superset, change −2.5')).toBeTruthy();
    expect(ui.getByLabelText('Session time (min): not recorded unpaired, 49 in a superset, change not recorded')).toBeTruthy();
  });

  it('the session report says plainly when there is no timed unpaired session — never "— min"', async () => {
    const ui = await render(<SessionSupersetReport sessions={sessions} session={sessions[4]} />);
    expect(ui.getByTestId('session-superset-time')).toHaveTextContent(
      'This session took 48 min. No timed unpaired session of this template to compare with yet', { exact: false });
    expect(ui.queryByText(/— min/)).toBeNull();
  });
});
