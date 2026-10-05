import AsyncStorage from '@react-native-async-storage/async-storage';
import type { HealthSample } from '@macrolog/core';

/**
 * Body review, bug 1: a deleted weigh-in came back on the next foreground.
 *
 * `importScalars` writes any Health day whose value differs from Firestore's,
 * and runs on every foreground. Delete a weigh-in a scale also wrote and the
 * scale's sample re-created it; type a correction over the scale's reading and
 * the import "corrected" it back. The fix is a device-local record of the
 * manual act (`health-overrides.ts`) that the import honours BY TIME: samples
 * that ended before the act are superseded, a later reading still imports.
 */

// `jest.setup.js` stubs this module for every screen test; this one tests it.
jest.unmock('@/lib/health-sync');

let mockWeightSamples: HealthSample[] = [];
const mockDeleteDaily = jest.fn().mockResolvedValue(true);
jest.mock('@/lib/health', () => ({
  health: {
    readSamples: (kind: string) => Promise.resolve(kind === 'weight' ? mockWeightSamples : []),
    readWorkouts: () => Promise.resolve([]),
    deleteDaily: (...a: unknown[]) => mockDeleteDaily(...a),
    writeDaily: jest.fn().mockResolvedValue(undefined),
  },
}));

const mockSetDailyWeight = jest.fn().mockResolvedValue(undefined);
jest.mock('@/lib/ledger', () => ({
  getDayBoundaryOnce: jest.fn().mockResolvedValue([]),
  getHealthScalarsOnce: jest.fn().mockResolvedValue({ weight: {}, sleep: {}, water: {}, steps: {}, activeEnergy: {} }),
  getRecentSessions: jest.fn().mockResolvedValue([]),
  updateSession: jest.fn(),
  startSession: jest.fn(),
  markExercised: jest.fn(),
  setDailyActiveEnergy: jest.fn(),
  importDailySleep: jest.fn(),
  setDailySteps: jest.fn(),
  setDailyWater: jest.fn(),
  setDailyWeight: (...a: unknown[]) => mockSetDailyWeight(...a),
}));

import { forgetHealthWeight, importAll } from '@/lib/health-sync';
import { readManualOverrides, recordManualOverride } from '@/lib/health-overrides';
import { readHealthStatus } from '@/lib/health-status';

const DAY = '2026-09-28';
const scale = (endMs: number, value = 180): HealthSample => ({
  dateKey: DAY,
  kind: 'weight',
  value,
  endMs,
  fromUs: false,
  source: 'com.withings.wiscale2',
});

beforeEach(async () => {
  await AsyncStorage.clear();
  await AsyncStorage.setItem('ignia.health.connected', '1');
  mockSetDailyWeight.mockClear();
  mockDeleteDaily.mockClear();
});

it('without an override, a scale sample for an empty day is imported (the old behaviour)', async () => {
  mockWeightSamples = [scale(1_000)];
  await importAll('u1');
  expect(mockSetDailyWeight).toHaveBeenCalledWith('u1', DAY, 180, expect.anything());
});

it('a weigh-in deleted AFTER the scale wrote it stays deleted', async () => {
  mockWeightSamples = [scale(1_000)];
  await recordManualOverride('u1', 'weight', DAY, 2_000);
  await importAll('u1');
  expect(mockSetDailyWeight).not.toHaveBeenCalled();
});

it('a reading taken after the delete still imports — it is newer than the correction', async () => {
  mockWeightSamples = [scale(1_000, 180), scale(3_000, 179.2)];
  await recordManualOverride('u1', 'weight', DAY, 2_000);
  await importAll('u1');
  expect(mockSetDailyWeight).toHaveBeenCalledWith('u1', DAY, 179.2, expect.anything());
});

it('overrides are per account', async () => {
  mockWeightSamples = [scale(1_000)];
  await recordManualOverride('someone-else', 'weight', DAY, 2_000);
  await importAll('u1');
  expect(mockSetDailyWeight).toHaveBeenCalledTimes(1);
});

it('records the run for the Connected apps evidence line (bug 14)', async () => {
  mockWeightSamples = [scale(1_000)];
  await importAll('u1');
  const status = await readHealthStatus();
  expect(status.lastSync?.count).toBe(1);
});

it('forgetHealthWeight records the act and removes Ignia\'s own sample', async () => {
  await expect(forgetHealthWeight('u1', DAY)).resolves.toBe(true);
  expect(mockDeleteDaily).toHaveBeenCalledWith('weight', DAY);
  expect(Object.keys(await readManualOverrides('u1', 'weight'))).toEqual([DAY]);
});
