import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthSample } from '@macrolog/core';

/**
 * The steps-only import a HealthKit background delivery, the step observer and
 * Today appearing run (2026-11-06, `importRecentSteps`): three days, two
 * statistics reads, one Firestore range; only changed days written, stamped
 * HealthKit; a final day stored in another zone kept.
 */

jest.unmock('@/lib/health-sync');
jest.mock('react-native', () => ({
  Platform: { OS: 'ios', select: (o: Record<string, unknown>) => o.ios },
  AppState: { addEventListener: jest.fn(() => ({ remove: jest.fn() })), currentState: 'active' },
  Linking: { openURL: jest.fn(), openSettings: jest.fn() },
}));
jest.mock('@/lib/device-tz', () => ({ deviceTimeZone: () => 'America/La_Paz' }));

let mockSamples: Partial<Record<string, HealthSample[]>> = {};
const mockReadSamples = jest.fn((kind: string, _days: number) => Promise.resolve(mockSamples[kind] ?? []));
jest.mock('@/lib/health', () => ({
  health: { readSamples: (kind: string, days: number) => mockReadSamples(kind, days) },
}));

let mockStored: Record<string, { steps?: number; distanceM?: number; tz?: string }> = {};
const mockWindow = jest.fn(async (_uid: string, _from: string, _to: string) => mockStored);
const mockWrite = jest.fn(async (_uid: string, _kind: string, _days: Record<string, number>, _source?: string) => undefined);
jest.mock('@/lib/ledger', () => ({
  getActivityWindow: (uid: string, from: string, to: string) => mockWindow(uid, from, to),
  writeHealthScalars: (uid: string, kind: string, days: Record<string, number>, source?: string) => mockWrite(uid, kind, days, source),
}));
jest.mock('@/lib/pending-body', () => ({ flushPendingBody: jest.fn().mockResolvedValue(0) }));

import { disconnectHealth, importRecentSteps } from '@/lib/health-sync';

const s = (kind: 'steps' | 'distance', dateKey: string, value: number): HealthSample => ({ dateKey, kind, value, endMs: 0, fromUs: false });

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('ignia.health.connected', '1');
  jest.clearAllMocks();
  jest.useFakeTimers({ now: new Date(2026, 10, 6, 9, 0) });
  mockSamples = {};
  mockStored = {};
});
afterEach(() => jest.useRealTimers());

it('reads three days, writes only changed days of steps and distance, stamped HealthKit', async () => {
  mockSamples = {
    steps: [s('steps', '2026-11-03', 9957), s('steps', '2026-11-04', 10641), s('steps', '2026-11-05', 6671), s('steps', '2026-11-06', 1031)],
    distance: [s('distance', '2026-11-05', 4810.2), s('distance', '2026-11-06', 744)],
  };
  mockStored = { '2026-11-04': { steps: 10641, tz: 'America/La_Paz' }, '2026-11-05': { steps: 6000 } };
  await importRecentSteps('u1');
  expect(mockWindow).toHaveBeenCalledWith('u1', '2026-11-04', '2026-11-06');
  expect(mockReadSamples.mock.calls.map((c) => c.slice(0, 2))).toEqual([['steps', 3], ['distance', 3]]);
  // 11/3 is outside the window; 11/4 unchanged; 11/5 changed; 11/6 new.
  expect(mockWrite).toHaveBeenCalledWith('u1', 'steps', { '2026-11-05': 6671, '2026-11-06': 1031 }, 'healthkit');
  expect(mockWrite).toHaveBeenCalledWith('u1', 'distance', { '2026-11-05': 4810.2, '2026-11-06': 744 }, 'healthkit');
});

it('keeps a final day that was counted in another zone', async () => {
  mockSamples = { steps: [s('steps', '2026-11-05', 7000), s('steps', '2026-11-06', 1500)] };
  mockStored = { '2026-11-05': { steps: 6671, tz: 'America/Puerto_Rico' }, '2026-11-06': { steps: 1031, tz: 'America/Puerto_Rico' } };
  await importRecentSteps('u1');
  expect(mockWrite).toHaveBeenCalledWith('u1', 'steps', { '2026-11-06': 1500 }, 'healthkit');
});

it('does nothing when Health is not connected', async () => {
  // Through the module: the connected flag is cached in memory.
  await disconnectHealth();
  expect(await importRecentSteps('u1')).toBe(0);
  expect(mockReadSamples).not.toHaveBeenCalled();
});
