import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { setSplashVisible } from '@/lib/splash-state';

/**
 * The first-launch moment (2026-09-02): a fresh install meets the welcome
 * intro, not a sign-in form.
 *
 * Pinned here, because none of it is visible to the device suite without a
 * throwaway account:
 *
 *  - the intro is what a signed-out sign-in screen shows FIRST;
 *  - while the boot splash still covers the screen the intro holds only the
 *    flame and wordmark (pixel-continuous with `BrandLoader`) — the copy and
 *    the actions mount when the overlay lifts, so their entrance plays in
 *    front of the user rather than under the loader;
 *  - the CTA lands the form in sign-UP mode, the link in sign-in mode.
 *
 * The travel/scale/bloom choreography is Reanimated shared values driven by
 * window measurements that no test renderer performs; a device recording is
 * the only real check of that, and `AGENTS.md` records it.
 */

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
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
  }),
}));

import SignIn from '@/app/sign-in';

beforeEach(() => setSplashVisible(true));
afterEach(() => setSplashVisible(true));

describe('the welcome intro', () => {
  it('is the first thing a signed-out screen shows, and holds its copy while the splash is up', async () => {
    const { getByTestId, queryByTestId } = await render(<SignIn />);
    expect(getByTestId('welcome-intro')).toBeTruthy();
    // Continuity with the loader: the flame and the wordmark are already there.
    expect(getByTestId('flame')).toBeTruthy();
    // The rest waits for the overlay to lift.
    expect(queryByTestId('welcome-cta')).toBeNull();
    expect(queryByTestId('welcome-signin')).toBeNull();
    expect(queryByTestId('signin-submit')).toBeNull();
  });

  it('brings the copy and the actions in once the splash lifts', async () => {
    const { getByTestId, getByText } = await render(<SignIn />);
    await act(async () => setSplashVisible(false));
    expect(getByTestId('welcome-cta')).toBeTruthy();
    expect(getByTestId('welcome-signin')).toBeTruthy();
    expect(getByText(/learns from you/)).toBeTruthy();
  });

  it('shows everything at once when there was no splash (sign-out lands here)', async () => {
    setSplashVisible(false);
    const { getByTestId } = await render(<SignIn />);
    expect(getByTestId('welcome-cta')).toBeTruthy();
  });

  it('CTA → the form in sign-up mode', async () => {
    setSplashVisible(false);
    const { getByTestId, queryByTestId } = await render(<SignIn />);
    await fireEvent.press(getByTestId('welcome-cta'));
    expect(queryByTestId('welcome-intro')).toBeNull();
    expect(getByTestId('signin-submit')).toBeTruthy();
    // Sign-up mode is the one with a name row.
    expect(getByTestId('firstName')).toBeTruthy();
  });

  it('"I already have an account" → the form in sign-in mode', async () => {
    setSplashVisible(false);
    const { getByTestId, queryByTestId } = await render(<SignIn />);
    await fireEvent.press(getByTestId('welcome-signin'));
    expect(queryByTestId('welcome-intro')).toBeNull();
    expect(getByTestId('signin-submit')).toBeTruthy();
    expect(queryByTestId('firstName')).toBeNull();
    expect(getByTestId('signin-forgot')).toBeTruthy();
  });
});
