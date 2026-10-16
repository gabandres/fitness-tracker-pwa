import { act, renderHook, waitFor } from '@testing-library/react-native';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

/**
 * Program v2.1 (2026-10-15): with an accepted deload week, starting a
 * template that still owes its deload session starts THAT session — the
 * template's own loads (each side of an L/R lift at its own), half the
 * clusters, RIR 3, `deload: true`, and no engine call frozen on it.
 */

const mockStartSession = jest.fn((_uid: string, _draft: Omit<WorkoutSession, 'id'>, id: string) => Promise.resolve(id));
const mockNoop = jest.fn();
let mockProfile: Record<string, unknown> = {};

const mockSet = (kind: string, group: number, label?: string) => ({ kind, group, ...(label ? { label } : {}) });
const mockPush = {
  id: 'push', name: 'Push Day', createdAt: new Date(2026, 8, 1), updatedAt: new Date(2026, 8, 1),
  exercises: [
    {
      exerciseId: 'press', name: 'DB Flat Press', targetLoad: 25,
      plannedSets: [mockSet('activation', 1), mockSet('mini', 1), mockSet('activation', 2), mockSet('mini', 2)],
    },
    {
      exerciseId: 'calf', name: 'Single-leg DB calf raise', targetLoad: 30, sideLoads: { L: 30, R: 35 },
      plannedSets: [mockSet('activation', 1, 'L'), mockSet('mini', 1, 'L'), mockSet('activation', 2, 'R'), mockSet('mini', 2, 'R')],
    },
  ],
} as unknown as WorkoutTemplate;

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportWorkout: jest.fn() }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeExercises: (_uid: string, cb: (x: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  subscribeTemplates: (_uid: string, cb: (x: unknown[]) => void) => {
    cb([mockPush]);
    return mockNoop;
  },
  subscribeTemplateDrafts: (_uid: string, cb: (x: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  subscribeRecentSessions: (_uid: string, _n: number, cb: (s: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  readActiveSession: async () => ({ session: null, fromCache: false }),
  startSession: (uid: string, draft: Omit<WorkoutSession, 'id'>, id: string) => mockStartSession(uid, draft, id),
  updateSession: jest.fn().mockResolvedValue(undefined),
  setTrainingSettings: jest.fn().mockResolvedValue(undefined),
}));

import { useTrain } from '@/hooks/useTrain';

beforeEach(() => {
  mockStartSession.mockClear();
});

async function startPush() {
  const { result } = await renderHook(() => useTrain());
  await waitFor(() => expect(result.current.templates.length).toBe(1));
  await act(async () => {
    await result.current.startFromTemplate(result.current.templates[0]);
  });
  await waitFor(() => expect(mockStartSession).toHaveBeenCalled());
  return mockStartSession.mock.calls[0][1] as WorkoutSession;
}

it('an accepted deload starts the deload session: half the clusters, both legs at their own loads, deload: true', async () => {
  mockProfile = { deloadStartedAt: new Date() };
  const draft = await startPush();
  expect(draft.deload).toBe(true);
  const [press, calf] = draft.exercises;
  expect(press.sets.map((x) => [x.kind, x.group, x.weight])).toEqual([['activation', 1, 25], ['mini', 1, 25]]);
  // One L/R unit kept: both legs, each at its side load.
  expect(calf.sets.map((x) => [x.label, x.weight])).toEqual([['L', 30], ['L', 30], ['R', 35], ['R', 35]]);
  expect(press.recommendation).toBeUndefined();
});

it('no deload accepted: the ordinary session', async () => {
  mockProfile = {};
  const draft = await startPush();
  expect(draft.deload).toBeUndefined();
  expect(draft.exercises[0].sets.filter((x) => x.kind === 'activation')).toHaveLength(2);
});
