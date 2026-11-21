import { renderHook } from '@testing-library/react-native';

/**
 * The widget is written only for a signed-in profile (2026-11-20).
 *
 * At sign-out the profile goes first and the targets fall back to the seed
 * (1,800 kcal, 0 g protein). The sync hook, still mounted for a frame, wrote
 * that seed to the home-screen widget after `clearWidget()` had blanked it —
 * found on the OnePlus 8T, where a signed-out phone read "1,800 kcal left".
 */
const mockSync = jest.fn();
let mockAuth: { user: { uid: string } | null; profile: Record<string, unknown> | null } = { user: null, profile: null };

jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuth }));
jest.mock('@/i18n', () => ({ useLocale: () => 'en' }));
jest.mock('@/lib/widget', () => ({ syncWidget: (...a: unknown[]) => mockSync(...a) }));
jest.mock('@/lib/quick-add', () => ({
  flushPendingLogs: jest.fn(),
  getQuickAddSlots: async () => [],
  subscribeQuickAddSlots: () => () => {},
  syncQuickAddTile: jest.fn(),
  watchQuickAddCredentials: () => () => {},
}));

import type { DailyTargets, DaySummary } from '@macrolog/core';
import { useWidgetSync } from '@/hooks/useWidgetSync';

const summary = { dateKey: '2026-11-20', totalCalories: 0, totalProtein: 0, totalCarbs: 0, totalFat: 0, mealCount: 0, exercised: false, weightLb: null } as DaySummary;
const seed = { calorieTarget: 1800, proteinTarget: 0, proteinMinTarget: 0 } as DailyTargets;
const real = { calorieTarget: 1920, proteinTarget: 130, proteinMinTarget: 110 } as DailyTargets;

beforeEach(() => mockSync.mockClear());

it('writes nothing for a signed-out phone, whatever the targets fell back to', async () => {
  mockAuth = { user: null, profile: null };
  await renderHook(() => useWidgetSync(summary, seed));
  expect(mockSync).not.toHaveBeenCalled();
});

it('writes nothing in the frame where the user is still there and the profile is gone', async () => {
  mockAuth = { user: { uid: 'u1' }, profile: null };
  await renderHook(() => useWidgetSync(summary, seed));
  expect(mockSync).not.toHaveBeenCalled();
});

it('writes the day for a signed-in profile, with protein first when it is on', async () => {
  mockAuth = { user: { uid: 'u1' }, profile: { proteinFirst: true, calorieFloor: 1500 } };
  await renderHook(() => useWidgetSync(summary, real));
  expect(mockSync).toHaveBeenCalled();
  const args = mockSync.mock.calls[mockSync.mock.calls.length - 1];
  expect(args[1]).toBe(real);
  expect(args[7]).toMatchObject({ proteinTarget: 130, kcalMin: 1500, kcalMax: 1920 });
});
