import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';
import type { TdeeResult } from '@macrolog/core';

/**
 * Refine targets carries the goal beside the pace (2026-10-15). It owned the
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
// The discard guard (A31): capture what the screen hands `usePreventRemove`.
const mockGuard: { on: boolean; cb: ((e: { data: { action: unknown } }) => void) | null } = { on: false, cb: null };
const mockDispatch = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  ConfirmHost: () => null,
  confirm: (o: unknown) => mockConfirm(o),
}));
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  usePreventRemove: (on: boolean, cb: (e: { data: { action: unknown } }) => void) => {
    mockGuard.on = on;
    mockGuard.cb = cb;
  },
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: () => true }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: jest.fn(),
}));

import RefineTargets, { refineDirty } from '@/app/refine-targets';

beforeEach(() => {
  mockSaveRefined.mockClear();
  mockTargetMode = 'custom';
});

describe('Refine targets — the goal beside the pace', () => {
  it('opens on the stored goal; Maintain has no pace to set', async () => {
    const screen = await render(<RefineTargets />);
    expect(screen.getByTestId('refine-goal-maintain').props.accessibilityState.selected).toBe(true);
    expect(screen.getByTestId('refine-pace-maintain')).toBeTruthy();
    expect(screen.queryByTestId('refine-pace')).toBeNull();
  });

  it('Lose brings back the stored pace, signed, and saves the goal with it', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-goal-lose'));
    expect(screen.getByTestId('refine-pace').props.children).toBe('−0.80 lb/wk');
    await fireEvent.press(screen.getByTestId('refine-save'));
    expect(mockSaveRefined).toHaveBeenCalledTimes(1);
    expect(mockSaveRefined.mock.calls[0][1]).toMatchObject({ goalDirection: 'lose', targetPaceLbsPerWeek: 0.8 });
  });

  it('a Lose pace cannot step down to 0 — that is Maintain, the button above', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-goal-lose'));
    for (let i = 0; i < 5; i++) await fireEvent.press(screen.getByTestId('refine-pace-minus'));
    expect(screen.getByTestId('refine-pace').props.children).toBe('−0.25 lb/wk');
  });

  it('Maintain saves pace 0 whatever was on screen', async () => {
    const screen = await render(<RefineTargets />);
    await fireEvent.press(screen.getByTestId('refine-goal-lose'));
    await fireEvent.press(screen.getByTestId('refine-goal-maintain'));
    await fireEvent.press(screen.getByTestId('refine-save'));
    expect(mockSaveRefined.mock.calls[0][1]).toMatchObject({ goalDirection: 'maintain', targetPaceLbsPerWeek: 0 });
  });

  it('tells a user on their own targets that this changes the suggestion, not their targets', async () => {
    const screen = await render(<RefineTargets />);
    expect(screen.getByTestId('refine-custom-note')).toBeTruthy();
  });

  it('says nothing of the sort to an automatic user', async () => {
    mockTargetMode = 'auto';
    const screen = await render(<RefineTargets />);
    expect(screen.queryByTestId('refine-custom-note')).toBeNull();
  });
});

// ── A31 + why sex is asked (2026-11-19) ───────────────────────────────────
describe('Refine targets — discard guard and the sex reason', () => {
  it('refineDirty: field by field against the opening values', () => {
    const base = { sex: 'male' as const, feet: '5', inches: '8', heightCm: '173', age: '33', activity: 'moderate' as const, goal: 'maintain' as const, pace: 0 };
    expect(refineDirty(base, base)).toBe(false);
    expect(refineDirty(base, { ...base, age: '33 ' })).toBe(false);
    expect(refineDirty(base, { ...base, age: '34' })).toBe(true);
    expect(refineDirty(base, { ...base, goal: 'lose' })).toBe(true);
    expect(refineDirty(base, { ...base, pace: 0.5 })).toBe(true);
  });

  it('clean on open, dirty after a change, and a save goes straight through', async () => {
    mockConfirm.mockClear();
    mockDispatch.mockClear();
    const screen = await render(<RefineTargets />);
    expect(mockGuard.on).toBe(false);
    await fireEvent.press(screen.getByTestId('refine-goal-lose'));
    expect(mockGuard.on).toBe(true);
    mockGuard.cb?.({ data: { action: { type: 'GO_BACK' } } });
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    expect(mockDispatch).not.toHaveBeenCalled();
    mockConfirm.mockClear();
    await fireEvent.press(screen.getByTestId('refine-save'));
    await waitFor(() => expect(mockSaveRefined).toHaveBeenCalled());
    const action = { type: 'GO_BACK' };
    mockGuard.cb?.({ data: { action } });
    expect(mockConfirm).not.toHaveBeenCalled();
    expect(mockDispatch).toHaveBeenCalledWith(action);
  });

  it('says why sex is asked, under the control', async () => {
    const screen = await render(<RefineTargets />);
    expect(screen.getByTestId('refine-sex-why')).toHaveTextContent('Used to set your starting calorie estimate.');
  });
});
