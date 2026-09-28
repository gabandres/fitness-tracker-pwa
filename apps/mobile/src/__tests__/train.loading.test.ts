import { act, renderHook, waitFor } from '@testing-library/react-native';

/**
 * `useTrain.loading` — the spinner has to be able to END.
 *
 * Train was the one tab that blocked on a server round-trip before rendering
 * anything: Today paints from `offline-cache`, Train had no cached slice, and
 * its listeners are focus-gated so it paid that round-trip on EVERY visit.
 *
 * Worse, the flag started `true` and was cleared in exactly one place — the
 * sessions success callback. An errored listener (offline, dropped connection)
 * therefore left it `true` forever, and because `train.tsx` checks `loading`
 * before it renders anything, the `train.loadErr` string it already had — which
 * lives inside `StartView`, the else branch — was unreachable precisely when it
 * was needed. The user-visible result was a spinner that never resolved.
 *
 * Neither case was caught by the other 340 tests, because both are about what
 * happens when Firestore does NOT answer.
 */

const mockNoop = jest.fn();
let mockSessionsImpl: (
  uid: string,
  n: number,
  cb: (s: unknown[], meta?: { fromCache: boolean }) => void,
  onError: (e: Error) => void,
) => () => void;

/** Drives the focus gate (the global setup mock has no toggle). */
const mockFocus = { focused: true };
jest.mock('expo-router', () => ({
  useFocusEffect: (cb: () => void | (() => void)) => {
    const React = require('react');
    const focused = mockFocus.focused;
    React.useEffect(() => {
      if (!focused) return;
      const cleanup = cb();
      return typeof cleanup === 'function' ? cleanup : undefined;
    }, [cb, focused]);
  },
}));

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
  subscribeRecentSessions: (
    uid: string,
    n: number,
    cb: (s: unknown[], meta?: { fromCache: boolean }) => void,
    onError: (e: Error) => void,
  ) => mockSessionsImpl(uid, n, cb, onError),
  getActiveSession: () => Promise.resolve(null),
  startSession: jest.fn(),
  updateSession: jest.fn(),
  addExercise: jest.fn(),
  addTemplate: jest.fn(),
  deleteExercise: jest.fn(),
  deleteSession: jest.fn(),
  deleteTemplate: jest.fn(),
  editExercise: jest.fn(),
  mergeExercises: jest.fn(),
  markExercised: jest.fn(),
  setDailySleep: jest.fn(),
  setDailyWeight: jest.fn(),
  updateTemplate: jest.fn(),
}));

import { useTrain } from '@/hooks/useTrain';

describe('useTrain loading', () => {
  it('clears when a snapshot arrives', async () => {
    mockSessionsImpl = (_u, _n, cb) => {
      cb([]);
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.error).toBeNull();
  });

  it('clears when the listener ERRORS, and surfaces the error', async () => {
    // The regression. Before the fix this assertion hung on `loading === true`
    // forever: `setLoading(false)` lived only in the success path, so an
    // offline device got an infinite spinner instead of `train.loadErr`.
    const boom = new Error('offline');
    mockSessionsImpl = (_u, _n, _cb, onError) => {
      onError(boom);
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.error).toBe(boom);
  });

  it('an offline cache-only emission does NOT count as a snapshot', async () => {
    // Firestore is memory-only here, so an offline listener fires immediately
    // with an EMPTY result and `fromCache: true`. Latching on that is what made
    // Train render "No templates yet" for an account with three — and, worse,
    // wrote the empty array through to AsyncStorage, wiping the cache for the
    // next cold start. Measured on the LG G6 2026-08-23, with a WARM cache.
    // With no disk cache in this harness the spinner correctly stays up: the
    // absence of an answer is not an answer.
    mockSessionsImpl = (_u, _n, cb) => {
      cb([], { fromCache: true });
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await new Promise((r) => setTimeout(r, 50));
    expect(hook.result.current.loading).toBe(true);
  });

  it('a SERVER emission does clear it, even when empty', async () => {
    mockSessionsImpl = (_u, _n, cb) => {
      cb([], { fromCache: false });
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
  });

  it('does not report an error on the happy path', async () => {
    mockSessionsImpl = (_u, _n, cb) => {
      cb([]);
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    expect(hook.result.current.recentSessions).toEqual([]);
  });
});

describe('refocus while editing a completed session', () => {
  it('does not let the active-session reload (null) close the editor', async () => {
    mockSessionsImpl = (_u, _n, cb) => {
      cb([], { fromCache: false });
      return mockNoop;
    };
    const hook = await renderHook(() => useTrain());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const completed = {
      id: 's-done',
      status: 'completed' as const,
      date: new Date(2026, 8, 20, 17, 0),
      exercises: [],
      createdAt: new Date(2026, 8, 20, 17, 0),
      updatedAt: new Date(2026, 8, 20, 17, 0),
    };
    await act(async () => {
      hook.result.current.reopenSession(completed as never);
    });
    expect(hook.result.current.editingExisting).toBe(true);
    expect(hook.result.current.active?.id).toBe('s-done');

    // A blur + refocus re-runs `onOpen`, whose `getActiveSession` (status ==
    // 'active') answers null for a completed session. That null used to be
    // written through, closing the editor while `editingExisting` stayed true.
    mockFocus.focused = false;
    await act(async () => {
      hook.rerender(undefined);
    });
    mockFocus.focused = true;
    await act(async () => {
      hook.rerender(undefined);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(hook.result.current.active?.id).toBe('s-done');
    expect(hook.result.current.editingExisting).toBe(true);
  });
});
