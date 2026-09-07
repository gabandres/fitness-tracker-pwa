import type { CardioBlock } from '@macrolog/core/cardio';

/**
 * IGNIA-MOBILE-V (2026-09-07, the Play reviewer on `review@`): the health
 * import read the day's session, then tried to fold a cardio block into it
 * after the user had discarded that session. `updateSession` was a merge-set,
 * so the write became a CREATE of `{ updatedAt, cardio }`, the rules rejected
 * it, and `useHealthAutoImport` re-threw it as an unhandled rejection with no
 * stack.
 *
 * Two things pinned here: a vanished session is skipped, not fatal — the user
 * deleting their own session is not an import failure — and every other
 * rejection still propagates, because the skip must not become a place where
 * real write failures disappear.
 */

const mockUpdateSession = jest.fn();
const mockStartSession = jest.fn().mockResolvedValue('new-sess');
const mockMarkExercised = jest.fn().mockResolvedValue(undefined);
const mockGetRecentSessions = jest.fn();

// `jest.setup.js` stubs this module for every screen test; this one tests it.
jest.unmock('@/lib/health-sync');
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/lib/health', () => ({ health: {} }));
jest.mock('@/lib/ledger', () => ({
  getDayBoundaryOnce: jest.fn().mockResolvedValue([]),
  getRecentSessions: (...a: unknown[]) => mockGetRecentSessions(...a),
  updateSession: (...a: unknown[]) => mockUpdateSession(...a),
  startSession: (...a: unknown[]) => mockStartSession(...a),
  markExercised: (...a: unknown[]) => mockMarkExercised(...a),
  getHealthScalarsOnce: jest.fn(),
  setDailyActiveEnergy: jest.fn(),
  importDailySleep: jest.fn(),
  setDailySteps: jest.fn(),
  setDailyWater: jest.fn(),
  setDailyWeight: jest.fn(),
}));

import { writeImportedBlocks } from '@/lib/health-sync';

const DAY = new Date(2026, 8, 6, 18, 0);

const RUN: CardioBlock = {
  modality: 'run',
  durationSec: 1800,
  distanceM: 5000,
  source: 'health',
  provider: 'other',
  sourceId: 'hc-run-1',
  startedAt: new Date(2026, 8, 6, 7, 0),
};

/** A session the user logged that day, with no cardio yet. */
const EXISTING = {
  id: 'sess-1',
  status: 'active',
  date: DAY,
  exercises: [],
  createdAt: DAY,
  updatedAt: DAY,
};

beforeEach(() => {
  mockUpdateSession.mockReset();
  mockStartSession.mockClear();
  mockMarkExercised.mockClear();
  mockGetRecentSessions.mockResolvedValue([EXISTING]);
});

describe('writeImportedBlocks when the target session vanished mid-import', () => {
  it('skips a not-found update and neither throws nor writes a replacement', async () => {
    mockUpdateSession.mockRejectedValue(Object.assign(new Error('gone'), { code: 'not-found' }));

    await expect(writeImportedBlocks('u1', [RUN])).resolves.toBe(0);

    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'sess-1', { cardio: [RUN] });
    // A vanished session is the user's deletion, not a missing day — the
    // import must not recreate it as a cardio-only session.
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockMarkExercised).not.toHaveBeenCalled();
  });

  it('still propagates every other rejection', async () => {
    mockUpdateSession.mockRejectedValue(
      Object.assign(new Error('denied'), { code: 'permission-denied' }),
    );

    await expect(writeImportedBlocks('u1', [RUN])).rejects.toMatchObject({
      code: 'permission-denied',
    });
  });

  it('counts the write when the session is still there', async () => {
    mockUpdateSession.mockResolvedValue(undefined);

    await expect(writeImportedBlocks('u1', [RUN])).resolves.toBe(1);
  });
});
