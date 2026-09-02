import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { Profile } from '@macrolog/core';

/**
 * The first-log step — retention lever 1 (`STATUS.md` §3, 2026-09-02).
 *
 * `config/retention` read that day: 19 of 30 signups never reached three
 * logs, and the ones who did logged less than once a day. The research is
 * one-sided — a meaningful action in session one is worth 2–3× at D30 — so
 * onboarding now ends by offering the first log before Today is ever seen
 * empty.
 *
 * Pinned here: the step is LAST (after reminders, because its CTA leaves
 * onboarding), it never appears on a redo, "Log my last meal" lands on Today
 * with the add sheet open AND holds the guided tour so the tour cannot push
 * itself over the sheet, and "I'll do it later" lands on plain Today with the
 * tour untouched.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
const mockHoldTour = jest.fn();

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
jest.mock('@/lib/reminders', () => ({ setRemindersEnabled: jest.fn().mockResolvedValue(true) }));
jest.mock('@/lib/tour', () => ({ holdTour: (...args: unknown[]) => mockHoldTour(...args) }));
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
  mockHoldTour.mockClear();
});

type Screen = Awaited<ReturnType<typeof render>>;

/** welcome → goal → weight → goalWeight → body (skipped) → plan → save → reminders (not now). */
async function walkToFirstLog(screen: Screen) {
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
  await fireEvent.press(getByTestId('onboarding-reminders-skip'));
}

describe('onboarding ends by offering the first log', () => {
  it('is the last step, reached from the reminders step, and does not leave yet', async () => {
    const screen = await render(<Onboarding />);
    await walkToFirstLog(screen);
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('onboarding-first-log')).toBeTruthy();
    expect(screen.queryByTestId('onboarding-back')).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
    expect(mockHoldTour).not.toHaveBeenCalled();
  });

  it('"Log my last meal" lands on Today with the add sheet open and the tour held', async () => {
    const screen = await render(<Onboarding />);
    await walkToFirstLog(screen);
    await fireEvent.press(screen.getByTestId('onboarding-first-log-cta'));
    expect(mockHoldTour).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    const arg = mockReplace.mock.calls[0][0] as { pathname: string; params: { openAdd: string } };
    expect(arg.pathname).toBe('/(app)');
    expect(arg.params.openAdd).toMatch(/^\d+$/);
  });

  it('"I\'ll do it later" lands on plain Today and leaves the tour alone', async () => {
    const screen = await render(<Onboarding />);
    await walkToFirstLog(screen);
    await fireEvent.press(screen.getByTestId('onboarding-first-log-later'));
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
    expect(mockHoldTour).not.toHaveBeenCalled();
  });

  it('never appears on a redo — an existing user editing goals returns to Settings', async () => {
    mockProfile = { profileCompleted: true, goal: 'lose', weightLbs: 180, targetWeightLbs: 165 } as Partial<Profile>;
    const screen = await render(<Onboarding />);
    // A redo starts on the goal step; walk it to the plan and save.
    const { getByTestId, queryByTestId } = screen;
    await fireEvent.press(getByTestId('onboarding-goal-lose'));
    await fireEvent.press(getByTestId('onboarding-next'));
    await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
    await fireEvent.press(getByTestId('onboarding-next'));
    await fireEvent.changeText(getByTestId('onboarding-target-weight'), '165');
    await fireEvent.press(getByTestId('onboarding-next'));
    if (queryByTestId('onboarding-skip-body')) await fireEvent.press(getByTestId('onboarding-skip-body'));
    await fireEvent.press(getByTestId('onboarding-save'));
    expect(mockReplace).toHaveBeenCalledWith('/settings');
    expect(queryByTestId('onboarding-first-log')).toBeNull();
    expect(mockHoldTour).not.toHaveBeenCalled();
  });
});
