import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import type { TdeeResult } from '@macrolog/core';

/**
 * (Mocks copied from refine-goal.test.tsx.) Audit 2026-10-15, 09-22 items:
 * tapping the activity row already selected counted as a manual change and
 * cleared the device-measured multiplier on save (ADR-0024); and inches above
 * 11 were accepted.
 *
 * Original header: Refine targets carries the goal beside the pace (2026-10-15). It owned the
 * pace and not the goal, so the owner's account read "Goal: Maintain" with a
 * 0.8 lb/wk pace and a target 400 kcal under maintenance, and changing the
 * goal took a full Redo setup. It also wrote `targetMode: 'auto'` on every
 * save, so refining a height dropped a user off their own targets — the
 * ledger no longer does (`saveRefinedTargets`).
 */

const tdee: TdeeResult = {
  trueTdee: 2105,
  newDailyTarget: 1850,
  weightChangeTrend: -2,
  source: 'measured',
  reliable: true,
  loggingCompletenessPct: 100,
  windowDays: 42,
  intakeDays: 42,
  spanDays: 42,
  outliersDropped: 0,
  measuredTdee: 2105,
  confidence: 1,
  avgDailyIntake: 1858,
  weightSlopeLbsPerDay: -0.07,
  dailyDeficitAchieved: 247,
};

const mockSaveRefined = jest.fn().mockResolvedValue(undefined);
let mockTargetMode: 'auto' | 'custom' = 'custom';

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    profile: {
      sex: 'male',
      heightIn: 68,
      age: 33,
      activityLevel: 'moderate',
      targetPaceLbsPerWeek: 0.8,
      goalDirection: 'maintain',
      calorieFloor: 1850,
      get targetMode() {
        return mockTargetMode;
      },
    },
  }),
}));
jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: true, error: null, targets: { tdee, calorieTarget: 1850, proteinTarget: 140 } }),
}));
jest.mock('@/lib/ledger', () => ({
  getLatestDailyWeight: jest.fn().mockResolvedValue(153.6),
  saveRefinedTargets: (...a: unknown[]) => mockSaveRefined(...a),
}));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: jest.fn(),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: () => ({}),
}));
jest.mock('@/lib/activity-suggestion', () => ({
  useActivitySuggestion: () => ({
    suggestion: null,
    guidance: { kind: 'none' },
    decline: jest.fn(),
    accept: jest.fn(),
    connect: jest.fn(),
    connecting: false,
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

import RefineTargets from '@/app/refine-targets';

beforeEach(() => {
  mockSaveRefined.mockClear();
  mockTargetMode = 'custom';
});


describe('Refine targets — audit 2026-10-15', () => {
  it('re-tapping the selected activity row leaves the measured multiplier alone', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-activity-moderate'));
    await fireEvent.press(screen.getByTestId('refine-save'));
    expect(mockSaveRefined).toHaveBeenCalledTimes(1);
    expect(mockSaveRefined.mock.calls[0][1].activityMultiplier).toBeUndefined();
  });

  it('tapping away and back to the stored bucket does not clear it either', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-activity-light'));
    await fireEvent.press(screen.getByTestId('refine-activity-moderate'));
    await fireEvent.press(screen.getByTestId('refine-save'));
    expect(mockSaveRefined.mock.calls[0][1].activityMultiplier).toBeUndefined();
  });

  it('a real change of bucket still clears it', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-activity-light'));
    await fireEvent.press(screen.getByTestId('refine-save'));
    expect(mockSaveRefined.mock.calls[0][1].activityMultiplier).toBeNull();
  });

  it('refuses inches above 11 and says why', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.changeText(screen.getByTestId('refine-inches'), '14');
    expect(screen.getByTestId('refine-height-error')).toHaveTextContent(/0 to 11/);
  });
});
