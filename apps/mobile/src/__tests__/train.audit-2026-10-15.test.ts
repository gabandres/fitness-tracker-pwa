import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CardioBlock } from '@macrolog/core/cardio';
import type { WorkoutSession } from '@/lib/workout';

/**
 * Train defects from the 2026-10-15 audit (items 8, 9, 12, 13):
 *
 *  8. Cancelling an edit of a finished session restored only `exercises`; the
 *     editor live-writes cardio, dismissed imports and duration too. And Done
 *     did not drop an empty cardio block the way Finish does.
 *  9. A finish the server REFUSED while another workout was open was dropped
 *     from the pending list and could not be put back on screen — lost.
 * 12. The pending-finish list was an unlocked read-modify-write, and a
 *     never-synced journal session lost to a server session with another id.
 * 13. Undoing an imported block's removal left its id in `dismissedSourceIds`.
 */

let mockServer: WorkoutSession | null = null;
/** When set, the next `updateSession` waits on this and settles with it. */
let mockHold: { promise: Promise<void>; reject: (e: Error) => void } | null = null;

const mockStartSession = jest.fn((_uid: string, draft: Omit<WorkoutSession, 'id'>, id: string) => {
  mockServer = { ...(draft as WorkoutSession), id, updatedAt: new Date() };
  return Promise.resolve(id);
});
const mockUpdateSession = jest.fn((_uid: string, _id: string, _patch: Partial<WorkoutSession>) => {
  if (mockHold) {
    const p = mockHold.promise;
    mockHold = null;
    return p;
  }
  return Promise.resolve();
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
  subscribeTemplateDrafts: () => mockNoop,
  subscribeRecentSessions: (_uid: string, _n: number, cb: (s: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  readActiveSession: async () => ({
    session: mockServer?.status === 'active' ? mockServer : null,
    fromCache: false,
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
  setDailySleep: jest.fn().mockResolvedValue(undefined),
  setDailyWeight: jest.fn().mockResolvedValue(undefined),
  updateTemplate: jest.fn(),
}));

import { __resetFinishesInFlight, editRestorePatch, useTrain } from '@/hooks/useTrain';
import {
  type JournalEntry,
  readPendingFinishes,
  reconcileActiveSession,
  recordPendingFinish,
  removePendingFinish,
} from '@/lib/active-session-journal';
import { undoCardioRemoval } from '@/lib/train-removal';

const flush = () =>
  act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });

const AT = new Date('2026-10-04T17:00:00Z');

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'live-1',
    status: 'active',
    date: AT,
    createdAt: AT,
    updatedAt: AT,
    exercises: [
      { exerciseId: 'e1', name: 'Bench', logStyle: 'weight-reps', cues: [], sets: [{ kind: 'working', weight: 100, reps: 5, done: true }] },
    ],
    ...over,
  };
}

const RUN: CardioBlock = {
  modality: 'run',
  durationSec: 1800,
  source: 'health',
  provider: 'other',
  sourceId: 'hk-run-1',
} as CardioBlock;

beforeEach(async () => {
  await AsyncStorage.clear();
  __resetFinishesInFlight();
  mockServer = null;
  mockHold = null;
  mockStartSession.mockClear();
  mockUpdateSession.mockClear();
});

describe('item 9 — a refused finish is never dropped', () => {
  it('stays in the pending list when another workout is already on screen', async () => {
    mockServer = session();
    const { result, unmount } = await renderHook(() => useTrain());
    await waitFor(() => expect(result.current.active?.id).toBe('live-1'));

    let reject!: (e: Error) => void;
    const promise = new Promise<void>((_res, rej) => {
      reject = rej;
    });
    mockHold = { promise, reject };
    await act(async () => {
      await result.current.finishWorkout({});
    });
    // The lifter starts the next workout while the finish is still out.
    await act(async () => {
      await result.current.startWorkout();
    });
    const next = result.current.active?.id;
    expect(next).toBeTruthy();
    expect(next).not.toBe('live-1');

    await act(async () => {
      reject(Object.assign(new Error('permission-denied'), { code: 'permission-denied' }));
    });
    await flush();

    // The open workout is untouched, the error is said, and the refused one
    // is still on the device to be replayed.
    expect(result.current.active?.id).toBe(next);
    expect(result.current.errorKind).toBe('save');
    expect((await readPendingFinishes('u1')).map((f) => f.session.id)).toEqual(['live-1']);
    await unmount();
  });
});

