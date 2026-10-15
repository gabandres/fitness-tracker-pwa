import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';
import type { PendingLink } from '@/lib/link-error';

/**
 * Federated sign-in failures (audit 2026-10-15, items 5 + 8a + 8d).
 *
 *  - An `account-exists-with-different-credential` was suppressed whenever its
 *    CODE matched, on the assumption that the link prompt was up. Without an
 *    email or a credential on the error nothing was parked, no prompt rendered,
 *    and the tap ended in silence. Only a collision the auth layer actually
 *    parked (`linkCaptured`) may be silenced.
 *  - The prompt always said "sign in with your password below" — a dead end for
 *    an account that only ever had Google.
 *  - Cancelling Apple said "Google sign-in was cancelled."
 *  - The Google button was drawn disabled when unavailable but still pressable.
 */

const mockGoogle = jest.fn();
const mockApple = jest.fn();
let mockPendingLink: PendingLink | null = null;
let mockGoogleAvailable = true;

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    signIn: jest.fn(),
    signUp: jest.fn(),
    resetPassword: jest.fn(),
    signInWithGoogle: (...a: unknown[]) => mockGoogle(...a),
    googleAvailable: mockGoogleAvailable,
    signInWithApple: (...a: unknown[]) => mockApple(...a),
    appleAvailable: true,
    signInWithMicrosoft: jest.fn(),
    microsoftAvailable: false,
    pendingLink: mockPendingLink,
    clearPendingLink: jest.fn(),
  }),
}));
jest.mock('expo-apple-authentication', () => {
  const React = require('react');
  const { Pressable } = require('react-native');
  return {
    AppleAuthenticationButton: ({ onPress }: { onPress: () => void }) =>
      React.createElement(Pressable, { testID: 'signin-apple', onPress }),
    AppleAuthenticationButtonType: { SIGN_IN: 0, SIGN_UP: 2 },
    AppleAuthenticationButtonStyle: { WHITE: 0, BLACK: 2 },
  };
});
jest.mock('@/components/WelcomeIntro', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    WelcomeIntro: ({ onContinue }: { onContinue: (m: 'signin' | 'signup') => void }) =>
      React.createElement(
        Pressable,
        { testID: 'welcome-signin', onPress: () => onContinue('signin') },
        React.createElement(Text, null, 'sign in'),
      ),
  };
});
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import SignIn from '@/app/sign-in';

beforeEach(() => {
  mockGoogle.mockReset();
  mockApple.mockReset();
  mockPendingLink = null;
  mockGoogleAvailable = true;
});

async function openForm() {
  const screen = await render(<SignIn />);
  await fireEvent.press(screen.getByTestId('welcome-signin'));
  return screen;
}

it('shows the collision error when nothing was parked for linking', async () => {
  mockGoogle.mockRejectedValue({ code: 'auth/account-exists-with-different-credential' });
  const screen = await openForm();
  await fireEvent.press(screen.getByTestId('signin-google'));
  await waitFor(() =>
    expect(screen.getByTestId('signin-error')).toHaveTextContent(/already uses a different sign-in method/),
  );
});

it('stays quiet when the collision WAS parked — the prompt says what to do', async () => {
  mockGoogle.mockRejectedValue({ code: 'auth/account-exists-with-different-credential', linkCaptured: true });
  const screen = await openForm();
  await fireEvent.press(screen.getByTestId('signin-google'));
  await waitFor(() => expect(mockGoogle).toHaveBeenCalled());
  expect(screen.queryByTestId('signin-error')).toBeNull();
});

it.each([
  ['password', /password below/],
  ['google.com', /Continue with Google/],
  ['apple.com', /Sign in with Apple/],
  [null, /the way you first did/],
] as const)('words the link prompt for the owning method (%s)', async (existing, copy) => {
  mockPendingLink = { email: 'a@b.co', attemptedProvider: 'apple.com', existingProvider: existing };
  const screen = await openForm();
  expect(screen.getByTestId('signin-pending-link')).toHaveTextContent(copy);
});

it('names Apple when Apple sign-in is cancelled', async () => {
  mockApple.mockRejectedValue({ code: 'cancelled' });
  const screen = await openForm();
  await fireEvent.press(screen.getByTestId('signin-apple'));
  await waitFor(() => expect(screen.getByTestId('signin-error')).toHaveTextContent('Apple sign-in was cancelled.'));
});

it('still names Google when Google sign-in is cancelled', async () => {
  mockGoogle.mockRejectedValue({ code: 'cancelled' });
  const screen = await openForm();
  await fireEvent.press(screen.getByTestId('signin-google'));
  await waitFor(() => expect(screen.getByTestId('signin-error')).toHaveTextContent('Google sign-in was cancelled.'));
});

it('an unavailable Google button is actually disabled, not just drawn so', async () => {
  mockGoogleAvailable = false;
  const screen = await openForm();
  const btn = screen.getByTestId('signin-google');
  expect(btn).toBeDisabled();
  await fireEvent.press(btn);
  expect(mockGoogle).not.toHaveBeenCalled();
});
