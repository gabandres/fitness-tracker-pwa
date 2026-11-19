import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';
import * as RN from 'react-native';
import { BackHandler, Platform, StyleSheet } from 'react-native';

/**
 * The sign-in form's first-run standards fixes (OTA-1 sweep):
 * - every field has a visible label, hidden from screen readers because the
 *   field's own accessible name says the same words (WCAG 3.3.2);
 * - a blank first name is shown under the field, as well as by the button;
 * - the name row stacks at accessibility text sizes;
 * - an unclassified failure's raw code stays out of the visible message;
 * - Android back on the form returns to the intro instead of leaving the app.
 */

const mockSignIn = jest.fn();

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
  pendingLink: null,
  clearPendingLink: jest.fn(),
};

jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuthValue }));
// The real intro reveals its actions only after a layout-measured animation
// gate that never opens under the test renderer (see sign-in-error-slot).
jest.mock('@/components/WelcomeIntro', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    WelcomeIntro: ({ onContinue }: { onContinue: (m: 'signin' | 'signup') => void }) =>
      React.createElement(
        Pressable,
        { testID: 'welcome-signup', onPress: () => onContinue('signup') },
        React.createElement(Text, null, 'sign up'),
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
const hidden = { includeHiddenElements: true };

async function openSignUp(screen: Screen) {
  await fireEvent.press(screen.getByTestId('welcome-signup'));
}

async function setFontScale(fontScale: number) {
  const window = { width: 390, height: 844, scale: 3, fontScale };
  await act(async () => {
    RN.Dimensions.set({ window, screen: window });
  });
}

const realOS = Platform.OS;
afterEach(async () => {
  Platform.OS = realOS;
  mockSignIn.mockReset();
  await setFontScale(1);
});

it('labels every field visibly, without a second focus stop', async () => {
  const screen = await render(<SignIn />);
  await openSignUp(screen);

  for (const id of ['firstName', 'lastName', 'email', 'password']) {
    const field = screen.getByTestId(id);
    const name = field.props.accessibilityLabel as string;
    expect(name).toBeTruthy();
    // The visible label carries the field's accessible name…
    const label = screen.getByText(name, hidden);
    // …and is hidden from screen readers, so the pair is one stop.
    expect(label.props.importantForAccessibility).toBe('no');
    expect(label.props.accessibilityElementsHidden).toBe(true);
  }
});

it('shows a blank first name under the field as well as by the button', async () => {
  const screen = await render(<SignIn />);
  await openSignUp(screen);

  await fireEvent.press(screen.getByTestId('signin-submit'));

  expect(screen.getByTestId('firstName-error')).toBeTruthy();
  expect(screen.getByTestId('signin-error')).toBeTruthy();

  await fireEvent.changeText(screen.getByTestId('firstName'), 'Ana');
  expect(screen.queryByTestId('firstName-error')).toBeNull();
});

it('stacks the name row at accessibility text sizes', async () => {
  const screen = await render(<SignIn />);
  await openSignUp(screen);
  expect(StyleSheet.flatten(screen.getByTestId('name-row').props.style).flexDirection).toBe('row');

  await setFontScale(2);
  expect(StyleSheet.flatten(screen.getByTestId('name-row').props.style).flexDirection).toBe('column');
});

it('keeps the raw error code out of the visible message', async () => {
  mockSignIn.mockRejectedValue({ code: 'auth/something-odd', detail: 'NATIVE_CODE_17' });
  const screen = await render(<SignIn />);
  await openSignUp(screen);
  await fireEvent.press(screen.getByTestId('switch-signin'));

  await fireEvent.changeText(screen.getByTestId('email'), 'a@b.co');
  await fireEvent.changeText(screen.getByTestId('password'), 'Whatever99');
  await fireEvent.press(screen.getByTestId('signin-submit'));

  await waitFor(() => expect(screen.getByTestId('signin-error')).toBeTruthy());
  expect(screen.getByTestId('signin-error')).not.toHaveTextContent(/NATIVE_CODE_17/);
});

it('Android back on the form returns to the intro and keeps what was typed', async () => {
  Platform.OS = 'android';
  const add = jest.spyOn(BackHandler, 'addEventListener');
  const screen = await render(<SignIn />);
  // Nothing is registered on the intro: there, back leaves the app.
  expect(add).not.toHaveBeenCalled();

  await openSignUp(screen);
  await fireEvent.changeText(screen.getByTestId('email'), 'kept@b.co');
  expect(add).toHaveBeenCalledWith('hardwareBackPress', expect.any(Function));
  const handler = add.mock.calls[add.mock.calls.length - 1][1] as () => boolean;

  let consumed = false;
  await act(async () => {
    consumed = handler();
  });
  expect(consumed).toBe(true);
  expect(screen.getByTestId('welcome-signup')).toBeTruthy();
  expect(screen.queryByTestId('email')).toBeNull();

  await openSignUp(screen);
  expect(screen.getByTestId('email').props.value).toBe('kept@b.co');
  add.mockRestore();
});
