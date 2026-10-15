import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import type { TdeeResult } from '@macrolog/core';

/**
 * (Mocks copied from daily-targets.test.tsx.) Audit 2026-10-15, 09-22 item f:
 * a custom protein BELOW the user's own protein floor was accepted, and
 * `dailyTargets` then clamps it up to the floor — the same silent override the
 * calorie floor check exists to prevent. It is refused on screen, with why.
 *
 * Original header: The Daily-targets editor — the screen a real user asked for by name
 * (UX_AUDIT, Abdiel Medina, 2026-08-21).
 *
 * Three things here are load-bearing and none of them are visible to `tsc`:
 *
 *  1. **Automatic does not destroy the custom numbers.** That was the old
 *     behaviour — `saveRefinedTargets` had to `deleteField()` them because
 *     presence WAS the mode — and it is the one-way door the explicit
 *     `targetMode` exists to remove.
 *  2. **A below-floor number cannot be saved.** `dailyTargets` clamps with
 *     `Math.max(calorieFloor, …)`, so accepting one would store 1,300 and
 *     display 1,850: the silent override this feature was built to end.
 *  3. **Blank protein means automatic, not zero.** Owning your calories must
 *     not freeze protein at whatever it was the day you typed a number.
 */
const mockSaveTargetMode = jest.fn().mockResolvedValue(undefined);
const mockBack = jest.fn();

let mockProfile: Record<string, unknown> = {};

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn(), canGoBack: () => true }),
  usePathname: () => '/daily-targets',
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }),
}));

jest.mock('@/lib/ledger', () => ({
  saveTargetMode: (...args: unknown[]) => mockSaveTargetMode(...args),
}));

const measured: TdeeResult = {
  trueTdee: 2600,
  newDailyTarget: 2100,
  weightChangeTrend: -0.1,
  source: 'measured',
  reliable: true,
  loggingCompletenessPct: 90,
  windowDays: 40,
  intakeDays: 40,
  spanDays: 42,
  outliersDropped: 0,
  measuredTdee: 2600,
  confidence: 1,
  avgDailyIntake: 2200,
  weightSlopeLbsPerDay: -0.05,
  dailyDeficitAchieved: 400,
};

let mockTdee: TdeeResult = measured;

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({
    loaded: true,
    error: null,
    targets: { calorieTarget: 2100, proteinTarget: 150, proteinMinTarget: 150, currentWeight: 190, tdee: mockTdee },
  }),
}));

import DailyTargetsScreen from '@/app/daily-targets';

beforeEach(() => {
  mockSaveTargetMode.mockClear();
  mockBack.mockClear();
  mockProfile = {};
  mockTdee = measured;
});


describe('custom protein vs the protein floor', () => {
  it('refuses a number under the floor, says why, and writes nothing', async () => {
    mockProfile = { targetMode: 'custom', manualCaloriesTarget: 2000, proteinFloor: 140 };
    const screen = await render(<DailyTargetsScreen />);
    await fireEvent.changeText(screen.getByTestId('targets-protein'), '120');
    expect(screen.getByTestId('targets-protein-note')).toHaveTextContent(/140 g protein floor/);
    await act(async () => {
      await fireEvent.press(screen.getByTestId('targets-save'));
    });
    expect(mockSaveTargetMode).not.toHaveBeenCalled();
  });

  it('accepts a number at the floor', async () => {
    mockProfile = { targetMode: 'custom', manualCaloriesTarget: 2000, proteinFloor: 140 };
    const screen = await render(<DailyTargetsScreen />);
    await fireEvent.changeText(screen.getByTestId('targets-protein'), '140');
    expect(screen.queryByTestId('targets-protein-note')).toBeNull();
    await act(async () => {
      await fireEvent.press(screen.getByTestId('targets-save'));
    });
    expect(mockSaveTargetMode).toHaveBeenCalledWith('u1', 'custom', { calories: 2000, protein: 140 });
  });

  it('has no opinion when no floor is set', async () => {
    mockProfile = { targetMode: 'custom', manualCaloriesTarget: 2000 };
    const screen = await render(<DailyTargetsScreen />);
    await fireEvent.changeText(screen.getByTestId('targets-protein'), '60');
    expect(screen.queryByTestId('targets-protein-note')).toBeNull();
  });
});
