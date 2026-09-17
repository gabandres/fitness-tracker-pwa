import { act, renderHook } from '@testing-library/react-native';

/**
 * Every exercise a user creates gets its muscle groups — the bug that made the
 * weekly cluster audit's `unattributed` list unfixable.
 *
 * `addCatalogExercise` and `addExerciseToActive` both hardcoded
 * `muscles: []`, and NO screen anywhere could set them afterwards
 * (`ExerciseDetailModal` edits name + logStyle; `LiftSettingsSheet` edits the
 * effort standard and the rep band). The only code path that had ever written
 * muscles was `cloneStarterTemplate`. So a movement's attribution depended
 * entirely on the accident of how it was first added, and `weeklyClusterAudit`
 * reported the consequence in a line the user could do nothing about.
 *
 * The shipped library (~70 movements with muscles and localized cues) is the
 * fix, and these tests pin both doors onto it: an exact typed name resolves
 * through it, and a partial one deliberately does NOT.
 */

const mockAddExercise = jest.fn().mockResolvedValue('new-id');
const mockNoop = jest.fn();
let mockCatalogRows: unknown[] = [];

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportWorkout: jest.fn() }));
jest.mock('@/lib/sub-debug', () => ({
  trackSubs: (_label: string, unsubs: (() => void)[]) => () => unsubs.forEach((u) => u()),
}));
jest.mock('@/lib/ledger', () => ({
  subscribeExercises: (_uid: string, cb: (rows: unknown[]) => void) => {
    cb(mockCatalogRows);
    return mockNoop;
  },
  subscribeTemplates: () => mockNoop,
  subscribeRecentSessions: (_uid: string, _n: number, cb: (s: unknown[]) => void) => {
    cb([]);
    return mockNoop;
  },
  getActiveSession: () => Promise.resolve(null),
  startSession: () => Promise.resolve('sess-1'),
  updateSession: jest.fn().mockResolvedValue(undefined),
  addExercise: (...a: unknown[]) => mockAddExercise(...a),
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
import { findSeedExercise } from '@macrolog/core';

beforeEach(() => {
  mockAddExercise.mockClear().mockResolvedValue('new-id');
  mockCatalogRows = [];
});

/** The muscles argument of the single `addExercise` write that happened. */
function writtenDraft(): { name: string; muscles: string[]; defaultCues: string[]; seedKey?: string } {
  expect(mockAddExercise).toHaveBeenCalledTimes(1);
  return mockAddExercise.mock.calls[0][1];
}

describe('addCatalogExercise', () => {
  it('inherits muscles, cues and the seed key from an exact library name', async () => {
    const hook = await renderHook(() => useTrain());
    await act(async () => {
      await hook.result.current.addCatalogExercise('Barbell Bench Press', 'weight-reps');
    });
    const draft = writtenDraft();
    expect(draft.seedKey).toBe('barbell-bench-press');
    expect(draft.muscles).toEqual(findSeedExercise('barbell-bench-press')!.muscles);
    expect(draft.defaultCues.length).toBeGreaterThan(0);
  });

  it('matches case-insensitively and ignores surrounding space', async () => {
    const hook = await renderHook(() => useTrain());
    await act(async () => {
      await hook.result.current.addCatalogExercise('  barbell bench press ', 'weight-reps');
    });
    expect(writtenDraft().seedKey).toBe('barbell-bench-press');
  });

  it('does NOT guess from a partial name', async () => {
    // A fuzzy match would attach the wrong muscle group to a movement the
    // user named deliberately, and do it silently.
    const hook = await renderHook(() => useTrain());
    await act(async () => {
      await hook.result.current.addCatalogExercise('Bench', 'weight-reps');
    });
    const draft = writtenDraft();
    expect(draft.seedKey).toBeUndefined();
    expect(draft.muscles).toEqual([]);
  });
});

describe('addLibraryExercise', () => {
  it('writes the movement with its muscles and returns the new id', async () => {
    const hook = await renderHook(() => useTrain());
    const seed = findSeedExercise('barbell-bench-press')!;
    let out: { id: string; name: string } | undefined;
    await act(async () => {
      out = await hook.result.current.addLibraryExercise(seed);
    });
    expect(out?.id).toBe('new-id');
    expect(writtenDraft().muscles).toEqual(seed.muscles);
  });

  it('reuses an existing catalog row rather than splitting history', async () => {
    // Dedupe is by seedKey first: progression history and e1RM are keyed by
    // exerciseId, so a second doc for the same movement never rejoins.
    mockCatalogRows = [
      { id: 'have-it', name: 'Barbell Bench Press', muscles: ['chest'], defaultCues: [], seedKey: 'barbell-bench-press', logStyle: 'weight-reps', createdAt: new Date() },
    ];
    const hook = await renderHook(() => useTrain());
    let out: { id: string } | undefined;
    await act(async () => {
      out = await hook.result.current.addLibraryExercise(findSeedExercise('barbell-bench-press')!);
    });
    expect(out?.id).toBe('have-it');
    expect(mockAddExercise).not.toHaveBeenCalled();
  });

  it('reuses a row matched only by name, for clones written before seedKey existed', async () => {
    mockCatalogRows = [
      { id: 'legacy', name: 'barbell bench press', muscles: [], defaultCues: [], logStyle: 'weight-reps', createdAt: new Date() },
    ];
    const hook = await renderHook(() => useTrain());
    let out: { id: string } | undefined;
    await act(async () => {
      out = await hook.result.current.addLibraryExercise(findSeedExercise('barbell-bench-press')!);
    });
    expect(out?.id).toBe('legacy');
    expect(mockAddExercise).not.toHaveBeenCalled();
  });
});

describe('addExerciseToActive', () => {
  it('resolves an exact library name through the library, not as a bare doc', async () => {
    const hook = await renderHook(() => useTrain());
    await act(async () => {
      await hook.result.current.startWorkout();
    });
    await act(async () => {
      await hook.result.current.addExerciseToActive('Barbell Bench Press', 'weight-reps');
    });
    const draft = writtenDraft();
    expect(draft.seedKey).toBe('barbell-bench-press');
    expect(draft.muscles.length).toBeGreaterThan(0);
  });
});
