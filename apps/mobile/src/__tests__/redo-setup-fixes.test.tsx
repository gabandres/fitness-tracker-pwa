import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import React from 'react';
import { type Profile, MIDNIGHT, dayKeyAt } from '@macrolog/core';

/**
 * Settings → Redo setup, the eight flaws found on 2026-10-15 (owner's account:
 * "Maintain" with a 0.8 lb/wk pace, his own 140 g protein, a 1,850 floor).
 * The patch semantics are pinned in core (`firestore-writers.test.ts`,
 * `onboarding-preview.test.ts`); this pins what the SCREEN sends and shows.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
const mockGetLatestWeight = jest.fn().mockResolvedValue(153.6);
const mockWriteMetric = jest.fn().mockResolvedValue(undefined);

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    get profile() {
      return mockProfile;
    },
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/ledger', () => ({
  saveOnboardingV2: (...a: unknown[]) => mockSave(...a),
  getLatestDailyWeight: (...a: unknown[]) => mockGetLatestWeight(...a),
  getRecentLogs: async () => [],
  getAllDailyWeights: async () => ({}),
}));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: (...a: unknown[]) => mockWriteMetric(...a) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  updateDoc: jest.fn().mockResolvedValue(undefined),
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
}));

import Onboarding from '@/app/onboarding';

const OWNER: Partial<Profile> = {
  profileCompleted: true,
  goalDirection: 'maintain',
  sex: 'male',
  heightIn: 68,
  age: 33,
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 0.8,
  calorieFloor: 1850,
  targetMode: 'custom',
  manualProteinTarget: 140,
  proteinPerKg: 1.9,
};

beforeEach(() => {
  mockProfile = { ...OWNER };
  mockSave.mockClear();
  mockWriteMetric.mockClear();
  mockGetLatestWeight.mockResolvedValue(153.6);
});

type Screen = Awaited<ReturnType<typeof render>>;
const flush = () => act(async () => {});

/** Lose → weight step, with the redo's reads landed. */
async function toWeight(screen: Screen) {
  await flush();
  await fireEvent.press(screen.getByTestId('onboarding-goal-lose'));
  await fireEvent.press(screen.getByTestId('onboarding-next'));
}
/** From the weight step to the plan, no goal weight, body/activity prefilled. */
async function weightToPlan(screen: Screen) {
  await fireEvent.press(screen.getByTestId('onboarding-next')); // weight
  await fireEvent.press(screen.getByTestId('onboarding-next')); // goal weight, blank
  await fireEvent.press(screen.getByTestId('onboarding-next')); // body
  await fireEvent.press(screen.getByTestId('onboarding-next')); // activity
  await flush();
}

describe('the weight step on a redo', () => {
  it('starts at the latest weigh-in and says so', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    expect(screen.getByTestId('onboarding-weight').props.value).toBe('153.6');
    expect(screen.getByTestId('onboarding-weight-prefilled')).toBeTruthy();
  });

  it('an untouched prefill is NOT written as a weigh-in (it is an old reading)', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockWriteMetric).not.toHaveBeenCalled();
  });

  it("a changed weight is saved as today's weigh-in", async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '152.8');
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockWriteMetric).toHaveBeenCalledWith('u1', 'weight', dayKeyAt(new Date(), MIDNIGHT), 152.8);
  });
});

describe('goal weight is optional, and must point the right way', () => {
  it('Lose continues with it blank and saves no goal weight', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockSave.mock.calls[0][1].targetWeightLbs).toBeUndefined();
    expect(mockSave.mock.calls[0][1].goalDirection).toBe('lose');
  });

  it('a loss goal above the current weight is refused, with the reason', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '160');
    expect(screen.getByTestId('onboarding-target-weight-error').props.children).toContain('below your current');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    expect(screen.getByTestId('onboarding-target-weight')).toBeTruthy(); // still here
  });

  it('the skip link clears a typed goal weight and moves on', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-target-weight'), '160');
    await fireEvent.press(screen.getByTestId('onboarding-skip-goal-weight'));
    expect(screen.getByTestId('onboarding-sex-male')).toBeTruthy();
  });
});

describe('the plan step shows, and saves, what will actually apply', () => {
  it("shows the user's own 140 g, not the plan's 1.6 g/kg number", async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    // Opening the editor starts it from the number on screen.
    await fireEvent.press(screen.getByTestId('onboarding-protein'));
    expect(screen.getByTestId('onboarding-protein-input').props.value).toBe('140');
  });

  it('Save with nothing edited keeps a custom user on custom targets', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    const sub = mockSave.mock.calls[0][1];
    expect(sub.previousTargetMode).toBe('custom');
    expect(sub.edited).toEqual({ kcal: false, protein: false });
  });

  it('editing calories alone marks ONLY calories as edited', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-kcal'));
    await fireEvent.changeText(screen.getByTestId('onboarding-kcal-input'), '1850');
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    const sub = mockSave.mock.calls[0][1];
    expect(sub.edited).toEqual({ kcal: true, protein: false });
    expect(sub.manualCaloriesTarget).toBe(1850);
  });

  it('opening a number and leaving it as it was is not an edit', async () => {
    const screen = await render(<Onboarding />);
    await toWeight(screen);
    await weightToPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-protein'));
    await fireEvent.press(screen.getByTestId('onboarding-save'));
    expect(mockSave.mock.calls[0][1].edited).toEqual({ kcal: false, protein: false });
  });
});
