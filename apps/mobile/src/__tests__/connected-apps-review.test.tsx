/**
 * Connected apps — the Body review's fixes (2026-10-04): bug 9 (one busy flag
 * labelled every button "Opening Oura…"), bug 10 (a failed Health sync was a
 * haptic and nothing else), bug 14 (no last-sync evidence for Health), A6 (an
 * unlabelled Switch) and U11 (a denied permission with no way forward).
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

const mockSyncNow = jest.fn();
const mockConnect = jest.fn();
let mockHealth: Record<string, unknown> = {};
const mockOpenPermissions = jest.fn();
jest.mock('@/lib/health-sync', () => ({
  useHealthSync: () => mockHealth,
  openHealthPermissions: () => mockOpenPermissions(),
}));

let mockOura: Record<string, unknown> = {};
jest.mock('@/lib/oura', () => ({ useOura: () => mockOura }));

import ConnectedAppsScreen from '@/app/connected-apps';

beforeEach(() => {
  jest.clearAllMocks();
  mockHealth = {
    available: true,
    connected: true,
    syncing: false,
    needsReauth: false,
    lastSync: null,
    connect: mockConnect,
    disconnect: jest.fn(),
    syncNow: mockSyncNow,
  };
  mockOura = {
    status: { connected: true, lastSyncedAt: null, lastRecordCount: null },
    ready: true,
    busy: false,
    action: null,
    result: null,
    daily: null,
    failed: false,
    needsScopeUpgrade: false,
    connect: jest.fn(),
    disconnect: jest.fn(),
    syncNow: jest.fn(),
  };
});

const textOf = (el: { props: { children?: unknown } }): string => {
  const c = el.props.children;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (typeof x === 'string' ? x : textOf(x as never))).join('');
  if (c && typeof c === 'object' && 'props' in (c as object)) return textOf(c as never);
  return '';
};

it('a running SYNC says "Syncing…" on Sync — and Disconnect keeps its own label (bug 9)', async () => {
  mockOura = { ...mockOura, busy: true, action: 'sync' };
  const ui = await render(<ConnectedAppsScreen />);
  expect(textOf(ui.getByTestId('oura-sync-now'))).toBe('Syncing…');
  expect(textOf(ui.getByTestId('oura-toggle'))).toBe('Disconnect');
});

it('a running disconnect says "Disconnecting…", not "Opening Oura…" (C1)', async () => {
  mockOura = { ...mockOura, busy: true, action: 'disconnect' };
  const ui = await render(<ConnectedAppsScreen />);
  expect(textOf(ui.getByTestId('oura-toggle'))).toBe('Disconnecting…');
});

it('a failed Health sync says so (bug 10)', async () => {
  mockSyncNow.mockRejectedValueOnce(new Error('HealthKit Code=6'));
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent.press(ui.getByTestId('health-sync-now'));
  await waitFor(() => expect(ui.getByTestId('health-msg').props.children).toBe("Couldn't sync with Apple Health. Try again."));
});

it('shows when Health last synced and what came back (bug 14)', async () => {
  mockHealth = { ...mockHealth, lastSync: { atMs: new Date(2026, 9, 4, 9, 41).getTime(), count: 3 } };
  const ui = await render(<ConnectedAppsScreen />);
  expect(ui.getByText(/^Last synced Oct 4/)).toBeTruthy();
  expect(ui.getByText('3 updated on the last sync.')).toBeTruthy();
});

it('the Health switch says what it switches (A6)', async () => {
  const ui = await render(<ConnectedAppsScreen />);
  expect(ui.getByTestId('health-toggle').props.accessibilityLabel).toBe('Sync with Apple Health');
});

it('a denied permission offers the way to fix it (U11)', async () => {
  mockConnect.mockResolvedValueOnce(false);
  mockHealth = { ...mockHealth, connected: false };
  const ui = await render(<ConnectedAppsScreen />);
  await fireEvent(ui.getByTestId('health-toggle'), 'valueChange', true);
  await waitFor(() => expect(ui.getByTestId('health-prime')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('health-prime-continue'));
  await waitFor(() => expect(ui.getByTestId('health-open-settings')).toBeTruthy());
  await fireEvent.press(ui.getByTestId('health-open-settings'));
  expect(mockOpenPermissions).toHaveBeenCalledTimes(1);
});
