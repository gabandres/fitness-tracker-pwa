import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthSample } from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';
import type { WorkoutSession } from '@/lib/workout';

/**
 * Health defects from the 2026-10-15 audit (items 1, 2, 3, 5, 6, 7).
 *
 *  1. A HealthKit night split across two days: each stage segment was keyed by
 *     its OWN end, so 23:00-00:00 went to yesterday and the rest to today.
 *  2. Today re-exported the day's running water total on every tap, and Health
 *     sums water — each edit stacked another full-day sample.
 *  3. Water was "overridable" but no water override was ever recorded, so
 *     another app's total replaced in-app water on every foreground.
 *  5. Imported-block writes had no shared lock across Health and Oura.
 *  6. The in-flight flag was taken after an await.
 *  7. The import merged into the NEWEST same-day session only — re-adding a
 *     block an older session held or had dismissed — and wrote into a session
 *     that was active on the device.
 */

// `jest.setup.js` stubs this module for every screen test; this one tests it.
jest.unmock('@/lib/health-sync');

const mockCalls: string[] = [];
let mockSamples: Partial<Record<string, HealthSample[]>> = {};
const mockReadSamples = jest.fn((kind: string) => Promise.resolve(mockSamples[kind] ?? []));
jest.mock('@/lib/health', () => {
  const actual = jest.requireActual('@/lib/health');
  return {
    hkSleepRowsToSamples: actual.hkSleepRowsToSamples,
    sleepDeleteWindow: actual.sleepDeleteWindow,
    health: {
      readSamples: (kind: string) => mockReadSamples(kind),
      readWorkouts: () => Promise.resolve([]),
      deleteDaily: async (kind: string, day: string) => {
        await new Promise((r) => setTimeout(r, 1));
        mockCalls.push(`delete:${kind}:${day}`);
        return true;
      },
      writeDaily: async (kind: string, day: string, v: number) => {
        await new Promise((r) => setTimeout(r, 1));
        mockCalls.push(`write:${kind}:${day}:${v}`);
      },
    },
  };
});

let mockCurrent: Record<string, Record<string, number>> = {};
let mockSessions: WorkoutSession[] = [];
const mockSetDailyWater = jest.fn().mockResolvedValue(undefined);
const mockGetScalars = jest.fn(async () => mockCurrent);
const mockUpdateSession = jest.fn(async (_uid: string, id: string, patch: Partial<WorkoutSession>) => {
  mockSessions = mockSessions.map((s) => (s.id === id ? { ...s, ...patch } : s));
});
let mockNextId = 0;
const mockStartSession = jest.fn(async (_uid: string, draft: Omit<WorkoutSession, 'id'>) => {
  // A slow create: the window two unlocked imports both slipped through.
  await new Promise((r) => setTimeout(r, 5));
  const id = `new-${++mockNextId}`;
  mockSessions = [{ ...(draft as WorkoutSession), id }, ...mockSessions];
  return id;
});
jest.mock('@/lib/ledger', () => ({
  getDayBoundaryOnce: jest.fn().mockResolvedValue([]),
  getHealthScalarsOnce: () => mockGetScalars(),
  getRecentSessions: jest.fn(async () => mockSessions),
  updateSession: (...a: [string, string, Partial<WorkoutSession>]) => mockUpdateSession(...a),
  startSession: (...a: [string, Omit<WorkoutSession, 'id'>]) => mockStartSession(...a),
  setDailyActiveEnergy: jest.fn(),
  importDailySleep: jest.fn(),
  setDailySteps: jest.fn(),
  setDailyWater: (...a: unknown[]) => mockSetDailyWater(...a),
  setDailyWeight: jest.fn(),
}));

import { hkSleepRowsToSamples, sleepDeleteWindow } from '@/lib/health';
import { exportDaily, importAll, waterToApply, writeImportedBlocks } from '@/lib/health-sync';
import { readManualOverrides, recordManualOverride } from '@/lib/health-overrides';

const DAY = '2026-10-15';
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('ignia.health.connected', '1');
  mockCalls.length = 0;
  mockSamples = {};
  mockCurrent = { weight: {}, sleep: {}, water: {}, steps: {}, activeEnergy: {} };
  mockSessions = [];
  mockNextId = 0;
  jest.clearAllMocks();
});

