import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WorkoutSession } from '@/lib/workout';

/**
 * RIR 0 lost on whole exercises mid-session (2026-10-01 Push Day: Incline
 * Dumbbell Press ×6, Chest Dip ×3; 2026-09-29 Leg Day: three lifts).
 *
 * The stored sets have no `rir` key at all, every other lift in the same
 * sessions stored `rir: 0`, and no falsy check exists on the path
 * (`set-zero-roundtrip.test.ts`). The loss is reproduced here at the one
 * place it can happen: the runtime restarts (an OTA `reloadAsync`, or iOS
 * killing the backgrounded app) while the RIR writes are still in the RN
 * Firestore SDK's memory-only queue; Train remounts on the server's copy;
 * the next set edit writes the whole `exercises` array back without them.
 * See `lib/active-session-journal.ts`.
 */

/** The server's copy of the session — what `getActiveSession` answers. */
let mockServer: WorkoutSession | null = null;
/** 'ack': a write lands on the server. 'queued': it sits in the SDK's
 *  in-memory queue and never resolves — a weak gym connection. */
let mockNetwork: 'ack' | 'queued' = 'ack';
const mockUpdateSession = jest.fn(async (_uid: string, _id: string, patch: Partial<WorkoutSession>) => {
  if (mockNetwork === 'queued') return new Promise<void>(() => {});
  if (mockServer) mockServer = { ...mockServer, ...patch, updatedAt: new Date() };
});
const mockNoop = jest.fn();
/** Re-runs the Train feed's focus effect, as a tab refocus does. */
let mockRefocus: (() => void) | null = null;

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useFocusEffect: (cb: () => void | (() => void)) => {
      const React = require('react');
      React.useEffect(() => {
        let cleanup = cb();
        mockRefocus = () => {
          if (typeof cleanup === 'function') cleanup();
          cleanup = cb();
        };
        return () => {
          if (typeof cleanup === 'function') cleanup();
        };
      }, [cb]);
    },
  };
});
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
  getActiveSession: async () => mockServer,
  startSession: jest.fn().mockResolvedValue('s1'),
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
import { __resetOtaHolds, isOtaHeld } from '@/lib/ota-hold';
import {
  decodeJournal,
  encodeJournal,
  reconcileActiveSession,
} from '@/lib/active-session-journal';

/** The 10-01 Push Day as the server held it once the reps had landed:
 *  Incline Dumbbell Press, two clusters, reps typed, no RIR yet. */
function pushDay(): WorkoutSession {
  const cluster = (g: number, reps: number[]) => [
    { kind: 'activation' as const, group: g, weight: 20, done: false, reps: reps[0] },
    { kind: 'mini' as const, group: g, weight: 20, done: false, reps: reps[1] },
    { kind: 'mini' as const, group: g, weight: 20, done: false, reps: reps[2] },
  ];
  return {
    id: 'IrEJXlb9x9Fb11y0a0ck',
    status: 'active',
    templateName: 'Push Day',
    date: new Date('2026-10-01T22:48:23Z'),
    createdAt: new Date('2026-10-01T22:48:23Z'),
    updatedAt: new Date('2026-10-01T23:30:00Z'),
    exercises: [
      {
        exerciseId: 'ngF9959fQPGTYUHXpigC',
        name: 'Incline Dumbbell Press',
        logStyle: 'weight-reps',
        cues: [],
        sets: [...cluster(1, [11, 5, 4]), ...cluster(2, [11, 4, 4])],
      },
      {
        exerciseId: 'AAHHWXTA7UtbNWZbcf7z',
        name: 'Overhead DB Extension',
        logStyle: 'weight-reps',
        cues: [],
        sets: [{ kind: 'activation', group: 1, weight: 30, done: false }],
      },
    ],
  };
}

const flush = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});

