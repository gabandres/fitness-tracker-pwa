import React from 'react';
import { renderWithProviders as render, waitFor } from '@/test-utils';
import { templateToSessionExercises, type WorkoutSession, type WorkoutTemplate } from '@/lib/workout';

/**
 * S23-8 round 2b — a Lock Screen "Done set" drained by the live workout
 * (REVIEW-R2-NATIVE P1-1 / P2-6 / P2-11, REVIEW-R2-JS P2-2): the tick goes
 * through the SAME rest path as an in-app tick — the superset heading, the
 * next station on the bar and the rest-over text, the Up-next badge — with
 * native's deadline, nothing announced, and the entry removed only after it
 * was applied. The seam's rules are pinned in `rest-timer-workout.test.ts`.
 */

const day = (n: number) => new Date(2026, 9, n);
const mockRestStart = jest.fn();
const mockAnnounce = jest.fn();
let mockRestRemaining = 0;
let mockInbox: unknown[] = [];
const mockAck = jest.fn(async (_a: unknown[]) => undefined);

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
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
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
  endAllRestActivities: jest.fn(async () => null),
  getRestActivityStatus: jest.fn(async () => 'stopped'),
}));
jest.mock('../../modules/intent-inbox', () => ({
  ...jest.requireActual('../../modules/intent-inbox'),
  canAckIntentInbox: true,
  peekTrainInbox: async () => mockInbox,
  takeTrainInbox: async () => [],
  ackTrainInbox: (a: unknown[]) => mockAck(a),
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
import * as seam from '@/lib/rest-timer-activity';

function live(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'live', status: 'active', templateId: 'leg', templateName: 'Leg Day',
    date: day(11), createdAt: day(11), updatedAt: day(11),
    exercises: templateToSessionExercises(legTemplate),
    ...over,
  } as WorkoutSession;
}

beforeEach(() => {
  jest.clearAllMocks();
  seam.__resetRestActivity();
  mockRestRemaining = 0;
  mockInbox = [];
  mockTrain.active = null;
  mockTrain.templates = [legTemplate];
  mockTrain.editingExisting = false;
});

describe('a Lock Screen "Done set" in the live workout', () => {
  it('ticks the set and runs the in-app rest path — heading, next station, Up next — on native\'s deadline, silently', async () => {
    mockTrain.active = live();
    mockRestRemaining = 35;
    const atMs = Date.now();
    // A1's cluster-1 last mini, confirmed on the Lock Screen; native runs the switch rest.
    mockInbox = [{
      kind: 'set', atMs, sessionId: 'live', exerciseId: 'ext', exerciseIndex: 0, setIndex: 2,
      weight: 90, reps: 3, endsAtMs: atMs + 35_000, setKind: 'mini', group: 1, setCount: 6,
    }];
    const ui = await render(<TrainScreen />);
    await waitFor(() => expect(mockAck).toHaveBeenCalled());
    expect(mockTrain.dispatch).toHaveBeenCalledWith({
      type: 'patchSet', exerciseIndex: 0, setIndex: 2, patch: { done: true, weight: 90, reps: 3 },
    });
    const [secs, body] = mockRestStart.mock.calls.at(-1)!;
    expect(secs).toBeGreaterThanOrEqual(33);
    expect(secs).toBeLessThanOrEqual(35);
    // The rest-over text names the next station, as an in-app tick's does.
    expect(body).toBe('Next: A2 · Leg Curls');
    expect(ui.getByTestId('rest-label')).toHaveTextContent('Switch · 0:35');
    expect(ui.getByTestId('up-next-1')).toBeTruthy();
    // The lifter is on the Lock Screen: nothing is spoken here.
    expect(mockAnnounce).not.toHaveBeenCalled();
    // Removed only once applied (P2-11).
    expect(mockAck.mock.calls.at(-1)?.[0]).toEqual(mockInbox);
    // The seam adopted the rest at the tap instant, so a later +30 s applies.
    expect(seam.__currentRestActivity()).toMatchObject({ endsAt: atMs + 35_000, startedAt: atMs });
  });

  it('ignores a Done set for a slot that no longer holds that set — and ticks nothing', async () => {
    mockTrain.active = live();
    const atMs = Date.now();
    mockInbox = [{
      kind: 'set', atMs, sessionId: 'live', exerciseId: 'ext', exerciseIndex: 0, setIndex: 2,
      weight: 90, reps: 3, endsAtMs: atMs + 35_000, setKind: 'mini', group: 1, setCount: 7,
    }];
    await render(<TrainScreen />);
    await waitFor(() => expect(mockAck).toHaveBeenCalled());
    expect(mockTrain.dispatch).not.toHaveBeenCalled();
    expect(mockRestStart).not.toHaveBeenCalled();
  });

  it('arms the Lock Screen for a live workout, never while editing a past session (JS-P2-2)', async () => {
    const arm = jest.spyOn(seam, 'armWorkout');
    mockTrain.active = live();
    const first = await render(<TrainScreen />);
    expect(arm).toHaveBeenCalledWith('live', expect.any(Array), 'en');
    first.unmount();
    arm.mockClear();
    mockTrain.editingExisting = true;
    await render(<TrainScreen />);
    expect(arm).not.toHaveBeenCalled();
    arm.mockRestore();
  });
});