describe('item 8 — editing a finished session', () => {
  it('Cancel restores cardio, dismissed imports and duration, not just exercises', async () => {
    const original = session({ status: 'completed', cardio: [RUN], dismissedSourceIds: ['x'], durationMin: 50 });
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await act(async () => result.current.reopenSession(original));
    await act(async () => {
      await result.current.cancelEdit();
    });
    const patch = mockUpdateSession.mock.calls.at(-1)![2];
    expect(patch).toMatchObject({
      exercises: original.exercises,
      cardio: [RUN],
      dismissedSourceIds: ['x'],
      durationMin: 50,
    });
    await unmount();
  });

  it('Cancel empties cardio / dismissals the edit added to a session that had none', () => {
    const patch = editRestorePatch(session({ status: 'completed' }));
    expect(patch.cardio).toEqual([]);
    expect(patch.dismissedSourceIds).toEqual([]);
  });

  it('Done drops a cardio block that was never filled in, like Finish', async () => {
    const empty = { modality: 'run', durationSec: 0, source: 'manual' } as CardioBlock;
    const { result, unmount } = await renderHook(() => useTrain());
    await flush();
    await act(async () => result.current.reopenSession(session({ status: 'completed', cardio: [RUN, empty] })));
    await act(async () => {
      await result.current.finishEdit();
    });
    const patch = mockUpdateSession.mock.calls.at(-1)![2];
    expect(patch.cardio).toEqual([RUN]);
    await unmount();
  });
});

describe('item 12 — the device copies', () => {
  it('the pending-finish list survives a record and a remove racing each other', async () => {
    const entry = (id: string) => ({ savedAt: 1, session: session({ id }), extras: {} });
    await recordPendingFinish('u1', entry('a'));
    // Unserialised, both read ['a'] and the later write lost one change.
    await Promise.all([recordPendingFinish('u1', entry('b')), removePendingFinish('u1', 'a')]);
    expect((await readPendingFinishes('u1')).map((f) => f.session.id)).toEqual(['b']);
  });

  it('a never-synced journal session is kept over a server session with another id', () => {
    const journal: JournalEntry = { savedAt: 2, session: session({ id: 'local' }), created: false } as JournalEntry;
    const r = reconcileActiveSession(session({ id: 'other' }), journal, { serverKnown: true });
    expect(r.session?.id).toBe('local');
    expect(r.recreate).toBe(true);
  });

  it('a SYNCED journal session still yields to the server’s other session', () => {
    const journal: JournalEntry = { savedAt: 2, session: session({ id: 'local' }) } as JournalEntry;
    const r = reconcileActiveSession(session({ id: 'other' }), journal, { serverKnown: true });
    expect(r.session?.id).toBe('other');
  });
});

describe('item 13 — undoing an imported block’s removal', () => {
  it('takes its id back out of dismissedSourceIds', () => {
    const s = undoCardioRemoval({ cardio: [], dismissedSourceIds: ['keep', 'hk-run-1'] }, { index: 0, block: RUN });
    expect(s.cardio).toEqual([RUN]);
    expect(s.dismissedSourceIds).toEqual(['keep']);
  });

  it('leaves a hand-logged block’s session alone', () => {
    const manual = { modality: 'run', durationSec: 600, source: 'manual' } as CardioBlock;
    const s = undoCardioRemoval({ cardio: [], dismissedSourceIds: ['keep'] }, { index: 0, block: manual });
    expect(s.dismissedSourceIds).toEqual(['keep']);
  });
});

describe('item 17 — the rotation without a Program v2', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { rotationTemplates } = require('@/components/train/WeeklyVolumeSheet') as typeof import('@/components/train/WeeklyVolumeSheet');
  const NOW = new Date('2026-10-15T12:00:00Z').getTime();
  const tpl = (id: string) => ({ id });
  const done = (templateId: string, daysAgo: number) =>
    ({ status: 'completed' as const, templateId, date: new Date(NOW - daysAgo * 86_400_000) });

  it('leaves out a template not performed in the last four weeks', () => {
    const r = rotationTemplates([tpl('push'), tpl('pull'), tpl('oldSplit')], new Set(), [done('push', 2), done('pull', 5), done('oldSplit', 90)], NOW);
    expect(r.map((t) => t.id)).toEqual(['push', 'pull']);
  });

  it('a program names its templates, whatever was performed', () => {
    const r = rotationTemplates([tpl('a'), tpl('b')], new Set(['b']), [done('a', 1)], NOW);
    expect(r.map((t) => t.id)).toEqual(['b']);
  });

  it('nothing performed recently → every template, the only plan there is', () => {
    expect(rotationTemplates([tpl('a'), tpl('b')], new Set(), [], NOW).map((t) => t.id)).toEqual(['a', 'b']);
  });
});
