import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * `useTrain.dispatch` — the write contract that used to live in doc comments.
 *
 * The hook exposed seven mutation callbacks, three of which took `(i, j, patch)`
 * and were therefore indistinguishable at the call site. Their doc comments said
 * `editSet` wrote locally and needed a later `commitActive`, `applySetPatch`
 * persisted atomically "(no stale close-over)", and `setSetKind` also re-derived
 * cluster groups. Choosing wrong silently failed to save a user's set.
 *
 * There is now one `dispatch`, and the only axis it varies on is `defer`. These
 * tests pin that, and pin the reason the old comment mentioned stale closures:
 * consecutive dispatches inside a single tick must compound, which they cannot
 * do while each callback computes its next state from a value captured in a
 * `useCallback([active, …])`.
 */

const mockUpdateSession = jest.fn().mockResolvedValue(undefined);
const mockStartSession = jest.fn().mockResolvedValue('sess-1');
const mockGetActiveSession = jest.fn().mockResolvedValue(null);
const mockNoop = jest.fn();

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({
  exportDaily: jest.fn(),
  exportWorkout: jest.fn(),
}));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeExercises: () => mockNoop,
  subscribeTemplates: () => mockNoop,
  subscribeRecentSessions: (
    _uid: string,
    _n: number,
    cb: (s: unknown[]) => void,
  ) => {
    cb([]);
    return mockNoop;
  },
  getActiveSession: () => mockGetActiveSession(),
  startSession: (...a: unknown[]) => mockStartSession(...a),
  updateSession: (...a: unknown[]) => mockUpdateSession(...a),
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

beforeEach(() => {
  mockUpdateSession.mockClear();
  mockStartSession.mockClear();
  mockGetActiveSession.mockResolvedValue(null);
});

/** Mount the hook with one active session holding a single exercise. */
async function withActiveSession() {
  const hook = await renderHook(() => useTrain());
  await act(async () => {
    await hook.result.current.startWorkout();
  });
  await act(async () => {
    await hook.result.current.addExerciseToActive('Bench', 'weight-reps');
  });
  mockUpdateSession.mockClear();
  return hook;
}

describe('useTrain.dispatch — write policy', () => {
  it('persists immediately by default', async () => {
    const { result } = await withActiveSession();

    await act(async () => {
      await result.current.dispatch({
        type: 'patchSet',
        exerciseIndex: 0,
        setIndex: 0,
        patch: { reps: 8 },
      });
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(result.current.active!.exercises[0].sets[0].reps).toBe(8);
  });

  it('defer: true updates state WITHOUT writing, and commitActive flushes it', async () => {
    const { result } = await withActiveSession();

    await act(async () => {
      await result.current.dispatch(
        { type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { weight: 135 } },
        { defer: true },
      );
    });

    // State moved; Firestore did not.
    expect(result.current.active!.exercises[0].sets[0].weight).toBe(135);
    expect(mockUpdateSession).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.commitActive();
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    const [, , patch] = mockUpdateSession.mock.calls[0];
    expect(patch.exercises[0].sets[0].weight).toBe(135);
  });

  it('consecutive deferred dispatches COMPOUND — the stale-closure regression', async () => {
    const { result } = await withActiveSession();

    // Three edits with no re-render between them. Each old callback read a
    // session captured in its own `useCallback([active, …])`, so without the
    // ref the second and third would each compute from the first's input and
    // the last write would win, losing the other two fields.
    await act(async () => {
      const d = result.current.dispatch;
      await d({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { weight: 135 } }, { defer: true });
      await d({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { reps: 8 } }, { defer: true });
      await d({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { rir: 2 } }, { defer: true });
    });

    const set = result.current.active!.exercises[0].sets[0];
    expect(set).toMatchObject({ weight: 135, reps: 8, rir: 2 });
  });

  it('a mixed deferred-then-immediate pair writes both fields in ONE call', async () => {
    const { result } = await withActiveSession();

    // The set-done tap does exactly this: accept the prescribed reps deferred,
    // then patch `done` immediately, and the single write carries both.
    await act(async () => {
      const d = result.current.dispatch;
      await d({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { reps: 10 } }, { defer: true });
      await d({ type: 'patchSet', exerciseIndex: 0, setIndex: 0, patch: { done: true } });
    });

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    const [, , patch] = mockUpdateSession.mock.calls[0];
    expect(patch.exercises[0].sets[0]).toMatchObject({ reps: 10, done: true });
  });

  it('an out-of-range action changes nothing and writes nothing', async () => {
    const { result } = await withActiveSession();
    const before = result.current.active;

    await act(async () => {
      await result.current.dispatch({ type: 'addSet', exerciseIndex: 9 });
    });

    expect(result.current.active).toBe(before);
    expect(mockUpdateSession).not.toHaveBeenCalled();
  });

  it('dispatch keeps ONE identity across edits, so memoized rows do not churn', async () => {
    const { result } = await withActiveSession();
    const first = result.current.dispatch;

    await act(async () => {
      await result.current.dispatch({ type: 'addSet', exerciseIndex: 0 });
    });

    expect(result.current.dispatch).toBe(first);
  });
});

describe('useTrain.dispatch — domain rules reach the session', () => {
  it('addCluster appends activation + two minis in one numbered group', async () => {
    const { result } = await withActiveSession();

    await act(async () => {
      await result.current.dispatch({ type: 'addCluster', exerciseIndex: 0 });
    });

    await waitFor(() => expect(mockUpdateSession).toHaveBeenCalled());
    const sets = result.current.active!.exercises[0].sets;
    expect(sets.map((s) => s.kind)).toEqual(['working', 'activation', 'mini', 'mini']);
    expect([sets[1].group, sets[2].group, sets[3].group]).toEqual([1, 1, 1]);
  });

  it('setSetKind re-derives groups where patchSet deliberately does not', async () => {
    const { result } = await withActiveSession();

    await act(async () => {
      await result.current.dispatch({ type: 'addSet', exerciseIndex: 0 });
      await result.current.dispatch({ type: 'addSet', exerciseIndex: 0 });
    });
    // Three plain working sets, none grouped.
    expect(result.current.active!.exercises[0].sets.map((s) => s.group)).toEqual([
      undefined,
      undefined,
      undefined,
    ]);

    await act(async () => {
      await result.current.dispatch({
        type: 'setSetKind',
        exerciseIndex: 0,
        setIndex: 0,
        kind: 'activation',
      });
    });
    // Still ungrouped after it: the followers are `working`, not `mini`.
    expect(result.current.active!.exercises[0].sets[0].group).toBe(1);

    await act(async () => {
      await result.current.dispatch({
        type: 'setSetKind',
        exerciseIndex: 0,
        setIndex: 1,
        kind: 'mini',
      });
    });
    expect(result.current.active!.exercises[0].sets.map((s) => s.group)).toEqual([
      1,
      1,
      undefined,
    ]);
  });
});
