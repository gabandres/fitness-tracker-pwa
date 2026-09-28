/**
 * Connected apps — the Health Connect / HealthKit rationale sheet (S18
 * "priming"). Flipping the switch on explains what is read and written and
 * where it goes BEFORE the OS prompt; Continue runs the connect, Not now
 * leaves everything as it was. A reconnect for wider scopes skips the sheet.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

const mockConnect = jest.fn().mockResolvedValue(true);
const mockDisconnect = jest.fn().mockResolvedValue(undefined);
let mockHealth = {
  available: true,
  connected: false,
  syncing: false,
  needsReauth: false,
  connect: mockConnect,
  disconnect: mockDisconnect,
  syncNow: jest.fn().mockResolvedValue(0),
};

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/health-sync', () => ({ useHealthSync: () => mockHealth }));
jest.mock('@/lib/oura', () => ({
  useOura: () => ({
    status: { connected: false },
    ready: true,
    busy: false,
    result: null,
    daily: null,
    failed: false,
    needsScopeUpgrade: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    syncNow: jest.fn(),
  }),
}));

import ConnectedAppsScreen from '@/app/(app)/connected-apps';

beforeEach(() => {
  jest.clearAllMocks();
  mockHealth = { ...mockHealth, connected: false, needsReauth: false };
});

it('shows the rationale before asking, and Continue runs the connect', async () => {
  const ui = await render(<ConnectedAppsScreen />);
  expect(ui.queryByTestId('health-prime')).toBeNull();
  await fireEvent(ui.getByTestId('health-toggle'), 'valueChange', true);
  await waitFor(() => expect(ui.getByTestId('health-prime')).toBeTruthy());
  expect(mockConnect).not.toHaveBeenCalled();

  const go = ui.getByTestId('health-prime-continue');
  expect(go.props.accessibilityRole).toBe('button');
  await fireEvent.press(go);
  await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
});

it('Not now asks nothing and changes nothing', async () => {
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent(ui.getByTestId('health-toggle'), 'valueChange', true);
  await waitFor(() => expect(ui.getByTestId('health-prime')).toBeTruthy());
  const notNow = ui.getByTestId('health-prime-not-now');
  expect(notNow.props.accessibilityRole).toBe('button');
  await fireEvent.press(notNow);
  expect(mockConnect).not.toHaveBeenCalled();
  expect(mockDisconnect).not.toHaveBeenCalled();
});

it('switching OFF disconnects without a sheet', async () => {
  mockHealth = { ...mockHealth, connected: true };
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent(ui.getByTestId('health-toggle'), 'valueChange', false);
  await waitFor(() => expect(mockDisconnect).toHaveBeenCalledTimes(1));
  expect(ui.queryByTestId('health-prime')).toBeNull();
});

it('a reconnect for wider scopes goes straight to the OS — the explanation was already given', async () => {
  mockHealth = { ...mockHealth, connected: true, needsReauth: true };
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent.press(ui.getByTestId('health-sync-now'));
  await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(1));
  expect(ui.queryByTestId('health-prime')).toBeNull();
});
