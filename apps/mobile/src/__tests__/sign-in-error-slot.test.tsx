import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';

/**
 * The sign-in error line must be its own slot, not the `else` of the
 * account-collision prompt.
 *
 * As a ternary, ONE collision silenced the error line for the rest of the
 * session. The user tapped Continue with Google, the email turned out to be a
 * password account, `capturePendingLink` parked the credential and the prompt
 * appeared — and from then on every `setError` rendered nothing. Following the
 * prompt and typing the WRONG password changed nothing on screen; so did a
 * blank name on Sign up, which made the button look inert. `clearPendingLink`
 * was exported and had no screen caller at all. HIGH, 2026-09-22 review.
 *
 * Note what is deliberately NOT done here: a failed attempt does not clear the
 * pending credential. It is the thing being linked — dropping it on a typo
 * would cost the user the link they are in the middle of completing.
 */

const mockSignIn = jest.fn();
const mockClearPendingLink = jest.fn();

const mockAuthValue = {
  signIn: (...a: unknown[]) => mockSignIn(...a),
  signUp: jest.fn(),
  resetPassword: jest.fn(),
  signInWithGoogle: jest.fn(),
  googleAvailable: true,
  signInWithApple: jest.fn(),
  appleAvailable: false,
  signInWithMicrosoft: jest.fn(),
  microsoftAvailable: false,
  pendingLink: { email: 'a@b.co', provider: 'google.com' },
  clearPendingLink: mockClearPendingLink,
};

jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuthValue }));
// The real intro reveals its actions only after a layout-measured animation
// gate, which never opens under the test renderer. Stubbed to the one thing
// this test needs from it: the route into the sign-in form.
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

type Screen = Awaited<ReturnType<typeof render>>;

/** The screen opens on the marketing intro; Sign in reveals the form. */
async function openForm(screen: Screen) {
  await fireEvent.press(screen.getByTestId('welcome-signin'));
}

beforeEach(() => {
  mockSignIn.mockReset();
  mockClearPendingLink.mockReset();
});

it('shows a failed sign-in even while the link prompt is up', async () => {
  mockSignIn.mockRejectedValue({ code: 'auth/invalid-credential' });
  const screen = await render(<SignIn />);
  await openForm(screen);

  // The prompt is up — this is the state that used to swallow everything.
  expect(screen.getByTestId('signin-pending-link')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('email'), 'a@b.co');
  await fireEvent.changeText(screen.getByTestId('password'), 'WrongPass99');
  await fireEvent.press(screen.getByTestId('signin-submit'));

  await waitFor(() => expect(screen.getByTestId('signin-error')).toBeTruthy());
  // Both, not one or the other: the prompt still tells them what to do.
  expect(screen.getByTestId('signin-pending-link')).toBeTruthy();
});

it('keeps the parked credential across a failed attempt', async () => {
  mockSignIn.mockRejectedValue({ code: 'auth/invalid-credential' });
  const screen = await render(<SignIn />);
  await openForm(screen);

  await fireEvent.changeText(screen.getByTestId('email'), 'a@b.co');
  await fireEvent.changeText(screen.getByTestId('password'), 'WrongPass99');
  await fireEvent.press(screen.getByTestId('signin-submit'));

  await waitFor(() => expect(screen.getByTestId('signin-error')).toBeTruthy());
  expect(mockClearPendingLink).not.toHaveBeenCalled();
});

it('drops the prompt when the user switches to Sign up', async () => {
  const screen = await render(<SignIn />);
  await openForm(screen);

  await fireEvent.press(screen.getByTestId('switch-signup'));

  expect(mockClearPendingLink).toHaveBeenCalled();
});