describe('item 1 — a HealthKit night is one night', () => {
  const seg = (start: number, end: number, source = 'com.apple.health.watch', value = 3) => ({
    value,
    quantity: 0,
    startDate: new Date(start),
    endDate: new Date(end),
    sourceRevision: { source: { bundleIdentifier: source } },
  });

  it('keys every segment of a night that crosses midnight by its wake day and wake time', () => {
    const out = hkSleepRowsToSamples([
      seg(at(14, 23, 0), at(15, 0, 30)),
      seg(at(15, 0, 45), at(15, 6, 30), undefined, 4),
    ]);
    expect(out.map((s) => s.dateKey)).toEqual([DAY, DAY]);
    expect(out.map((s) => s.endMs)).toEqual([at(15, 6, 30), at(15, 6, 30)]);
    expect(out.reduce((a, s) => a + s.value, 0)).toBeCloseTo(7.25);
  });

  it('an afternoon nap is its own session; awake / in-bed segments are not sleep', () => {
    const out = hkSleepRowsToSamples([
      seg(at(14, 23, 0), at(15, 6, 0)),
      seg(at(15, 6, 0), at(15, 6, 30), undefined, 2), // awake
      seg(at(15, 14, 0), at(15, 15, 0)),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((s) => s.endMs)).toEqual([at(15, 6, 0), at(15, 15, 0)]);
  });

  it('groups per source — a ring and a watch on one night stay two sources', () => {
    const out = hkSleepRowsToSamples([
      seg(at(14, 23, 0), at(15, 0, 30), 'com.ouraring'),
      seg(at(15, 0, 30), at(15, 6, 0), 'com.apple.health.watch'),
    ]);
    expect(out.map((s) => [s.source, s.dateKey])).toEqual([
      ['com.ouraring', DAY],
      ['com.apple.health.watch', DAY],
    ]);
  });

  it('the sleep delete window holds this day’s export and neither neighbour', () => {
    const { start, end } = sleepDeleteWindow(DAY);
    const anchor = at(15, 7);
    expect(start.getTime()).toBeLessThan(anchor - 8 * 3_600_000);
    expect(end.getTime()).toBeGreaterThan(anchor);
    expect(start.getTime()).toBeGreaterThan(at(14, 7)); // yesterday's export ends here
    expect(end.getTime()).toBeLessThan(at(16, 7) - 3_600_000); // tomorrow's starts after
  });
});

describe('item 2 — an in-app value REPLACES Ignia’s export for the day', () => {
  it('deletes the previous sample before writing, and serialises rapid edits', async () => {
    await Promise.all([
      exportDaily('water', DAY, 8, { uid: 'u1' }),
      exportDaily('water', DAY, 16, { uid: 'u1' }),
    ]);
    expect(mockCalls).toEqual([
      `delete:water:${DAY}`,
      `write:water:${DAY}:8`,
      `delete:water:${DAY}`,
      `write:water:${DAY}:16`,
    ]);
  });

  it('a sleep edit replaces too; zero deletes without writing', async () => {
    await exportDaily('sleep', DAY, 7.5, { uid: 'u1' });
    await exportDaily('water', DAY, 0, { uid: 'u1' });
    expect(mockCalls).toEqual([`delete:sleep:${DAY}`, `write:sleep:${DAY}:7.5`, `delete:water:${DAY}`]);
  });

  it('a plain export (no `manual`) still only writes', async () => {
    await exportDaily('bodyFat', DAY, 18);
    expect(mockCalls).toEqual([`write:bodyFat:${DAY}:18`]);
  });
});

describe('item 3 — in-app water survives another app’s water', () => {
  const sip = (endMs: number, value: number, fromUs = false): HealthSample => ({
    dateKey: DAY,
    kind: 'water',
    value,
    endMs,
    fromUs,
    source: fromUs ? 'fit.ignia.app' : 'com.waterminder',
  });

  it('records a water override on an in-app edit (weight too; sleep is guarded by `source`)', async () => {
    await exportDaily('water', DAY, 64, { uid: 'u1' });
    await exportDaily('sleep', DAY, 7, { uid: 'u1' });
    expect(Object.keys(await readManualOverrides('u1', 'water'))).toEqual([DAY]);
    expect(await readManualOverrides('u1', 'sleep')).toEqual({});
  });

  it('pure: an edited day ADDS only the sips after the edit to the in-app total', () => {
    const r = waterToApply([sip(1_000, 32), sip(3_000, 8), sip(4_000, 64, true)], { [DAY]: 2_000 }, { [DAY]: 64 });
    expect(r.apply).toEqual({ [DAY]: 72 });
    expect(r.consumedAt).toEqual({ [DAY]: 3_000 });
  });

  it('pure: nothing after the edit → the in-app total stands', () => {
    expect(waterToApply([sip(1_000, 32)], { [DAY]: 2_000 }, { [DAY]: 64 }).apply).toEqual({});
  });

  it('pure: a sample with no usable end time is never added (review 2026-10-15)', () => {
    // `NaN <= at` is false, so the old guard ADDED it — on every run, since a
    // NaN watermark never moves past it.
    const r = waterToApply([sip(Number.NaN, 32), sip(3_000, 8)], { [DAY]: 2_000 }, { [DAY]: 64 });
    expect(r.apply).toEqual({ [DAY]: 72 });
    expect(r.consumedAt).toEqual({ [DAY]: 3_000 });
  });

  it('pure: a day never edited in-app folds exactly as before', () => {
    expect(waterToApply([sip(1_000, 32), sip(3_000, 8)], {}, {}).apply).toEqual({ [DAY]: 40 });
  });

  it('import: adds once, then moves the watermark so a second run adds nothing', async () => {
    mockCurrent.water = { [DAY]: 64 };
    mockSamples.water = [sip(1_000, 32), sip(3_000, 8)];
    await recordManualOverride('u1', 'water', DAY, 2_000);
    await importAll('u1');
    expect(mockSetDailyWater).toHaveBeenCalledWith('u1', DAY, 72);
    mockCurrent.water = { [DAY]: 72 };
    mockSetDailyWater.mockClear();
    await importAll('u1');
    expect(mockSetDailyWater).not.toHaveBeenCalled();
  });
});

describe('item 6 — one import at a time, decided synchronously', () => {
  it('two runs started in the same tick read the store once', async () => {
    await Promise.all([importAll('u1'), importAll('u1')]);
    expect(mockGetScalars).toHaveBeenCalledTimes(1);
  });
});

const block = (sourceId: string, startedAt = new Date(2026, 9, 15, 7)): CardioBlock =>
  ({ modality: 'run', durationSec: 1800, source: 'health', provider: 'other', sourceId, startedAt }) as CardioBlock;

const sess = (id: string, over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id,
  status: 'completed',
  date: new Date(2026, 9, 15, 12),
  exercises: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...over,
});

