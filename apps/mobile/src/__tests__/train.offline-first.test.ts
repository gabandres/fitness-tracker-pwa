import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { WorkoutSession } from '@/lib/workout';

/**
 * Train review bugs 1-4 (2026-10-04): the live workout is LOCAL-FIRST.
 *
 * The RN Firestore SDK is memory-only and resolves a write only on the
 * server's ack, so on a gym's dead signal every `await` on a write is an
 * `await` on the signal coming back. Four symptoms followed: Start did
 * nothing and each repeat tap queued another active session (1), Finish hung
 * on "Saving…" (2), a failure mid-workout was never shown (3), and a cold
 * start offline showed Start over the open workout (4). These pin the
 * replacement: the device first, the server behind it, the journal as the
 * durable copy.
 */

/** 'ack': writes land. 'queued': they never resolve — no signal. */
let mockNetwork: 'ack' | 'queued' = 'ack';
/** The server's active session, and whether the read of it came from cache. */
let mockServer: WorkoutSession | null = null;
let mockFromCache = false;
/** The next server write refused, with this Firestore code. */
let mockRefuse: string | null = null;

const pending = <T,>(value: T) =>
  mockNetwork === 'queued' ? new Promise<T>(() => {}) : Promise.resolve(value);
function refusal(): Error | null {
  if (!mockRefuse) return null;
  const e = Object.assign(new Error(mockRefuse), { code: mockRefuse });
  mockRefuse = null;
  return e;
}

const mockStartSession = jest.fn((_uid: string, draft: Omit<WorkoutSession, 'id'>, id: string) => {
  const e = refusal();
  if (e) return Promise.reject(e);
  if (mockNetwork === 'ack') mockServer = { ...(draft as WorkoutSession), id, updatedAt: new Date() };
  return pending(id);
});
const mockUpdateSession = jest.fn((_uid: string, id: string, patch: Partial<WorkoutSession>) => {
  const e = refusal();
  if (e) return Promise.reject(e);
  if (mockNetwork === 'ack' && mockServer?.id === id) mockServer = { ...mockServer, ...patch, updatedAt: new Date() };
  return pending(undefined);
});
const mockMarkExercised = jest.fn(() => pending(undefined));
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
  readActiveSession: async () => ({
    session: mockServer?.status === 'active' ? mockServer : null,
    fromCache: mockFromCache,
  }),
  startSession: (uid: string, draft: Omit<WorkoutSession, 'id'>, id: string) => mockStartSession(uid, draft, id),
  updateSession: (uid: string, id: string, patch: Partial<WorkoutSession>) => mockUpdateSession(uid, id, patch),
  addExercise: jest.fn().mockResolvedValue('ex-1'),
  addTemplate: jest.fn(),
  deleteExercise: jest.fn(),
  deleteSession: jest.fn().mockResolvedValue(undefined),
  deleteTemplate: jest.fn(),
  editExercise: jest.fn(),
  mergeExercises: jest.fn(),
  markExercised: () => mockMarkExercised(),
  setDailySleep: jest.fn().mockResolvedValue(undefined),
  setDailyWeight: jest.fn().mockResolvedValue(undefined),
  updateTemplate: jest.fn(),
}));

import { __resetFinishesInFlight, useTrain } from '@/hooks/useTrain';
import {
  encodeJournal,
  readActiveSessionJournal,
  readPendingFinishes,
} from '@/lib/active-session-journal';

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

function liveSession(over: Partial<WorkoutSession> = {}): WorkoutSession {
  const at = new Date('2026-10-04T17:00:00Z');
  return {
    id: 'live-1',
    status: 'active',
    date: at,
    createdAt: at,
    updatedAt: at,
    exercises: [
      {
        exerciseId: 'e1',
        name: 'Bench',
        logStyle: 'weight-reps',
        cues: [],
        sets: [{ kind: 'working', weight: 100, reps: 5, done: true }],
      },
    ],
    ...over,
  };
}

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetFinishesInFlight();
  mockNetwork = 'ack';
  mockServer = null;
  mockFromCache = false;
  mockRefuse = null;
  mockStartSession.mockClear();
  mockUpdateSession.mockClear();
  mockMarkExercised.mockClear();
});

