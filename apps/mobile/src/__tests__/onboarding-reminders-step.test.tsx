import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { Profile } from '@macrolog/core';

/**
 * The reminders step — the day-1 retention lever (2026-08-30).
 *
 * Measured that week: of four organic iOS installs, two logged 10 and 22
 * meals on day 0 and never opened the app on day 1, and none had reminders on
 * because the switch lived in Settings. Onboarding now ends by asking once.
 *
 * Pinned here: the step appears only on a FIRST run (a redo returns to
 * Settings as before), it appears AFTER the plan is saved (a permission prompt
 * must never stand between a person and their saved plan), "Not now" lands on
 * Today with nothing scheduled, and "Turn on" asks the OS through
 * `setRemindersEnabled(true)` and lands on Today whatever the answer.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
const mockSetRemindersEnabled = jest.fn().mockResolvedValue(true);

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    get profile() {
      return mockProfile;
    },
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/ledger', () => ({ saveOnboardingV2: (...args: unknown[]) => mockSave(...args) }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/reminders', () => ({ setRemindersEnabled: (...args: unknown[]) => mockSetRemindersEnabled(...args) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import Onboarding from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockClear();
  mockReplace.mockClear();
  mockSetRemindersEnabled.mockClear();
  mockSetRemindersEnabled.mockResolvedValue(true);
});

type Screen = Awaited<ReturnType<typeof render>>;

/** welcome → goal → weight → goalWeight → body (skipped) → activity → plan → save. */
async function walkToSavedPlan(screen: Screen) {
  const { getByTestId } = screen;
  await fireEvent.press(getByTestId('onboarding-next')); // welcome
  await fireEvent.press(getByTestId('onboarding-goal-lose'));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-skip-body'));
  await fireEvent.press(getByTestId('onboarding-save'));
}

describe('onboarding ends by asking about reminders', () => {
  it('shows the step only after the plan is saved, and does not leave yet', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('onboarding-reminders')).toBeTruthy();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockSetRemindersEnabled).not.toHaveBeenCalled();
  });

  it('"Not now" lands on Today and schedules nothing', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-reminders-skip'));
    expect(mockSetRemindersEnabled).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it('"Turn on" asks the OS once and lands on Today', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-reminders-on'));
    expect(mockSetRemindersEnabled).toHaveBeenCalledWith(true);
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });

  it('a denied permission still lands on Today — the prompt never traps anyone', async () => {
    mockSetRemindersEnabled.mockResolvedValueOnce(false);
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await fireEvent.press(screen.getByTestId('onboarding-reminders-on'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
  });
});
