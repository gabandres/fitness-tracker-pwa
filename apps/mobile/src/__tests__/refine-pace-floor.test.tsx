import { fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import type { TdeeResult } from '@macrolog/core';

/**
 * The pace stepper is a promise the target math is free to break: the target
 * is clamped at `calorieFloor`, so a floor near maintenance turns 0.9 lb/wk
 * into 0.04 and the screen used to say nothing at all.
 *
 * These pin the wiring — that the note reads the LIVE stepper value rather
 * than the saved profile, and that it stays away when the floor costs
 * nothing. The arithmetic itself is `packages/core/src/pace-reality.test.ts`.
 */

const tdee: TdeeResult = {
  trueTdee: 1870,
  newDailyTarget: 1850,
  weightChangeTrend: -0.1,
  source: 'measured',
  reliable: true,
};

let mockCalorieFloor: number | undefined = 1850;

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    profile: {
      sex: 'male',
      heightIn: 70,
      age: 34,
      activityLevel: 'moderate',
      targetPaceLbsPerWeek: 0.75,
      get calorieFloor() {
        return mockCalorieFloor;
      },
    },
  }),
}));

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({
    loaded: true,
    error: null,
    targets: { tdee, calorieTarget: 1850, proteinTarget: 150 },
  }),
}));

jest.mock('@/lib/ledger', () => ({
  getLatestDailyWeight: jest.fn().mockResolvedValue(182),
  saveRefinedTargets: jest.fn().mockResolvedValue(undefined),
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
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import RefineTargets from '@/app/(app)/refine-targets';

beforeEach(() => {
  mockCalorieFloor = 1850;
});

describe('Refine targets — the floor-vs-pace conflict', () => {
  it('names the pace the floor actually leaves', async () => {
    const { getByTestId } = await render(<RefineTargets />);
    // Profile pace is 0.75 against maintenance 1,870 and a 1,850 floor: the
    // deficit that survives is 20 kcal/day.
    expect(getByTestId('refine-pace-floor').props.children).toContain('0.04');
  });

  it('tracks the stepper, not the saved profile', async () => {
    const { getByTestId } = await render(<RefineTargets />);
    await fireEvent.press(getByTestId('refine-pace-minus')); // 0.75 → 0.50
    await fireEvent.press(getByTestId('refine-pace-minus')); // 0.50 → 0.25
    // Still capped at the same 0.04 — the floor, not the ask, is the ceiling.
    expect(getByTestId('refine-pace-floor').props.children).toContain('0.04');
  });

  it('says nothing when the floor is not costing anything', async () => {
    mockCalorieFloor = 1200;
    const { queryByTestId } = await render(<RefineTargets />);
    // 1,870 − 375 = 1,495, which clears a 1,200 floor: the user gets the 0.75
    // they asked for and there is nothing to warn about.
    expect(queryByTestId('refine-pace-floor')).toBeNull();
  });

  it('calls out a floor at or above maintenance as no deficit at all', async () => {
    mockCalorieFloor = 2100;
    const { getByTestId } = await render(<RefineTargets />);
    // The more alarming half of the same misconfiguration: this target is a
    // surplus, and rounding the pace to 0 would have hidden it.
    expect(getByTestId('refine-pace-floor').props.children).toContain('deficit');
  });
});
