import { StyleSheet } from 'react-native';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { palettes } from '@/theme';
import { en } from '@/i18n/en';

/**
 * First-run UX review S21 (2026-10-06), sign-in + verify-email half.
 *
 *  #4 Sign in / Sign up is a tab pair, the icon/text-only controls are buttons.
 *  #6 Provider buttons come BEFORE the email form in both modes.
 *  #7 Sign-up asks for a NEW password (autofill), sign-in for the saved one.
 *  #8 Field borders are `lineStrong`, not the ~1.2:1 `line`.
 *  #9 verify-email scrolls, so its buttons survive the largest text sizes.
 */

const mockAuthValue = {
  signIn: jest.fn(),
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
  user: { uid: 'u1', email: 'a@b.co', emailVerified: false },
  reloadUser: jest.fn().mockResolvedValue(false),
  resendVerification: jest.fn().mockResolvedValue(undefined),
  signOut: jest.fn().mockResolvedValue(undefined),
};

jest.mock('@/lib/auth', () => ({ useAuth: () => mockAuthValue }));
// Same stub as sign-in-error-slot.test: the real intro's actions sit behind a
// layout-measured animation gate the test renderer never opens.
jest.mock('@/components/WelcomeIntro', () => {
  const React = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    WelcomeIntro: ({ onContinue }: { onContinue: (m: 'signin' | 'signup') => void }) =>
      React.createElement(
        React.Fragment,
        null,
        React.createElement(Pressable, { testID: 'welcome-signin', onPress: () => onContinue('signin') }, React.createElement(Text, null, 'in')),
        React.createElement(Pressable, { testID: 'welcome-cta', onPress: () => onContinue('signup') }, React.createElement(Text, null, 'up')),
      ),
  };
});
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

import SignIn from '@/app/sign-in';
import VerifyEmail from '@/app/verify-email';

type Screen = Awaited<ReturnType<typeof render>>;

type Node = { type: string; props: Record<string, unknown>; children: (Node | string)[] | null };

/** Every host node, depth-first — the tree's order is the reading and focus
 *  order, which is what "above the form" means to a screen reader. */
function hostNodes(screen: Screen): Node[] {
  const out: Node[] = [];
  const walk = (n: Node | Node[] | string | null) => {
    if (n == null || typeof n === 'string') return;
    if (Array.isArray(n)) return n.forEach(walk);
    out.push(n);
    (n.children ?? []).forEach(walk);
  };
  walk(screen.toJSON() as unknown as Node);
  return out;
}

function order(screen: Screen, ids: string[]): number[] {
  const seen = hostNodes(screen).map((n) => n.props.testID).filter((id): id is string => typeof id === 'string');
  return ids.map((id) => seen.indexOf(id));
}

describe('sign-in', () => {
  it('Sign in / Sign up are tabs in a tablist, with selected state and a full tap height', async () => {
    const screen = await render(<SignIn />);
    await fireEvent.press(screen.getByTestId('welcome-signin'));
    const inTab = screen.getByTestId('switch-signin');
    const upTab = screen.getByTestId('switch-signup');
    expect(inTab.props.accessibilityRole).toBe('tab');
    expect(inTab.props.accessibilityState).toEqual({ selected: true });
    expect(upTab.props.accessibilityState).toEqual({ selected: false });
    expect(hostNodes(screen).some((n) => n.props.accessibilityRole === 'tablist')).toBe(true);
    const h = (StyleSheet.flatten(inTab.props.style) as { minHeight?: number }).minHeight ?? 0;
    expect(h).toBeGreaterThanOrEqual(44);

    await fireEvent.press(upTab);
    expect(screen.getByTestId('switch-signup').props.accessibilityState).toEqual({ selected: true });
  });

  it('the eye and Forgot password are labelled buttons', async () => {
    const screen = await render(<SignIn />);
    await fireEvent.press(screen.getByTestId('welcome-signin'));
    const eye = screen.getByTestId('toggle-password');
    expect(eye.props.accessibilityRole).toBe('button');
    expect(eye.props.accessibilityLabel).toBe('Show password');
    expect(screen.getByTestId('signin-forgot').props.accessibilityRole).toBe('button');
  });

  it.each(['welcome-signin', 'welcome-cta'])('providers come before the email form (%s)', async (entry) => {
    const screen = await render(<SignIn />);
    await fireEvent.press(screen.getByTestId(entry));
    const [google, email, submit] = order(screen, ['signin-google', 'email', 'signin-submit']);
    expect(google).toBeGreaterThanOrEqual(0);
    expect(google).toBeLessThan(email);
    expect(email).toBeLessThan(submit);
  });

  it('autofill: sign-in asks for the saved password, sign-up for a new one', async () => {
    const screen = await render(<SignIn />);
    await fireEvent.press(screen.getByTestId('welcome-signin'));
    expect(screen.getByTestId('email').props).toMatchObject({ textContentType: 'username', autoComplete: 'email' });
    expect(screen.getByTestId('password').props).toMatchObject({ textContentType: 'password', autoComplete: 'current-password' });

    await fireEvent.press(screen.getByTestId('switch-signup'));
    expect(screen.getByTestId('password').props).toMatchObject({ textContentType: 'newPassword', autoComplete: 'new-password' });
    expect(screen.getByTestId('password').props.passwordRules).toMatch(/minlength: 10/);
    expect(screen.getByTestId('firstName').props.autoComplete).toBe('given-name');
  });

  it('text fields are bordered in lineStrong (≥3:1 on inputBg in both palettes)', async () => {
    const screen = await render(<SignIn />);
    await fireEvent.press(screen.getByTestId('welcome-signin'));
    const border = (StyleSheet.flatten(screen.getByTestId('email').props.style) as { borderColor?: string }).borderColor;
    expect([palettes.light.colors.lineStrong, palettes.dark.colors.lineStrong]).toContain(border);
  });
});

describe('verify-email', () => {
  it('scrolls, titles itself as a header, and its controls are buttons', async () => {
    const screen = await render(<VerifyEmail />);
    expect(hostNodes(screen).some((n) => n.type === 'RCTScrollView')).toBe(true);
    expect(screen.getByText(en['verify.title']).props.accessibilityRole).toBe('header');
    for (const id of ['verify-check', 'verify-resend', 'verify-signout']) {
      expect(screen.getByTestId(id).props.accessibilityRole).toBe('button');
    }
  });
});