/** RIR 0 the way the set sheet sets it: a deferred patch, then a commit. */
async function setRirZero(result: { current: ReturnType<typeof useTrain> }, exerciseIndex: number, setIndex: number) {
  await act(async () => {
    await result.current.dispatch({ type: 'patchSet', exerciseIndex, setIndex, patch: { rir: 0 } }, { defer: true });
    void result.current.commitActive();
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetOtaHolds();
  mockServer = pushDay();
  mockNetwork = 'ack';
  mockUpdateSession.mockClear();
  mockRefocus = null;
});

describe('a runtime restart while set edits are still queued', () => {
  it('reproduction: RIR 0 survives the restart and is written back', async () => {
    const first = await renderHook(() => useTrain());
    await waitFor(() => expect(first.result.current.active?.id).toBe('IrEJXlb9x9Fb11y0a0ck'));

    // Weak signal: the six RIR taps never leave the device.
    mockNetwork = 'queued';
    for (let j = 0; j < 6; j++) await setRirZero(first.result, 0, j);
    await flush();
    expect(first.result.current.active!.exercises[0].sets.every((s) => s.rir === 0)).toBe(true);
    expect(mockServer!.exercises[0].sets.some((s) => s.rir != null)).toBe(false);

    // The runtime dies with its queue; the signal comes back.
    await first.unmount();
    mockNetwork = 'ack';
    mockUpdateSession.mockClear();

    const second = await renderHook(() => useTrain());
    await waitFor(() => expect(second.result.current.active?.id).toBe('IrEJXlb9x9Fb11y0a0ck'));
    await flush();

    // Before the fix this was `[undefined × 6]`: the server copy, adopted whole.
    expect(second.result.current.active!.exercises[0].sets.map((s) => s.rir)).toEqual([0, 0, 0, 0, 0, 0]);
    // ...and Firestore is told, so it no longer depends on the device.
    expect(mockUpdateSession).toHaveBeenCalled();
    expect(mockServer!.exercises[0].sets.map((s) => s.rir)).toEqual([0, 0, 0, 0, 0, 0]);

    // The NEXT lift's edit — the whole-array write that used to cement the
    // loss — now carries the incline's RIR along with it.
    await setRirZero(second.result, 1, 0);
    await flush();
    expect(mockServer!.exercises[0].sets.map((s) => s.rir)).toEqual([0, 0, 0, 0, 0, 0]);
    expect(mockServer!.exercises[1].sets[0].rir).toBe(0);
    await second.unmount();
  });

  it('a deferred load 0 (bodyweight) survives the same restart', async () => {
    const first = await renderHook(() => useTrain());
    await waitFor(() => expect(first.result.current.active).not.toBeNull());
    // Typed into the load cell, keyboard still up — deferred, never committed.
    await act(async () => {
      await first.result.current.dispatch(
        { type: 'patchSet', exerciseIndex: 1, setIndex: 0, patch: { weight: 0, reps: 2 } },
        { defer: true },
      );
    });
    await flush();
    await first.unmount();

    const second = await renderHook(() => useTrain());
    await waitFor(() => expect(second.result.current.active).not.toBeNull());
    await flush();
    expect(second.result.current.active!.exercises[1].sets[0]).toMatchObject({ weight: 0, reps: 2 });
    expect(mockServer!.exercises[1].sets[0]).toMatchObject({ weight: 0, reps: 2 });
    await second.unmount();
  });

  it('a refocus of the same workout keeps the in-memory copy (no stale reload)', async () => {
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active).not.toBeNull());
    mockNetwork = 'queued';
    await setRirZero(result, 0, 0);
    await act(async () => {
      await result.current.dispatch(
        { type: 'patchSet', exerciseIndex: 1, setIndex: 0, patch: { reps: 9 } },
        { defer: true },
      );
    });
    // Leave the tab and come back; the server copy is behind on both.
    await act(async () => {
      mockRefocus!();
    });
    await flush();
    expect(result.current.active!.exercises[0].sets[0].rir).toBe(0);
    expect(result.current.active!.exercises[1].sets[0].reps).toBe(9);
    await unmount();
  });

  it('never resurrects a finished workout from the journal', async () => {
    const first = await renderHook(() => useTrain());
    await waitFor(() => expect(first.result.current.active).not.toBeNull());
    await setRirZero(first.result, 0, 0);
    await act(async () => {
      await first.result.current.finishWorkout({});
    });
    await flush();
    expect(mockServer!.status).toBe('completed');
    await first.unmount();

    mockServer = null; // the active-session query no longer matches it
    const second = await renderHook(() => useTrain());
    await flush();
    expect(second.result.current.active).toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    await second.unmount();
  });

  it('holds OTA auto-apply while a workout is active, and releases it after', async () => {
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active).not.toBeNull());
    expect(isOtaHeld()).toBe(true);
    await act(async () => {
      await result.current.finishWorkout({});
    });
    expect(result.current.active).toBeNull();
    expect(isOtaHeld()).toBe(false);
    await unmount();
  });
});

describe('reconcileActiveSession', () => {
  const server = pushDay();
  const withRir = {
    ...server,
    exercises: server.exercises.map((e, i) => (i === 0 ? { ...e, sets: e.sets.map((s) => ({ ...s, rir: 0 })) } : e)),
  };

  it('journal newer than the server → journal, and resync', () => {
    const out = reconcileActiveSession(server, { savedAt: server.updatedAt.getTime() + 1, session: withRir });
    expect(out.resync).toBe(true);
    expect(out.session!.exercises[0].sets.map((s) => s.rir)).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('server written at or after the journal → server (another device, or nothing lost)', () => {
    const out = reconcileActiveSession(server, { savedAt: server.updatedAt.getTime(), session: withRir });
    expect(out).toEqual({ session: server, resync: false });
  });

  it('a journal for a different workout is ignored', () => {
    const out = reconcileActiveSession(server, { savedAt: Date.now(), session: { ...withRir, id: 'other' } });
    expect(out).toEqual({ session: server, resync: false });
  });

  it('no active session on the server → none, whatever the journal says', () => {
    expect(reconcileActiveSession(null, { savedAt: Date.now(), session: withRir })).toEqual({ session: null, resync: false });
  });

  it('the journal round-trips 0 and Dates exactly', () => {
    const entry = { savedAt: 1, session: { ...withRir, exercises: [{ ...withRir.exercises[0], sets: [{ kind: 'activation' as const, weight: 0, reps: 0, rir: 0, done: false }] }] } };
    const back = decodeJournal(encodeJournal(entry))!;
    expect(back.session.exercises[0].sets[0]).toEqual({ kind: 'activation', weight: 0, reps: 0, rir: 0, done: false });
    expect(back.session.date).toBeInstanceOf(Date);
    expect(back.session.date.getTime()).toBe(withRir.date.getTime());
  });
});
