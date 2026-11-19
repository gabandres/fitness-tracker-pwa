import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * /verify-email is a screen the user OPENS since 2026-11-19 (Today's banner, a
 * locked scan or coach), not the wall the root gate forced every unverified
 * signup onto. It needs a way back, and a successful check returns the user to
 * where they were instead of re-running the routing from scratch.
 */

const mockReload = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co', emailVerified: false },
    reloadUser: () => mockReload(),
    resendVerification: jest.fn().mockResolvedValue(undefined),
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
let mockCanGoBack = true;
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn(), canGoBack: () => mockCanGoBack }),
}));

import VerifyEmail from '@/app/verify-email';

beforeEach(() => {
  mockReload.mockReset().mockResolvedValue(false);
  mockBack.mockReset();
  mockReplace.mockReset();
  mockCanGoBack = true;
});

it('Close goes back to where the user came from', async () => {
  const screen = await render(<VerifyEmail />);
  const close = screen.getByTestId('verify-close');
  expect(close.props.accessibilityRole).toBe('button');
  expect(close.props.accessibilityLabel).toBeTruthy();
  await fireEvent.press(close);
  expect(mockBack).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
});

it('Close on a cold open with no history lands on Today', async () => {
  mockCanGoBack = false;
  const screen = await render(<VerifyEmail />);
  await fireEvent.press(screen.getByTestId('verify-close'));
  expect(mockReplace).toHaveBeenCalledWith('/(app)');
});

it('a successful check returns to where the user was, once', async () => {
  const screen = await render(<VerifyEmail />);
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(1)); // the open-time check
  expect(mockBack).not.toHaveBeenCalled();
  mockReload.mockResolvedValue(true);
  await fireEvent.press(screen.getByTestId('verify-check'));
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
  // A second success (the foreground re-check, say) does not navigate twice.
  await fireEvent.press(screen.getByTestId('verify-check'));
  await waitFor(() => expect(mockReload).toHaveBeenCalledTimes(3));
  expect(mockBack).toHaveBeenCalledTimes(1);
});

it('leaves straight away when opened already verified (a returning deep link)', async () => {
  mockReload.mockResolvedValue(true);
  await render(<VerifyEmail />);
  await waitFor(() => expect(mockBack).toHaveBeenCalledTimes(1));
});

describe('the root gate', () => {
  const layout = readFileSync(join(__dirname, '..', 'app', '_layout.tsx'), 'utf8');

  it('no longer forces anyone onto /verify-email', () => {
    expect(layout).not.toMatch(/replace\(\s*['"]\/verify-email['"]\s*\)/);
    // The routing decision is asked for every signed-in session, verified or not.
    expect(layout).not.toMatch(/sessionUid\s*&&\s*emailVerified/);
  });

  it('does not replace /verify-email away once the user has opened it', () => {
    expect(layout).toMatch(/!onWhatsNew && !onVerify\) router\.replace\('\/\(app\)'\)/);
  });
});