describe('start (bug 1)', () => {
  it('offline: the session is on screen at once, with a device-minted id, and journaled as not yet created', async () => {
    mockNetwork = 'queued';
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();

    await act(async () => {
      // Not awaited on purpose: the create never resolves, and the screen
      // must not be waiting on it.
      void result.current.startWorkout();
    });

    expect(result.current.active).not.toBeNull();
    const id = result.current.active!.id!;
    expect(id).toMatch(/^[A-Za-z0-9]{20}$/);
    expect(mockStartSession).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'active' }), id);
    await flush();
    const journal = await readActiveSessionJournal('u1');
    expect(journal?.session.id).toBe(id);
    expect(journal?.created).toBe(false);
    await unmount();
  });

  it('repeat taps while the create is out start ONE session, not one per tap', async () => {
    mockNetwork = 'queued';
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await act(async () => {
      void result.current.startWorkout();
      void result.current.startWorkout();
      void result.current.startCardioWorkout('run');
    });
    expect(mockStartSession).toHaveBeenCalledTimes(1);
    await unmount();
  });

  it('a refused create is said on the session, not swallowed', async () => {
    mockRefuse = 'permission-denied';
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await act(async () => {
      void result.current.startWorkout();
    });
    await flush();
    expect(result.current.active).not.toBeNull();
    expect(result.current.errorKind).toBe('save');
    await unmount();
  });
});

describe('finish (bug 2)', () => {
  it('offline: completes on the device — sheet can close, journal moves to the pending list', async () => {
    mockServer = liveSession();
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('live-1'));

    mockNetwork = 'queued';
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.finishWorkout({ bodyweight: 180 });
    });

    expect(ok).toBe(true);
    expect(result.current.active).toBeNull();
    expect(result.current.saving).toBe(false);
    // The write was sent, and is still out.
    expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'live-1', expect.objectContaining({ status: 'completed' }));
    const finishes = await readPendingFinishes('u1');
    expect(finishes.map((f) => f.session.id)).toEqual(['live-1']);
    expect(finishes[0].extras).toEqual({ bodyweight: 180 });
    expect(await readActiveSessionJournal('u1')).toBeNull();
    await unmount();
  });

  it('a finish that never landed is replayed on the next mount, then forgotten', async () => {
    mockServer = liveSession();
    const first = await renderHook(() => useTrain());
    await waitFor(() => expect(first.result.current.active?.id).toBe('live-1'));
    mockNetwork = 'queued';
    await act(async () => {
      await first.result.current.finishWorkout({});
    });
    await first.unmount();

    // The runtime died with its queue; the signal is back.
    __resetFinishesInFlight();
    mockNetwork = 'ack';
    mockUpdateSession.mockClear();
    const second = await renderHook(() => useTrain());
    await waitFor(() => expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'live-1', expect.objectContaining({ status: 'completed' })));
    await waitFor(async () => expect(await readPendingFinishes('u1')).toEqual([]));
    // Never offered back as a live workout while it was being finished.
    expect(second.result.current.active).toBeNull();
    await second.unmount();
  });

  it('a REFUSED finish puts the workout back, with the error, instead of losing it', async () => {
    mockServer = liveSession();
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('live-1'));
    mockRefuse = 'permission-denied';
    await act(async () => {
      await result.current.finishWorkout({});
    });
    await flush();
    expect(result.current.active?.id).toBe('live-1');
    expect(result.current.active?.status).toBe('active');
    expect(result.current.errorKind).toBe('save');
    expect(await readPendingFinishes('u1')).toEqual([]);
    await unmount();
  });
});

