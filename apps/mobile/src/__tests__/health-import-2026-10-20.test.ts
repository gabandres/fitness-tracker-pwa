/**
 * The 2026-10-20 export review, items 1–3, on the import's write path:
 *
 *  1. a Watch walk inside a lift's window and within ±25 % of the logged
 *     Zone 2 is MERGED into it — never stored as a second row;
 *  2. a workout tombstoned on the account stays out, even where no session
 *     carries its dismissal (a deleted session, a reinstall, another device);
 *  3. a workout outside every session's window is its own session, with no
 *     template — the 10/15 20:33 walk sat on the morning's Push Day.
 *
 * Mocked at the module seam like `health-audit-2026-10-15.test.ts`; core is
 * real, because the window and merge rules are the behaviour under test.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CardioBlock } from '@macrolog/core/cardio';
import { zone2Check } from '@macrolog/core';
import type { WorkoutSession } from '@/lib/workout';

jest.unmock('@/lib/health-sync');
const mockReadWorkouts = jest.fn(async (_days: number, _opts?: { hrWindowMs?: number }) => [
  { id: 'w1', activityType: 'walking', startMs: Date.UTC(2026, 9, 1, 22), endMs: Date.UTC(2026, 9, 1, 22, 30), fromUs: false, avgHr: 104 },
]);
jest.mock('@/lib/health', () => ({
  health: { readSamples: () => Promise.resolve([]), readWorkouts: (d: number, o?: { hrWindowMs?: number }) => mockReadWorkouts(d, o) },
}));

let mockSessions: WorkoutSession[] = [];
let mockTombstones = new Set<string>();
const mockUpdateSession = jest.fn(async (_uid: string, id: string, patch: Partial<WorkoutSession>) => {
  mockSessions = mockSessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
});
let mockNextId = 0;
const mockStartSession = jest.fn(async (_uid: string, draft: Omit<WorkoutSession, 'id'>) => {
  const id = `new-${++mockNextId}`;
  mockSessions = [{ ...(draft as WorkoutSession), id }, ...mockSessions];
  return id;
});
jest.mock('@/lib/ledger', () => ({
  getDayBoundaryOnce: jest.fn().mockResolvedValue([]),
  getHealthScalarsOnce: jest.fn(async () => ({})),
  getRecentSessions: jest.fn(async () => mockSessions),
  getHealthTombstones: jest.fn(async () => mockTombstones),
  updateSession: (...a: [string, string, Partial<WorkoutSession>]) => mockUpdateSession(...a),
  startSession: (...a: [string, Omit<WorkoutSession, 'id'>]) => mockStartSession(...a),
}));

import { HR_BACKFILL_KEY, importHealthWorkouts, routeImportedBlocks, writeImportedBlocks } from '@/lib/health-sync';
import { hkWorkoutHr } from '@/lib/health';

const Z = (iso: string) => new Date(iso);
const zone2 = (over: Partial<CardioBlock> = {}): CardioBlock => ({
  modality: 'run', label: 'Zone 2', durationSec: 1200, source: 'manual',
  targetDurationSec: 1200, targetHrMin: 120, targetHrMax: 130, rpe: 2, notes: 'Good', ...over,
}) as CardioBlock;
const watch = (sourceId: string, startedAt: Date, durationSec: number, over: Partial<CardioBlock> = {}): CardioBlock => ({
  modality: 'walk', durationSec, source: 'health', provider: 'apple-watch', sourceId, startedAt, ...over,
}) as CardioBlock;
const session = (id: string, date: Date, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id, status: 'completed', date, durationMin: 54, exercises: [{ exerciseId: 'row' }] as never,
  createdAt: new Date(0), updatedAt: new Date(0), ...over,
}) as WorkoutSession;

beforeEach(async () => {
  await AsyncStorage.clear();
  mockSessions = [];
  mockTombstones = new Set();
  mockNextId = 0;
  jest.clearAllMocks();
});

describe('item 1 — the Watch copy of Zone 2 merges into the logged block', () => {
  // 10/20 Pull Day: 12:21:53Z, 54 min; Zone 2 by hand (avg HR 118, RPE 2);
  // the Watch walk 12:55:49Z, 1,215 s.
  const pull = () => session('pull', Z('2026-10-20T12:21:53Z'), { cardio: [zone2({ avgHr: 118, distanceM: 1834.7 })] });
  const walk = watch('4245078C', Z('2026-10-20T12:55:49Z'), 1215, { kcal: 115, distanceM: 1842.6 });

  it('the 10/20 walk is folded in: one Zone 2 row, the Watch duration, the user RPE / HR / notes kept', async () => {
    mockSessions = [pull()];
    await writeImportedBlocks('u1', [walk]);
    expect(mockStartSession).not.toHaveBeenCalled();
    const [, id, patch] = mockUpdateSession.mock.calls[0];
    expect(id).toBe('pull');
    expect(patch.cardio).toHaveLength(1);
    expect(patch.cardio![0]).toMatchObject({ label: 'Zone 2', source: 'manual', durationSec: 1215, avgHr: 118, rpe: 2, notes: 'Good', kcal: 115, distanceM: 1834.7 });
    expect(patch.cardio![0].sourceId).toBeUndefined();
    expect(patch.dismissedSourceIds).toEqual(['4245078C']);
  });

  it('a re-import of the merged walk adds nothing', async () => {
    mockSessions = [pull()];
    await writeImportedBlocks('u1', [walk]);
    mockUpdateSession.mockClear();
    await writeImportedBlocks('u1', [walk]);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
    expect(mockSessions[0].cardio).toHaveLength(1);
  });

  it('takes the Watch heart rate when the logged block has none, and in-band follows it', async () => {
    mockSessions = [session('pull', Z('2026-10-20T12:21:53Z'), { cardio: [zone2()] })];
    await writeImportedBlocks('u1', [{ ...walk, avgHr: 126, maxHr: 134 }]);
    const merged = mockUpdateSession.mock.calls[0][2].cardio![0];
    expect(merged).toMatchObject({ avgHr: 126, maxHr: 134 });
    expect(zone2Check(merged).inBand).toBe(true);
  });

  it('the 10/14 shape: 1,048 s after a 1,200 s Zone 2 (−13 %) merges too', () => {
    const s = session('pull14', Z('2026-10-14T11:22:51Z'), { durationMin: 58, cardio: [zone2({ avgHr: 137 })] });
    const { merges, updates, fresh } = routeImportedBlocks([s], [watch('24D8F0AB', Z('2026-10-14T12:03:58Z'), 1048)]);
    expect(merges.get(s)).toEqual([{ index: 0, block: expect.objectContaining({ durationSec: 1048 }) }]);
    expect(updates.size).toBe(0);
    expect(fresh).toEqual([]);
  });

  it('outside ±25 % of the logged Zone 2 it is a second effort, stored beside it', () => {
    const s = pull();
    const { merges, updates } = routeImportedBlocks([s], [watch('long', Z('2026-10-20T12:55:49Z'), 1800)]);
    expect(merges.size).toBe(0);
    expect(updates.get(s)).toHaveLength(1);
  });
});

describe('item 2 — an account tombstone holds where no session remembers the dismissal', () => {
  it('a tombstoned workout is not re-added — not to a session, not as a new one', async () => {
    mockTombstones = new Set(['24D8F0AB']);
    mockSessions = [session('pull14', Z('2026-10-14T11:22:51Z'), { durationMin: 58, cardio: [] })];
    await writeImportedBlocks('u1', [watch('24D8F0AB', Z('2026-10-14T12:03:58Z'), 1048)]);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('a deleted import-only session does not come back (its tombstone is all that is left)', async () => {
    mockTombstones = new Set(['eve-walk']);
    mockSessions = [];
    await writeImportedBlocks('u1', [watch('eve-walk', Z('2026-10-16T00:33:53Z'), 2036)]);
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('a failed tombstone read imports as before (the server still strips)', async () => {
    const { getHealthTombstones } = jest.requireMock('@/lib/ledger') as { getHealthTombstones: jest.Mock };
    getHealthTombstones.mockRejectedValueOnce(new Error('offline'));
    await writeImportedBlocks('u1', [watch('x', Z('2026-10-16T00:33:53Z'), 2036)]);
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });
});

describe('item 3 — a workout outside every session is its own entry', () => {
  it('the 10/15 20:33 walk does not join the morning Push Day; it gets a session with no template', async () => {
    const push = session('push', Z('2026-10-15T11:29:53Z'), { durationMin: 51, templateId: 'Nx1b', templateName: 'Push Day' } as Partial<WorkoutSession>);
    mockSessions = [push];
    await writeImportedBlocks('u1', [watch('7465A221', Z('2026-10-16T00:33:53Z'), 2036, { label: 'Outdoor Walk' })]);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStartSession).toHaveBeenCalledTimes(1);
    const draft = mockStartSession.mock.calls[0][1];
    expect(draft).toMatchObject({ status: 'completed', exercises: [], date: Z('2026-10-16T00:33:53Z') });
    expect((draft as { templateId?: string }).templateId).toBeUndefined();
    expect(draft.cardio).toEqual([expect.objectContaining({ label: 'Outdoor Walk', sourceId: '7465A221' })]);
  });

  it('two workouts outside any session on one day are two entries', () => {
    const { fresh } = routeImportedBlocks([], [
      watch('am', Z('2026-10-15T10:00:00Z'), 1800),
      watch('pm', Z('2026-10-16T00:33:53Z'), 2036),
    ]);
    expect(fresh.map((b) => b.sourceId)).toEqual(['am', 'pm']);
  });

  it('inside the window (start before the session end + 15 min) it still joins the lift', () => {
    const push = session('push', Z('2026-10-15T11:29:53Z'), { durationMin: 51 });
    const { updates, fresh } = routeImportedBlocks([push], [watch('cool', Z('2026-10-15T12:30:00Z'), 600)]);
    expect(updates.get(push)).toHaveLength(1);
    expect(fresh).toEqual([]);
  });
});

describe('past walks get their heart rate — a one-time backfill', () => {
  beforeEach(async () => {
    await AsyncStorage.setItem('ignia.health.connected', '1');
  });

  it('the first import reads HR over the whole 90-day window; later ones over the last week', async () => {
    await importHealthWorkouts('u1');
    expect(mockReadWorkouts.mock.calls[0][1]).toEqual({ hrWindowMs: 90 * 86_400_000 });
    expect(await AsyncStorage.getItem(HR_BACKFILL_KEY)).toBe('1');
    await importHealthWorkouts('u1');
    expect(mockReadWorkouts.mock.calls[1][1]).toBeUndefined();
  });

  it('a stored walk with no HR takes the backfilled HR', async () => {
    mockSessions = [{ id: 'eve', status: 'completed', date: new Date(Date.UTC(2026, 9, 1, 22)), exercises: [],
      cardio: [watch('w1', new Date(Date.UTC(2026, 9, 1, 22)), 1800, { label: 'Outdoor Walk' })],
      createdAt: new Date(0), updatedAt: new Date(0) } as WorkoutSession];
    await importHealthWorkouts('u1');
    expect(mockUpdateSession).toHaveBeenCalledWith('u1', 'eve', expect.objectContaining({
      cardio: [expect.objectContaining({ sourceId: 'w1', avgHr: 104, label: 'Outdoor Walk' })],
    }));
  });
});
