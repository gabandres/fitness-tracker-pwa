/**
 * "Start my next workout" — Siri / Shortcuts (`StartNextWorkoutIntent`) and
 * `ignia://train?start=next`.
 *
 * Pinned: the plan (stale request → nothing; a running workout is shown, never
 * replaced; the "Next up" template, else an empty workout); nothing happens
 * before Train has loaded (an empty template list then means "still loading",
 * not "no templates"); queued phrases are ONE start; the deep link starts once
 * and clears itself; the router sends the user to Train only when one is
 * pending and fresh. Plus the inbox parser for the new kind.
 */
const mockTake = jest.fn();
const mockPeek = jest.fn();
let mockDoorbell: (() => void) | null = null;
jest.mock('../../modules/intent-inbox', () => ({
  ...jest.requireActual('../../modules/intent-inbox'),
  takeWorkoutStartActions: (...a: unknown[]) => mockTake(...a),
  peekWorkoutStartActions: (...a: unknown[]) => mockPeek(...a),
  subscribeIntentInbox: (cb: () => void) => {
    mockDoorbell = cb;
    return () => {
      mockDoorbell = null;
    };
  },
}));

const mockSetParams = jest.fn();
const mockNavigate = jest.fn();
let mockParams: { start?: string } = {};
let mockSegments: string[] = ['(app)'];
jest.mock('expo-router', () => ({
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams, navigate: mockNavigate }),
  useSegments: () => mockSegments,
}));

import { act, renderHook } from '@testing-library/react-native';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';
import {
  planStartNextWorkout,
  useStartNextWorkoutIntent,
  useWorkoutIntentRouter,
} from '@/hooks/useStartNextWorkoutIntent';
import { parseWorkoutStartActions } from '../../modules/intent-inbox';
import { endAllRestActivities } from '../../modules/rest-timer-activity';

const flush = () => act(async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); });

const TPL = { id: 't1', name: 'Push', exercises: [] } as unknown as WorkoutTemplate;
const ACTIVE = { id: 's1' } as unknown as WorkoutSession;

function train(over: Record<string, unknown> = {}) {
  return {
    loading: false,
    active: null as WorkoutSession | null,
    templates: [TPL],
    recentSessions: [] as WorkoutSession[],
    startFromTemplate: jest.fn(async () => {}),
    startWorkout: jest.fn(async () => {}),
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockTake.mockResolvedValue([]);
  mockPeek.mockResolvedValue([]);
  mockParams = {};
  mockSegments = ['(app)'];
});

describe('planStartNextWorkout', () => {
  const now = 1_800_000_000_000;
  it('ignores a request older than the spoken-action window', () => {
    expect(planStartNextWorkout({ atMs: now - 11 * 60_000, active: null, templates: [TPL], recentSessions: [], now })).toEqual({ type: 'none' });
  });
  it('shows a running workout instead of starting another', () => {
    expect(planStartNextWorkout({ atMs: now, active: ACTIVE, templates: [TPL], recentSessions: [], now })).toEqual({ type: 'show' });
  });
  it('starts the Next-up template, or an empty workout without templates', () => {
    expect(planStartNextWorkout({ atMs: now, active: null, templates: [TPL], recentSessions: [], now })).toEqual({ type: 'template', template: TPL });
    expect(planStartNextWorkout({ atMs: now, active: null, templates: [], recentSessions: [], now })).toEqual({ type: 'empty' });
  });
});

describe('useStartNextWorkoutIntent', () => {
  it('takes nothing while Train is loading', async () => {
    const tr = train({ loading: true });
    await renderHook(() => useStartNextWorkoutIntent(tr));
    await flush();
    expect(mockTake).not.toHaveBeenCalled();
  });

  it('starts the next template once for several queued phrases', async () => {
    mockTake.mockResolvedValueOnce([
      { kind: 'workoutStart', atMs: Date.now() - 5000 },
      { kind: 'workoutStart', atMs: Date.now() - 1000 },
    ]);
    const tr = train();
    await renderHook(() => useStartNextWorkoutIntent(tr));
    await flush();
    expect(tr.startFromTemplate).toHaveBeenCalledTimes(1);
    expect(tr.startFromTemplate).toHaveBeenCalledWith(TPL);
    expect(tr.startWorkout).not.toHaveBeenCalled();
  });

  it('drains again on the doorbell, and never replaces a running workout', async () => {
    const tr = train({ active: ACTIVE });
    await renderHook(() => useStartNextWorkoutIntent(tr));
    await flush();
    mockTake.mockResolvedValueOnce([{ kind: 'workoutStart', atMs: Date.now() }]);
    await act(async () => mockDoorbell?.());
    await flush();
    expect(mockTake).toHaveBeenCalledTimes(2);
    expect(tr.startFromTemplate).not.toHaveBeenCalled();
    expect(tr.startWorkout).not.toHaveBeenCalled();
  });

  it('the deep link starts an empty workout without templates, and clears itself', async () => {
    mockParams = { start: 'next' };
    const tr = train({ templates: [] });
    await renderHook(() => useStartNextWorkoutIntent(tr));
    await flush();
    expect(tr.startWorkout).toHaveBeenCalledTimes(1);
    expect(mockSetParams).toHaveBeenCalledWith({ start: undefined });
  });
});

describe('useWorkoutIntentRouter', () => {
  it('goes to Train when a fresh start is pending and the user is elsewhere', async () => {
    mockPeek.mockResolvedValueOnce([{ kind: 'workoutStart', atMs: Date.now() }]);
    await renderHook(() => useWorkoutIntentRouter());
    await flush();
    expect(mockNavigate).toHaveBeenCalledWith('/train');
  });

  it('stays put when already on Train, or when nothing fresh is pending', async () => {
    mockSegments = ['(app)', 'train'];
    mockPeek.mockResolvedValueOnce([{ kind: 'workoutStart', atMs: Date.now() }]);
    await renderHook(() => useWorkoutIntentRouter());
    await flush();
    mockSegments = ['(app)'];
    mockPeek.mockResolvedValueOnce([{ kind: 'workoutStart', atMs: Date.now() - 60 * 60_000 }]);
    await renderHook(() => useWorkoutIntentRouter());
    await flush();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});

describe('inbox + rest bridge glue', () => {
  it('parses only well-formed workoutStart entries', () => {
    const raw = JSON.stringify([
      { kind: 'workoutStart', atMs: 5 },
      { kind: 'workoutStart' },
      { kind: 'fastStart', atMs: 6 },
      null,
    ]);
    expect(parseWorkoutStartActions(raw)).toEqual([{ kind: 'workoutStart', atMs: 5 }]);
    expect(parseWorkoutStartActions('not json')).toEqual([]);
  });

  it('endAllRestActivities is a safe no-op without the native module', async () => {
    await expect(endAllRestActivities()).resolves.toBe('unavailable');
  });
});
