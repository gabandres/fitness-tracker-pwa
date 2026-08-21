import { act, renderHook } from '@testing-library/react-native';

/**
 * `useDailyTargets` must never present seed numbers as the user's targets.
 *
 * The hook feeds three independent `onSnapshot` channels into `dailyTargets`.
 * With empty inputs that call does NOT fail — it returns a seed result whose
 * `calorieTarget` is 1800 and whose `tdee.source` is `'seed'`. Until
 * 2026-08-20 the hook subscribed with no `onError` at all and returned that
 * bare `DailyTargets`, so a rules rejection, a dropped listener, or simply the
 * moment before the first snapshot all rendered 1,800 kcal in Settings as
 * though it were the number the user is held to. There was no loading flag and
 * no error to surface, so no caller could tell.
 *
 * These tests pin the discriminant, not the arithmetic: `loaded` is false until
 * all three channels have answered, and false again the moment any of them
 * errors.
 */

type LogsCb = (logs: unknown[]) => void;
type WeightsCb = (w: Record<string, number>) => void;
type ProfileCb = (p: unknown) => void;
type ErrCb = ((e: Error) => void) | undefined;

const mockChannels: {
  logs?: { next: LogsCb; error: ErrCb };
  weights?: { next: WeightsCb; error: ErrCb };
  profile?: { next: ProfileCb; error: ErrCb };
} = {};

const mockUnsub = jest.fn();

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));

jest.mock('@/lib/ledger', () => ({
  subscribeRecentLogs: (_uid: string, _n: number, next: LogsCb, error: ErrCb): (() => void) => {
    mockChannels.logs = { next, error };
    return mockUnsub;
  },
  subscribeDailyWeights: (_uid: string, next: WeightsCb, error: ErrCb) => {
    mockChannels.weights = { next, error };
    return mockUnsub;
  },
  subscribeProfile: (_uid: string, next: ProfileCb, error: ErrCb) => {
    mockChannels.profile = { next, error };
    return mockUnsub;
  },
}));

import { useDailyTargets } from '@/hooks/useDailyTargets';

beforeEach(() => {
  delete mockChannels.logs;
  delete mockChannels.weights;
  delete mockChannels.profile;
  mockUnsub.mockClear();
});

/** Deliver one snapshot on each of the three channels. `act` is async in this
 *  RNTL version, so every call must be awaited or the next render is skipped. */
async function answerAll() {
  await act(async () => {
    mockChannels.logs!.next([]);
    mockChannels.weights!.next({});
    mockChannels.profile!.next(null);
  });
}

describe('useDailyTargets load state', () => {
  it('is NOT loaded before any snapshot arrives — the seed target is unreachable', async () => {
    const { result } = await renderHook(() => useDailyTargets());
    expect(result.current.loaded).toBe(false);
    // The whole point: there is no `targets` key to read past the discriminant.
    expect((result.current as { targets?: unknown }).targets).toBeUndefined();
  });

  it('stays unloaded while only some channels have answered', async () => {
    const { result } = await renderHook(() => useDailyTargets());
    await act(async () => mockChannels.logs!.next([]));
    expect(result.current.loaded).toBe(false);
    await act(async () => mockChannels.weights!.next({}));
    expect(result.current.loaded).toBe(false);
  });

  it('loads once all three have answered — a null profile still counts', async () => {
    const { result } = await renderHook(() => useDailyTargets());
    await answerAll();
    expect(result.current.loaded).toBe(true);
    if (!result.current.loaded) throw new Error('unreachable');
    expect(result.current.targets.calorieTarget).toBeGreaterThan(0);
  });

  it('surfaces a subscription error instead of returning seed targets', async () => {
    const { result } = await renderHook(() => useDailyTargets());
    await answerAll();
    expect(result.current.loaded).toBe(true);

    const boom = new Error('permission-denied');
    await act(async () => mockChannels.profile!.error!(boom));

    expect(result.current.loaded).toBe(false);
    if (result.current.loaded) throw new Error('unreachable');
    expect(result.current.error).toBe(boom);
  });

  it('passes an onError to every channel — the defect was that it passed none', async () => {
    await renderHook(() => useDailyTargets());
    expect(typeof mockChannels.logs!.error).toBe('function');
    expect(typeof mockChannels.weights!.error).toBe('function');
    expect(typeof mockChannels.profile!.error).toBe('function');
  });
});
