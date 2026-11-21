import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { Profile } from '@macrolog/core';
import { en } from '@/i18n/en';

/**
 * Plain-language onboarding (2026-11-19). Only 33% of signups ever logged a
 * food, and the copy assumed a calorie-counting vocabulary. Pinned here:
 *  - every activity level carries an example line under its label;
 *  - the plan step says what the calorie number is FOR, in the goal's words,
 *    on a first run with the suggested numbers (not once the user types their
 *    own, and not on a redo, which has its own basis line);
 *  - the plan step says why protein is there.
 * Asserted by testID and key, so the copy itself can change without this file.
 */

let mockProfile: Partial<Profile> | null = null;

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
  saveOnboardingV2: async () => undefined,
  getLatestDailyWeight: async () => null,
  getRecentLogs: async () => [],
  getAllDailyWeights: async () => ({}),
  setUnitSystem: async () => undefined,
}));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: async () => undefined }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/tracker-prefs', () => ({ initTrackerPrefsForNewAccount: async () => undefined }));
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: () => ({}),
  updateDoc: async () => undefined,
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import Onboarding from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
});

type Screen = Awaited<ReturnType<typeof render>>;

async function toActivity(screen: Screen, goal: 'lose' | 'maintain' | 'gain') {
  const { getByTestId } = screen;
  if (!mockProfile?.profileCompleted) await fireEvent.press(getByTestId('onboarding-age-attest'));
  await fireEvent.press(getByTestId(`onboarding-goal-${goal}`));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-sex-female'));
  await fireEvent.changeText(getByTestId('onboarding-feet'), '5');
  await fireEvent.changeText(getByTestId('onboarding-inches'), '6');
  await fireEvent.changeText(getByTestId('onboarding-age'), '30');
  await fireEvent.press(getByTestId('onboarding-next'));
}

async function toPlan(screen: Screen, goal: 'lose' | 'maintain' | 'gain') {
  await toActivity(screen, goal);
  await fireEvent.press(screen.getByTestId('onboarding-activity-light'));
  await fireEvent.press(screen.getByTestId('onboarding-next'));
}

describe('activity step', () => {
  it('shows an example line under each of the five levels', async () => {
    const screen = await render(<Onboarding />);
    await toActivity(screen, 'lose');
    for (const level of ['sedentary', 'light', 'moderate', 'active', 'very_active']) {
      const hint = screen.getByTestId(`onboarding-activity-hint-${level}`);
      expect(hint).toBeTruthy();
      // A real line, not an empty or missing-key render.
      expect(String(hint.props.children).length).toBeGreaterThan(5);
    }
  });
});

describe('plan step', () => {
  it.each([
    ['lose', 'onboarding.planKcalLose'],
    ['maintain', 'onboarding.planKcalMaintain'],
    ['gain', 'onboarding.planKcalGain'],
  ] as const)('says what the calorie number is for when the goal is %s', async (goal, key) => {
    const screen = await render(<Onboarding />);
    await toPlan(screen, goal);
    const line = screen.getByTestId('onboarding-plan-kcal-line');
    const text = String(([] as unknown[]).concat(line.props.children).join(''));
    // Either the merged copy or (before the string merge) the key itself —
    // what matters is that the line follows the goal the user picked.
    const expected = (en as Record<string, string>)[key];
    if (expected) expect(text).toContain(expected.split('{n}')[0].trim());
    else expect(text).toBe(key);
  });

  it('says why protein is there', async () => {
    const screen = await render(<Onboarding />);
    await toPlan(screen, 'lose');
    expect(screen.getByTestId('onboarding-plan-protein-why')).toBeTruthy();
  });

  it('drops the calorie line once the user types their own number', async () => {
    const screen = await render(<Onboarding />);
    await toPlan(screen, 'lose');
    await fireEvent.press(screen.getByTestId('onboarding-kcal'));
    await fireEvent.changeText(screen.getByTestId('onboarding-kcal-input'), '2100');
    expect(screen.queryByTestId('onboarding-plan-kcal-line')).toBeNull();
  });

  it('a redo keeps its own basis line and shows no first-run calorie line', async () => {
    mockProfile = { profileCompleted: true, goalDirection: 'maintain' };
    const screen = await render(<Onboarding />);
    await fireEvent.press(screen.getByTestId('onboarding-goal-maintain'));
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.changeText(screen.getByTestId('onboarding-weight'), '180');
    await fireEvent.press(screen.getByTestId('onboarding-next'));
    await fireEvent.press(screen.getByTestId('onboarding-skip-body'));
    expect(screen.getByTestId('onboarding-plan-basis')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-plan-kcal-line')).toBeNull();
  });
});
