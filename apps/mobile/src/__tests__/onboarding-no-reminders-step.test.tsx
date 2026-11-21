import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { Profile } from '@macrolog/core';
import { en } from '@/i18n/en';

/**
 * Plan → first log, with no reminders step in between (2026-11-19).
 *
 * Production data: 0 of 43 users turned reminders on, and onboarding asked for
 * the notification permission before the app had done anything for them. The
 * ask moved to a card on Today after the first logged food; onboarding goes
 * straight from the saved plan to the first-log offer. This file replaced the
 * reminders-step test (2026-08-30) that pinned the old order.
 *
 * Also pinned: a new account's tracker defaults are initialised once, right
 * after the first-run save and never on a redo, and a save failure (including
 * a permission-denied, now that email verification no longer blocks the
 * write) reads as the generic save error.
 */

let mockProfile: Partial<Profile> | null = null;
const mockSave = jest.fn().mockResolvedValue(undefined);
const mockReplace = jest.fn();
const mockSetRemindersEnabled = jest.fn().mockResolvedValue(true);
const mockInitTrackers = jest.fn().mockResolvedValue(undefined);

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
  saveOnboardingV2: (...args: unknown[]) => mockSave(...args),
  getLatestDailyWeight: async () => null,
  getRecentLogs: async () => [],
  getAllDailyWeights: async () => ({}),
  setUnitSystem: async () => undefined,
}));
jest.mock('@/lib/ledger-ops', () => ({ writeDailyMetric: async () => undefined }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/tracker-prefs', () => ({
  initTrackerPrefsForNewAccount: (...a: unknown[]) => mockInitTrackers(...a),
}));

// `onboarding.tsx` stamps `ageConfirmedAt` straight through the SDK after the
// save (see `stampAgeConfirmed` there). The real package is ESM jest cannot
// parse, and `@/lib/firebase` initialises an app on import — mock both.
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({
  doc: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  updateDoc: async () => undefined,
  serverTimestamp: () => ({ __serverTimestamp: true }),
}));
// Mocked only to prove onboarding never touches it any more.
jest.mock('@/lib/reminders', () => ({ setRemindersEnabled: (...args: unknown[]) => mockSetRemindersEnabled(...args) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: mockReplace, back: jest.fn() }),
  useLocalSearchParams: () => ({}),
}));

import Onboarding from '@/app/onboarding';

beforeEach(() => {
  mockProfile = { profileCompleted: false };
  mockSave.mockReset();
  mockSave.mockResolvedValue(undefined);
  mockReplace.mockClear();
  mockSetRemindersEnabled.mockClear();
  mockInitTrackers.mockClear();
});

type Screen = Awaited<ReturnType<typeof render>>;

/** goal → weight → body (skipped) → plan → save. */
async function walkToSavedPlan(screen: Screen, goal: 'lose' | 'maintain' = 'lose') {
  const { getByTestId } = screen;
  if (!mockProfile?.profileCompleted) await fireEvent.press(getByTestId('onboarding-age-attest'));
  await fireEvent.press(getByTestId(`onboarding-goal-${goal}`));
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.changeText(getByTestId('onboarding-weight'), '180');
  await fireEvent.press(getByTestId('onboarding-next'));
  await fireEvent.press(getByTestId('onboarding-skip-body'));
  await fireEvent.press(getByTestId('onboarding-save'));
}

describe('onboarding goes from the saved plan straight to the first log', () => {
  it('lands on the first-log step after the save, with no reminders ask', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    expect(mockSave).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('onboarding-first-log')).toBeTruthy());
    expect(screen.queryByTestId('onboarding-reminders')).toBeNull();
    expect(screen.queryByTestId('onboarding-reminders-on')).toBeNull();
    // Literal, not `en[...]`: the key is dead and may be deleted.
    expect(screen.queryByText(/nudge at meal times/i)).toBeNull();
    expect(mockSetRemindersEnabled).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('shows the first-log step as the LAST progress dot', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() => expect(screen.getByTestId('onboarding-first-log')).toBeTruthy());
    const dots = screen.getByTestId('onboarding-dots');
    // lose + skipped body: goal, weight, plan, firstLog.
    expect(dots.props.accessibilityValue).toEqual({ min: 1, max: 4, now: 4 });
  });

  it('the first-log step reads plainly and promises no reminder', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() => expect(screen.getByTestId('onboarding-first-log')).toBeTruthy());
    expect(screen.getByText(en['onboarding.firstLogCta'])).toBeTruthy();
    expect(screen.getByText(en['onboarding.firstLogLater'])).toBeTruthy();
    expect(screen.queryByText(/remind|notif/i)).toBeNull();
  });
});

describe('new-account tracker defaults', () => {
  it('are initialised once, with the uid, right after a first-run save', async () => {
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() => expect(screen.getByTestId('onboarding-first-log')).toBeTruthy());
    expect(mockInitTrackers).toHaveBeenCalledTimes(1);
    expect(mockInitTrackers).toHaveBeenCalledWith('u1');
  });

  it('a rejection from the init never blocks the flow', async () => {
    mockInitTrackers.mockRejectedValueOnce(new Error('storage'));
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() => expect(screen.getByTestId('onboarding-first-log')).toBeTruthy());
    expect(screen.queryByTestId('onboarding-error')).toBeNull();
  });

  it('are NOT initialised on a redo from Settings', async () => {
    mockProfile = { profileCompleted: true, goalDirection: 'maintain' };
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen, 'maintain');
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/settings'));
    expect(mockInitTrackers).not.toHaveBeenCalled();
  });

  it('are not initialised when the save fails', async () => {
    mockSave.mockRejectedValueOnce(new Error('offline'));
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() => expect(screen.getByTestId('onboarding-error')).toBeTruthy());
    expect(mockInitTrackers).not.toHaveBeenCalled();
  });
});

describe('save failure', () => {
  it('a permission-denied reads as the generic save error, not "verify your email"', async () => {
    mockSave.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const screen = await render(<Onboarding />);
    await walkToSavedPlan(screen);
    await waitFor(() =>
      expect(screen.getByTestId('onboarding-error')).toHaveTextContent(en['onboarding.saveErr']),
    );
    expect(screen.queryByText(/verify your email/i)).toBeNull();
  });
});
