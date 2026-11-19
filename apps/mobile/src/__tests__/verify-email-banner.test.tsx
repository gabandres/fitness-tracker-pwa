import React from 'react';
import { AppState, StyleSheet } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * The banner that replaced the verify-email wall (2026-11-19): a quiet row on
 * Today while the email is unverified, one focus stop, never shown signed out,
 * verified, or for a session only presumed from disk (#83).
 */

type Auth = { user: { uid: string } | null; emailVerified: boolean; sessionPresumed: boolean };
let mockAuth: Auth;
const mockReload = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ ...mockAuth, reloadUser: () => mockReload() }),
}));
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn(), back: jest.fn() }),
}));

import { VerifyEmailBanner } from '@/components/VerifyEmailBanner';

beforeEach(() => {
  mockAuth = { user: { uid: 'u1' }, emailVerified: false, sessionPresumed: false };
  mockReload.mockReset().mockResolvedValue(false);
  mockPush.mockReset();
});

it.each<[string, Partial<Auth>]>([
  ['signed out', { user: null }],
  ['verified', { emailVerified: true }],
  ['presumed session', { user: null, sessionPresumed: true }],
  ['presumed flag alongside a user', { sessionPresumed: true }],
])('renders nothing when %s', async (_name, patch) => {
  mockAuth = { ...mockAuth, ...patch };
  const screen = await render(<VerifyEmailBanner />);
  expect(screen.queryByTestId('verify-banner')).toBeNull();
  expect(mockReload).not.toHaveBeenCalled();
});

it('is one labelled button with a full tap height that opens the verify screen', async () => {
  const screen = await render(<VerifyEmailBanner />);
  const row = screen.getByTestId('verify-banner');
  expect(row.props.accessibilityRole).toBe('button');
  expect(row.props.accessibilityLabel).toBeTruthy();
  expect(row.props.accessibilityHint).toBeTruthy();
  const style = StyleSheet.flatten(row.props.style) as { minHeight?: number };
  expect(style.minHeight).toBeGreaterThanOrEqual(44);
  await fireEvent.press(row);
  expect(mockPush).toHaveBeenCalledWith('/verify-email');
});

it('re-checks on open and on every return to the foreground', async () => {
  const listeners: ((s: string) => void)[] = [];
  const spy = jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, cb) => {
    listeners.push(cb as (s: string) => void);
    return { remove: jest.fn() } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  await render(<VerifyEmailBanner />);
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1));
  await act(async () => listeners.forEach((l) => l('active')));
  expect(mockReload).toHaveBeenCalledTimes(2);
  spy.mockRestore();
});