describe('item 5 — Health and Oura writes share one lock', () => {
  it('two concurrent imports of the same run create ONE session', async () => {
    await Promise.all([writeImportedBlocks('u1', [block('r1')]), writeImportedBlocks('u1', [block('r1')])]);
    expect(mockStartSession).toHaveBeenCalledTimes(1);
  });
});

describe('item 7 — every same-day session is consulted', () => {
  it('a block stored in an OLDER same-day session is not re-added to the newest', async () => {
    mockSessions = [sess('newer', { date: new Date(2026, 9, 15, 18) }), sess('older', { cardio: [block('r1')] })];
    await writeImportedBlocks('u1', [block('r1')]);
    expect(mockUpdateSession).not.toHaveBeenCalledWith('u1', 'newer', expect.anything());
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('a block dismissed from an older same-day session stays dismissed', async () => {
    mockSessions = [sess('newer', { date: new Date(2026, 9, 15, 18) }), sess('older', { dismissedSourceIds: ['r1'] })];
    await writeImportedBlocks('u1', [block('r1')]);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStartSession).not.toHaveBeenCalled();
  });

  it('never writes into a session that is active; a completed one whose window holds the block takes it', async () => {
    // Inside 'done''s window (12:00 + 90 min + 15 min) — since 2026-10-20 a
    // block outside every session's window gets its own session instead.
    mockSessions = [sess('live', { status: 'active', date: new Date(2026, 9, 15, 18) }), sess('done')];
    await writeImportedBlocks('u1', [block('r2', new Date(2026, 9, 15, 12, 30))]);
    expect(mockUpdateSession).toHaveBeenCalledTimes(1);
    expect(mockUpdateSession.mock.calls[0][1]).toBe('done');
  });

  it('with only an active session that day, the block gets its own completed session', async () => {
    mockSessions = [sess('live', { status: 'active' })];
    await writeImportedBlocks('u1', [block('r3')]);
    expect(mockUpdateSession).not.toHaveBeenCalled();
    expect(mockStartSession).toHaveBeenCalledWith('u1', expect.objectContaining({ status: 'completed' }));
  });
});
