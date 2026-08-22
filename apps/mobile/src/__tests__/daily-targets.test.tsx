import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import type { TdeeResult } from '@macrolog/core';

/**
 * The Daily-targets editor — the screen a real user asked for by name
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
  useRouter: () => ({ back: mockBack, push: jest.fn(), replace: jest.fn() }),
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
  spanDays: 42,
  outliersDropped: 0,
  measuredTdee: 2600,
  confidence: 1,
  avgDailyIntake: 2200,
  weightSlopeLbsPerDay: -0.05,
  dailyDeficitAchieved: 400,
};

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({
    loaded: true,
    error: null,
    targets: { calorieTarget: 2100, proteinTarget: 150, proteinMinTarget: 150, currentWeight: 190, tdee: measured },
  }),
}));

import DailyTargetsScreen from '@/app/(app)/daily-targets';

beforeEach(() => {
  mockSaveTargetMode.mockClear();
  mockBack.mockClear();
  mockProfile = {};
});

describe('Daily targets editor', () => {
  it('switching to Automatic writes the MODE and leaves the numbers alone', async () => {
    mockProfile = { targetMode: 'custom', manualCaloriesTarget: 2000 };
    const { getByTestId } = await render(<DailyTargetsScreen />);

    await fireEvent.press(getByTestId('targets-mode-auto'));
    await act(async () => {
      await fireEvent.press(getByTestId('targets-save'));
    });

    // An empty targets object: nothing is deleted, so flipping back to Custom
    // restores 2000 without the user retyping it.
    expect(mockSaveTargetMode).toHaveBeenCalledWith('u1', 'auto', {});
  });

  it('saves a custom calorie target', async () => {
    const { getByTestId } = await render(<DailyTargetsScreen />);
    await fireEvent.press(getByTestId('targets-mode-custom'));
    await fireEvent.changeText(getByTestId('targets-kcal'), '2000');
    await act(async () => {
      await fireEvent.press(getByTestId('targets-save'));
    });
    expect(mockSaveTargetMode).toHaveBeenCalledWith('u1', 'custom', { calories: 2000, protein: null });
  });

  it('blocks a below-floor number instead of clamping it silently', async () => {
    const { getByTestId } = await render(<DailyTargetsScreen />);
    await fireEvent.press(getByTestId('targets-mode-custom'));
    await fireEvent.changeText(getByTestId('targets-kcal'), '1300');

    expect(getByTestId('targets-kcal-note')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('targets-save'));
    });
    expect(mockSaveTargetMode).not.toHaveBeenCalled();
  });

  it('warns about a steep cut but still saves it', async () => {
    const { getByTestId } = await render(<DailyTargetsScreen />);
    await fireEvent.press(getByTestId('targets-mode-custom'));
    // 1800 against a measured 2600 is 31% under — advisory, not blocking.
    await fireEvent.changeText(getByTestId('targets-kcal'), '1800');
    expect(getByTestId('targets-kcal-note')).toBeTruthy();
    await act(async () => {
      await fireEvent.press(getByTestId('targets-save'));
    });
    expect(mockSaveTargetMode).toHaveBeenCalledWith('u1', 'custom', { calories: 1800, protein: null });
  });

  it('shows the measured estimate beside the custom number, not instead of it', async () => {
    const { getByTestId } = await render(<DailyTargetsScreen />);
    await fireEvent.press(getByTestId('targets-mode-custom'));
    // The estimator keeps running in custom mode; that is what makes the
    // second opinion on screen truthful rather than a stale cache.
    expect(getByTestId('targets-measured')).toBeTruthy();
  });

  it('seeds the field from the current target rather than opening blank', async () => {
    const { getByTestId } = await render(<DailyTargetsScreen />);
    await fireEvent.press(getByTestId('targets-mode-custom'));
    expect(getByTestId('targets-kcal').props.value).toBe('2100');
  });
});
