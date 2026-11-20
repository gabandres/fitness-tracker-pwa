import React from 'react';
import { Alert, Linking } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Settings writes that fail must SAY so (audit 2026-10-15, 09-22 items g + i).
 *
 * The steppers, pickers and switches `await`ed their profile write with no
 * catch: a rejection was an unhandled promise and the control simply did not
 * move, which reads exactly like a tap that worked. Sign-out's catch only
 * logged. And a failed account deletion always left the user signed in, even
 * when the failure was the session itself being dead.
 */

const mockSetTrainingSettings = jest.fn();
const mockSignOut = jest.fn();
const mockDeleteAccount = jest.fn();
const mockShowToast = jest.fn();
const mockSetRemindersEnabled = jest.fn();
let mockProfile: Record<string, unknown> = {};

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@example.com' },
    profile: mockProfile,
    signOut: mockSignOut,
    deleteAccount: mockDeleteAccount,
  }),
}));
jest.mock('@/lib/ledger', () => ({
  importLogs: jest.fn(),
  setCalorieFloor: jest.fn().mockRejectedValue({ code: 'permission-denied' }),
  setDayStartHour: jest.fn(),
  setPreferredLocale: jest.fn(),
  setProteinFloor: jest.fn(),
  setTrainingSettings: (...a: unknown[]) => mockSetTrainingSettings(...a),
  setUnitSystem: jest.fn().mockRejectedValue({ code: 'permission-denied' }),
  setWeeklyDigestOptIn: jest.fn(),
}));
jest.mock('@/components/Toast', () => ({
  ...jest.requireActual('@/components/Toast'),
  showToast: (...a: unknown[]) => mockShowToast(...a),
}));
jest.mock('@/components/ConfirmSheet', () => ({
  ConfirmHost: () => null,
  confirm: (o: { onConfirm: () => void }) => o.onConfirm(),
}));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));
jest.mock('@/hooks/useProgram', () => ({
  useProgram: () => ({ version: undefined, rows: [], switchTo: jest.fn(), busy: false }),
}));
jest.mock('@/hooks/useHasTemplates', () => ({ useHasTemplates: () => true }));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/lib/reminders', () => ({
  getReminderSettings: jest.fn().mockResolvedValue({ enabled: false, meals: undefined }),
  setMealReminders: jest.fn(),
  setRemindersEnabled: (...a: unknown[]) => mockSetRemindersEnabled(...a),
  syncReminders: jest.fn(),
}));
jest.mock('@/lib/subscription', () => ({
  PRO_ENABLED: false,
  useSubscription: () => ({ isPro: true, proPreview: false, setProPreview: jest.fn() }),
}));
jest.mock('@/lib/purchases', () => ({ isTipIapAvailable: () => false }));
jest.mock('@/lib/dataExport', () => ({ exportDataCsv: jest.fn() }));
jest.mock('@/lib/deleteAccount', () => ({ deleteAccountForever: jest.fn() }));
jest.mock('@/components/QuickAddCard', () => ({ QuickAddCard: () => null }));
jest.mock('@/components/WatchDiagnosticsCard', () => ({
  WatchDiagnosticsCard: () => null,
  watchDiagnosticsAvailable: false,
}));
jest.mock('@/components/SignInMethodsCard', () => ({ SignInMethodsCard: () => null }));
jest.mock('@/components/TipSheet', () => ({ TipSheet: () => null }));
jest.mock('@/components/OfflineBanner', () => ({ OfflineBanner: () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }) }));

import Settings from '@/app/settings';

const SAVE_FAILED = "Couldn't save that. Check your connection and try again.";

beforeEach(() => {
  mockSetTrainingSettings.mockReset().mockRejectedValue({ code: 'permission-denied' });
  mockSignOut.mockReset();
  mockDeleteAccount.mockReset();
  mockShowToast.mockClear();
  mockProfile = { profileCompleted: true };
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

async function renderSettings() {
  const ui = await render(<Settings />);
  await act(async () => {});
  return ui;
}

it('says so when a training write fails', async () => {
  const ui = await renderSettings();
  await fireEvent.press(ui.getByTestId('settings-phase-maintenance'));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(SAVE_FAILED));
});

it('puts the volume gate back to what is stored when its write fails', async () => {
  mockProfile = { profileCompleted: true, volumeGateLb: 185 };
  const ui = await renderSettings();
  await fireEvent.changeText(ui.getByTestId('settings-volume-gate'), '200');
  await fireEvent(ui.getByTestId('settings-volume-gate'), 'endEditing');
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith(SAVE_FAILED));
  expect(ui.getByTestId('settings-volume-gate')).toHaveProp('value', '185');
});

it('says so when sign-out fails, instead of only logging', async () => {
  mockSignOut.mockRejectedValue(new Error('boom'));
  const ui = await renderSettings();
  await fireEvent.press(ui.getByTestId('settings-signout'));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalledWith("Couldn't sign out. Try again."));
});

/** Press through both destructive Alerts. */
function confirmBothAlerts() {
  jest.spyOn(Alert, 'alert').mockImplementation((_title, _body, buttons) => {
    const destructive = buttons?.find((b) => b.style === 'destructive');
    destructive?.onPress?.();
  });
}

it('deletes through the auth layer and shows no error when it succeeds', async () => {
  confirmBothAlerts();
  mockDeleteAccount.mockResolvedValue('deleted');
  const ui = await renderSettings();
  await fireEvent.press(ui.getByTestId('settings-delete-account'));
  await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
  // Two confirm alerts, no failure alert.
  expect((Alert.alert as jest.Mock).mock.calls).toHaveLength(2);
});

it('shows the failure when the account is still intact', async () => {
  confirmBothAlerts();
  mockDeleteAccount.mockRejectedValue({ code: 'functions/internal' });
  const ui = await renderSettings();
  await fireEvent.press(ui.getByTestId('settings-delete-account'));
  await waitFor(() => expect((Alert.alert as jest.Mock).mock.calls).toHaveLength(3));
  expect((Alert.alert as jest.Mock).mock.calls[2][1]).toMatch(/couldn't delete your account/i);
});

// ── A50: a refused notification permission says so (2026-11-19) ──────────
it('says why the reminders switch fell back off, with a way to Settings', async () => {
  // `setRemindersEnabled(true)` answers false when the OS refused.
  mockSetRemindersEnabled.mockResolvedValue(false);
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
  const ui = await renderSettings();
  expect(ui.queryByTestId('reminder-denied')).toBeNull();
  await fireEvent(ui.getByTestId('reminder-toggle'), 'valueChange', true);
  await waitFor(() => expect(ui.getByTestId('reminder-denied')).toBeTruthy());
  expect(ui.getByText("Notifications are off for Ignia in your phone's settings.")).toBeTruthy();
  await fireEvent.press(ui.getByTestId('reminder-open-settings'));
  expect(open).toHaveBeenCalledTimes(1);
});

// ── Safety floors read with their units, grouped, and spoken in words ─────
it('the floor steppers show "1,500 kcal" / "120 g" and say them in words', async () => {
  mockProfile = { profileCompleted: true, calorieFloor: 1500, proteinFloor: 120 };
  const ui = await renderSettings();
  const kcal = ui.getByTestId('calorie-floor');
  expect(kcal).toHaveTextContent('1,500 kcal');
  expect(kcal.props.accessibilityLabel).toBe('1,500 calories');
  const protein = ui.getByTestId('protein-floor');
  expect(protein).toHaveTextContent('120 g');
  expect(protein.props.accessibilityLabel).toBe('120 grams of protein');
});
