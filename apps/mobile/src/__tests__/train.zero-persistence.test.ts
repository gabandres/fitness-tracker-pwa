import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  pruneUndefined,
  toSessionDoc,
  toSessionPatch,
  toWorkoutSession,
  type DocCodec,
} from '@macrolog/core';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * RIR 0 and bodyweight load 0 are values on EVERY path a set takes to
 * Firestore (2026-10-02). Each case drives the real `useTrain` (the reducer,
 * the finish op, the journal) and then replays the captured payload through
 * the real writer + a JSON round trip + the real reader — so a stray `if (x)`
 * or `x || undefined` anywhere between the tap and the stored doc fails here.
 *
 * Paths: create (a template's load-0 row seeds a new session), edit (a
 * reopened completed session), reorder (there is no in-session move action:
 * the operations that SHIFT a set's position are removing an exercise above
 * it, removing a set above it, and a kind change that renumbers clusters),
 * the Finish sheet's save, and sync (a restart replays the device journal
 * back to Firestore).
 */

const codec: DocCodec<string> = { timestamp: (d) => d.toISOString(), remove: () => null };

/** What a payload looks like after Firestore and the reader. */
function stored(payload: Record<string, unknown>, date = new Date('2026-10-01T22:48:23Z')): WorkoutSession {
  const doc = JSON.parse(JSON.stringify(payload));
  return toWorkoutSession('s1', {
    status: 'active',
    ...doc,
    timestamp: { toDate: () => date },
    createdAt: { toDate: () => date },
    updatedAt: { toDate: () => date },
  });
}
const storedPatch = (patch: Partial<WorkoutSession>) => stored(pruneUndefined(toSessionPatch(patch, codec)));

let mockServer: WorkoutSession | null = null;
let mockNetwork: 'ack' | 'queued' = 'ack';
const mockUpdateSession = jest.fn(async (_uid: string, _id: string, patch: Partial<WorkoutSession>) => {
  if (mockNetwork === 'queued') return new Promise<void>(() => {});
  if (mockServer) mockServer = { ...mockServer, ...patch, updatedAt: new Date() };
});
const mockStartSession = jest.fn(async (_uid: string, draft: Omit<WorkoutSession, 'createdAt' | 'updatedAt'>) => {
  mockServer = { ...draft, id: 'new', createdAt: new Date(), updatedAt: new Date() } as WorkoutSession;
  return 'new';
});
const mockNoop = jest.fn();

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportWorkout: jest.fn() }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeExercises: () => mockNoop,
  subscribeTemplates: () => mockNoop,
  subscribeRecentSessions: (_uid: string, _n: number, cb: (s: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  getActiveSession: async () => (mockServer?.status === 'active' ? mockServer : null),
  startSession: (uid: string, draft: Omit<WorkoutSession, 'createdAt' | 'updatedAt'>) => mockStartSession(uid, draft),
  updateSession: (uid: string, id: string, patch: Partial<WorkoutSession>) => mockUpdateSession(uid, id, patch),
  addExercise: jest.fn().mockResolvedValue('ex-1'),
  addTemplate: jest.fn(),
  deleteExercise: jest.fn(),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  deleteTemplate: jest.fn(),
  editExercise: jest.fn(),
  mergeExercises: jest.fn(),
  markExercised: jest.fn().mockResolvedValue(undefined),
  setDailySleep: jest.fn(),
  setDailyWeight: jest.fn(),
  updateTemplate: jest.fn(),
}));

import { useTrain } from '@/hooks/useTrain';
import { __resetOtaHolds } from '@/lib/ota-hold';

const cluster = (weight: number) => [
  { kind: 'activation' as const, group: 1, weight, done: false },
  { kind: 'mini' as const, group: 1, weight, done: false },
  { kind: 'mini' as const, group: 1, weight, done: false },
];

/** Push Day after 2026-10-02: a loaded lift, then the bodyweight push-up. */
function liveSession(): WorkoutSession {
  return {
    id: 'live',
    status: 'active',
    date: new Date('2026-10-01T22:48:23Z'),
    createdAt: new Date('2026-10-01T22:48:23Z'),
    updatedAt: new Date('2026-10-01T22:48:23Z'),
    exercises: [
      { exerciseId: 'flat', name: 'DB Flat Press', logStyle: 'weight-reps', cues: [], sets: cluster(25) },
      { exerciseId: 'pushup', name: 'Deficit Push-up', logStyle: 'weight-reps', cues: [], sets: cluster(0) },
    ],
  };
}

/** The push-up's three sets at 0 load, RIR 0 — how the UI sets them
 *  (deferred patches, then the set sheet's commit). */
