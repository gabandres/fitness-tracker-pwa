import { renderHook, waitFor } from '@testing-library/react-native';

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
  cb: (s: unknown[]) => void,
  onError: (e: Error) => void,
) => () => void;

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
    cb: (s: unknown[]) => void,
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