describe('cold start (bug 4)', () => {
  it('an offline read that cannot see the session trusts the journal, and re-sends the whole doc', async () => {
    const journaled = liveSession({ id: 'kept-1' });
    await AsyncStorage.setItem('ignia.activeSession.v1.u1', encodeJournal({ savedAt: Date.now(), session: journaled }));
    mockFromCache = true; // memory-only SDK, fresh runtime, no signal: empty

    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('kept-1'));
    await flush();
    expect(mockStartSession).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'active' }), 'kept-1');
    await unmount();
  });

  it('a session whose create never landed survives an ONLINE read that has no such doc', async () => {
    const journaled = liveSession({ id: 'never-sent' });
    await AsyncStorage.setItem(
      'ignia.activeSession.v1.u1',
      encodeJournal({ savedAt: Date.now(), session: journaled, created: false }),
    );
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('never-sent'));
    await flush();
    expect(mockStartSession).toHaveBeenCalledWith('u1', expect.anything(), 'never-sent');
    await unmount();
  });

  it('but a created session the server no longer has as active stays gone (finished elsewhere)', async () => {
    const journaled = liveSession({ id: 'done-elsewhere' });
    await AsyncStorage.setItem('ignia.activeSession.v1.u1', encodeJournal({ savedAt: Date.now(), session: journaled }));
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await flush();
    expect(result.current.active).toBeNull();
    expect(mockStartSession).not.toHaveBeenCalled();
    await unmount();
  });
});

describe('a lost create caught by a later edit', () => {
  it('an update that fails not-found re-sends the whole session instead of erroring', async () => {
    mockServer = liveSession();
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('live-1'));
    mockRefuse = 'not-found';
    await act(async () => {
      await result.current.dispatch({ type: 'addSet', exerciseIndex: 0 });
    });
    await flush();
    expect(mockStartSession).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'active' }), 'live-1');
    expect(result.current.error).toBeNull();
    await unmount();
  });
});

describe('activePending (Train re-score 3, bug 2)', () => {
  it('holds until the device journal has answered — never "answered" with its session missing', async () => {
    // The cached sessions list can clear `loading` before the journal read
    // lands; a Start (or Siri's start) in that window began a second workout.
    // Pinned on every render, not just the last: the screen gates its Start
    // buttons and the intent on exactly this pair.
    await AsyncStorage.setItem('ignia.activeSession.v1.u1', encodeJournal({ savedAt: Date.now(), session: liveSession() }));
    mockFromCache = true;
    const seen: [boolean, string | null][] = [];
    const { result, unmount } = await renderHook(() => {
      const train = useTrain();
      seen.push([train.activePending, train.active?.id ?? null]);
      return train;
    });
    await waitFor(() => expect(result.current.activePending).toBe(false));
    expect(seen[0]).toEqual([true, null]);
    expect(seen.some(([pending, id]) => !pending && id == null)).toBe(false);
    expect(result.current.active?.id).toBe('live-1');
    await unmount();
  });

  it('clears with nothing on the device too, so an empty account can start', async () => {
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.activePending).toBe(false));
    expect(result.current.active).toBeNull();
    await unmount();
  });
});

describe('addManyToActive (Train re-score 3, multi-add)', () => {
  it('appends every pick in order with ONE session write', async () => {
    const { EXERCISE_LIBRARY } = jest.requireActual('@macrolog/core') as typeof import('@macrolog/core');
    const seed = EXERCISE_LIBRARY.find((s) => (s.logStyle ?? 'weight-reps') === 'weight-reps')!;
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await act(async () => {
      await result.current.startWorkout();
    });
    await flush();
    mockUpdateSession.mockClear();
    await act(async () => {
      await result.current.addManyToActive([
        {
          kind: 'catalog',
          exercise: { id: 'e9', name: 'Curl', muscles: [], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
          logStyle: 'weight-reps',
          setKind: 'working',
        },
        { kind: 'seed', seed },
      ]);
    });
    const exercises = result.current.active?.exercises ?? [];
    expect(exercises.map((e) => e.exerciseId)).toEqual(['e9', 'ex-1']);
    expect(exercises.every((e) => e.sets.length === 1 && e.sets[0].kind === 'working')).toBe(true);
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    await unmount();
  });
});