async function logPushupAtZero(result: { current: ReturnType<typeof useTrain> }, exerciseIndex = 1) {
  await act(async () => {
    for (const [j, reps] of [12, 4, 3].entries()) {
      await result.current.dispatch(
        { type: 'patchSet', exerciseIndex, setIndex: j, patch: { weight: 0, reps } },
        { defer: true },
      );
      await result.current.dispatch(
        { type: 'patchSet', exerciseIndex, setIndex: j, patch: { rir: 0 } },
        { defer: true },
      );
      // Not awaited, exactly like the set sheet's `void commit()`: on a dead
      // connection the write never resolves.
      void result.current.commitActive();
    }
  });
}

const zeros = (s: WorkoutSession, exerciseId = 'pushup') =>
  s.exercises.find((e) => e.exerciseId === exerciseId)!.sets.map((x) => [x.weight, x.rir]);
const lastPatch = () => mockUpdateSession.mock.calls.at(-1)![2];

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetOtaHolds();
  mockServer = liveSession();
  mockNetwork = 'ack';
  mockUpdateSession.mockClear();
  mockStartSession.mockClear();
});

async function mounted() {
  const hook = await renderHook(() => useTrain());
  await waitFor(() => expect(hook.result.current.active).not.toBeNull());
  return hook;
}

describe('RIR 0 and load 0 persist as 0, not null', () => {
  it('create: a template row at targetLoad 0 seeds weight 0 into the new session doc', async () => {
    mockServer = null;
    const hook = await renderHook(() => useTrain());
    const template: WorkoutTemplate = {
      id: 'push',
      name: 'Push Day',
      createdAt: new Date(),
      updatedAt: new Date(),
      exercises: [{
        exerciseId: 'pushup',
        name: 'Deficit Push-up',
        logStyle: 'weight-reps',
        targetLoad: 0,
        cues: [],
        plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }],
      }],
    };
    await act(async () => {
      await hook.result.current.startFromTemplate(template);
    });
    const draft = mockStartSession.mock.calls[0][1];
    const doc = stored(pruneUndefined(toSessionDoc(draft as never, codec)) as unknown as Record<string, unknown>);
    expect(doc.exercises[0].sets.map((x) => x.weight)).toEqual([0, 0, 0]);
    await hook.unmount();
  });

  it('live logging: every commit carries weight 0 and rir 0', async () => {
    const hook = await mounted();
    await logPushupAtZero(hook.result);
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    await hook.unmount();
  });

  it('finish-sheet save: the completed doc keeps weight 0 and rir 0', async () => {
    const hook = await mounted();
    await logPushupAtZero(hook.result);
    await act(async () => {
      await hook.result.current.finishWorkout({ bodyweight: 156.4 });
    });
    const patch = lastPatch();
    expect(patch.status).toBe('completed');
    expect(zeros(storedPatch(patch))).toEqual([[0, 0], [0, 0], [0, 0]]);
    await hook.unmount();
  });

  it('edit: a reopened completed session keeps its 0s through Done', async () => {
    mockServer = null;
    const hook = await renderHook(() => useTrain());
    const done = { ...liveSession(), status: 'completed' as const };
    done.exercises[1].sets = done.exercises[1].sets.map((x, j) => ({ ...x, reps: [12, 4, 3][j], rir: 0 }));
    await act(async () => {
      hook.result.current.reopenSession(done);
    });
    // Fix one rep count, as an edit would; the 0s next to it must survive.
    await act(async () => {
      await hook.result.current.dispatch({ type: 'patchSet', exerciseIndex: 1, setIndex: 2, patch: { reps: 4 } });
    });
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    await act(async () => {
      await hook.result.current.finishEdit();
    });
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    await hook.unmount();
  });

  it('reorder: removing the exercise above, a set above, and a kind change keep the 0s', async () => {
    const hook = await mounted();
    await logPushupAtZero(hook.result);
    // The push-up moves from index 1 to 0.
    await act(async () => {
      await hook.result.current.dispatch({ type: 'removeExercise', exerciseIndex: 0 });
    });
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    // A kind change renumbers the cluster (`normalizeClusterGroups`).
    await act(async () => {
      await hook.result.current.dispatch({ type: 'setSetKind', exerciseIndex: 0, setIndex: 2, kind: 'working' });
    });
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    // Removing the first set slides the others up.
    await act(async () => {
      await hook.result.current.dispatch({ type: 'removeSet', exerciseIndex: 0, setIndex: 0 });
    });
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0]]);
    await hook.unmount();
  });

  it('sync: edits stranded by a restart replay to Firestore as 0, not null', async () => {
    const first = await mounted();
    mockNetwork = 'queued';
    await logPushupAtZero(first.result);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    await first.unmount();
    mockNetwork = 'ack';
    mockUpdateSession.mockClear();

    const second = await mounted();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(zeros(second.result.current.active!)).toEqual([[0, 0], [0, 0], [0, 0]]);
    expect(zeros(storedPatch(lastPatch()))).toEqual([[0, 0], [0, 0], [0, 0]]);
    await second.unmount();
  });
});
