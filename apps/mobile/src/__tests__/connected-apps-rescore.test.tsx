/**
 * Connected apps — the Body re-score (S20, 2026-10-04): Health leads the
 * screen (it is where weigh-ins come from, and Body's footer sends people
 * here), and disconnecting Oura asks first, because coming back means the
 * whole Oura sign-in again.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (o: unknown) => mockConfirm(o),
  ConfirmHost: () => null,
}));

const mockHealth = {
  available: true,
  connected: true,
  syncing: false,
  needsReauth: false,
  lastSync: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
  syncNow: jest.fn(),
};
jest.mock('@/lib/health-sync', () => ({
  useHealthSync: () => mockHealth,
  openHealthPermissions: jest.fn(),
}));

const mockDisconnect = jest.fn();
const mockOura = {
  status: { connected: true, lastSyncedAt: null, lastRecordCount: null },
  ready: true,
  busy: false,
  action: null,
  result: null,
  daily: null,
  failed: false,
  needsScopeUpgrade: false,
  connect: jest.fn(),
  disconnect: mockDisconnect,
  syncNow: jest.fn(),
};
jest.mock('@/lib/oura', () => ({ useOura: () => mockOura }));

import ConnectedAppsScreen from '@/app/connected-apps';

beforeEach(() => {
  mockConfirm.mockClear();
  mockDisconnect.mockClear();
});

it('Health is the first provider card', async () => {
  const ui = await render(<ConnectedAppsScreen />);
  // Render order is tree order: the first card in the JSON is the first on screen.
  const tree = JSON.stringify(ui.toJSON());
  const health = tree.indexOf('"provider-health"');
  const oura = tree.indexOf('"provider-oura"');
  expect(health).toBeGreaterThan(-1);
  expect(oura).toBeGreaterThan(health);
});

it('Disconnect asks first and says reconnecting means signing in again', async () => {
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent.press(ui.getByTestId('oura-toggle'));
  expect(mockDisconnect).not.toHaveBeenCalled();
  expect(mockConfirm).toHaveBeenCalledTimes(1);
  const opts = mockConfirm.mock.calls[0][0] as { title: string; body: string; confirmText: string; destructive: boolean; onConfirm: () => void };
  expect(opts.title).toBe('Disconnect Oura?');
  expect(opts.body).toContain('signing in to Oura again');
  expect(opts.confirmText).toBe('Disconnect');
  expect(opts.destructive).toBe(true);
  opts.onConfirm();
  expect(mockDisconnect).toHaveBeenCalledTimes(1);
});
