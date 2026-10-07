import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Settings → Training (progression engine, 2026-10-07): the diet phase, the
 * auto-apply switch and the volume gate, each written through
 * `setTrainingSettings`.
 *
 * What is pinned: an untouched profile reads as cut / auto-apply OFF / no gate
 * (the defaults the engine assumes for absent fields); each control writes only
 * its own key; the gate is typed in the user's unit and stored in pounds,
 * empty clears it with `null`, and an out-of-band number is refused on screen
 * rather than sent to a rule that would reject it.
 */

const mockSetTrainingSettings = jest.fn().mockResolvedValue(undefined);
let mockProfile: Record<string, unknown> = {};

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1', email: 'a@example.com' }, profile: mockProfile, signOut: jest.fn() }),
}));
jest.mock('@/lib/ledger', () => ({
  importLogs: jest.fn(),
  setCalorieFloor: jest.fn(),
  setDayStartHour: jest.fn(),
  setPreferredLocale: jest.fn(),
  setProteinFloor: jest.fn(),
  setTrainingSettings: (...a: unknown[]) => mockSetTrainingSettings(...a),
  setUnitSystem: jest.fn(),
  setWeeklyDigestOptIn: jest.fn(),
}));
jest.mock('@/hooks/useDailyTargets', () => ({ useDailyTargets: () => ({ loaded: false, error: null }) }));
jest.mock('@/lib/connectivity', () => ({ useIsOffline: () => false, isOffline: () => false }));
jest.mock('@/lib/reminders', () => ({
  getReminderSettings: jest.fn().mockResolvedValue({ enabled: false, meals: undefined }),
  setMealReminders: jest.fn(),
  setRemindersEnabled: jest.fn(),
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

beforeEach(() => {
  mockSetTrainingSettings.mockClear();
  mockProfile = { profileCompleted: true };
});

async function renderSettings() {
  const ui = await render(<Settings />);
  // Let the reminder read settle so its state update lands inside act.
  await act(async () => {});
  return ui;
}

it('reads an untouched profile as cut, auto-apply off and no gate', async () => {
  const ui = await renderSettings();
  expect(ui.getByTestId('settings-phase-cut')).toBeSelected();
  expect(ui.getByTestId('settings-auto-apply')).toHaveProp('value', false);
  expect(ui.getByTestId('settings-volume-gate')).toHaveProp('value', '');
});

it('writes the phase, and only the phase', async () => {
  const ui = await renderSettings();
  await fireEvent.press(ui.getByTestId('settings-phase-maintenance'));
  await waitFor(() => expect(mockSetTrainingSettings).toHaveBeenCalledWith('u1', { trainingPhase: 'maintenance' }));
});

it('turns auto-apply on', async () => {
  const ui = await renderSettings();
  await fireEvent(ui.getByTestId('settings-auto-apply'), 'valueChange', true);
  await waitFor(() => expect(mockSetTrainingSettings).toHaveBeenCalledWith('u1', { autoApplyProgression: true }));
});

it('stores a metric gate in pounds', async () => {
  mockProfile = { profileCompleted: true, unitSystem: 'metric' };
  const ui = await renderSettings();
  await fireEvent.changeText(ui.getByTestId('settings-volume-gate'), '84');
  await fireEvent(ui.getByTestId('settings-volume-gate'), 'endEditing');
  await waitFor(() => expect(mockSetTrainingSettings).toHaveBeenCalled());
  const [, patch] = mockSetTrainingSettings.mock.calls[0];
  expect(patch.volumeGateLb).toBeCloseTo(185.2, 1);
});

it('clears a gate with null when the field is emptied', async () => {
  mockProfile = { profileCompleted: true, volumeGateLb: 185 };
  const ui = await renderSettings();
  expect(ui.getByTestId('settings-volume-gate')).toHaveProp('value', '185');
  await fireEvent.changeText(ui.getByTestId('settings-volume-gate'), '');
  await fireEvent(ui.getByTestId('settings-volume-gate'), 'endEditing');
  await waitFor(() => expect(mockSetTrainingSettings).toHaveBeenCalledWith('u1', { volumeGateLb: null }));
});

it('refuses a gate outside the band on screen, and writes nothing', async () => {
  const ui = await renderSettings();
  await fireEvent.changeText(ui.getByTestId('settings-volume-gate'), '20');
  await fireEvent(ui.getByTestId('settings-volume-gate'), 'endEditing');
  expect(ui.getByTestId('settings-volume-gate-error')).toHaveTextContent('Enter a weight from 50 to 1000 lb.');
  expect(mockSetTrainingSettings).not.toHaveBeenCalled();
});

it('writes nothing when the gate text is unchanged', async () => {
  mockProfile = { profileCompleted: true, volumeGateLb: 185 };
  const ui = await renderSettings();
  await fireEvent(ui.getByTestId('settings-volume-gate'), 'endEditing');
  expect(mockSetTrainingSettings).not.toHaveBeenCalled();
});
