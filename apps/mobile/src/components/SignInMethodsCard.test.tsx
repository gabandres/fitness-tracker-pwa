import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { LinkError, type LinkableProvider } from '@/lib/link-error';

/**
 * Sign-in methods card — the proactive half of account linking.
 *
 * The invariants worth pinning are the destructive ones: you must not be able
 * to strip your only way into the account, and a `credential-in-use` failure
 * must not be presented as "try again" (that identity is already a separate
 * account; retrying can never succeed).
 */

const mockLinkProvider = jest.fn().mockResolvedValue(undefined);
const mockLinkPassword = jest.fn().mockResolvedValue(undefined);
const mockUnlinkProvider = jest.fn().mockResolvedValue(undefined);
let mockLinked: LinkableProvider[] = ['password'];

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
      user: { uid: 'u1', email: 'a@b.co' },
      linkedProviders: mockLinked,
      linkProvider: mockLinkProvider,
      linkPassword: mockLinkPassword,
      unlinkProvider: mockUnlinkProvider,
    appleAvailable: false,
  }),
}));

import { SignInMethodsCard } from './SignInMethodsCard';

beforeEach(() => {
  mockLinkProvider.mockClear().mockResolvedValue(undefined);
  mockLinkPassword.mockClear().mockResolvedValue(undefined);
  mockUnlinkProvider.mockClear().mockResolvedValue(undefined);
  mockLinked = ['password'];
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('SignInMethodsCard', () => {
  it('connects Google to the account you are already signed into', async () => {
    const screen = await render(<SignInMethodsCard />);

    await fireEvent.press(screen.getByTestId('signin-methods-connect-google.com'));

    await waitFor(() => expect(mockLinkProvider).toHaveBeenCalledWith('google.com'));
  });

  it('refuses to disconnect the only remaining method', async () => {
    mockLinked = ['password'];
    const screen = await render(<SignInMethodsCard />);

    // Password is the sole provider, so its disconnect control must be inert.
    await fireEvent.press(screen.getByTestId('signin-methods-disconnect-password'));

    expect(mockUnlinkProvider).not.toHaveBeenCalled();
  });

  it('allows disconnecting once a second method exists', async () => {
    mockLinked = ['password', 'google.com'];
    const screen = await render(<SignInMethodsCard />);

    await fireEvent.press(screen.getByTestId('signin-methods-disconnect-google.com'));

    // Confirmation is an Alert; invoke its destructive action.
    const [, , buttons] = (Alert.alert as jest.Mock).mock.calls[0];
    await buttons.find((b: { style?: string }) => b.style === 'destructive').onPress();

    await waitFor(() => expect(mockUnlinkProvider).toHaveBeenCalledWith('google.com'));
  });

  it('does not offer a password row as connectable when one already exists', async () => {
    mockLinked = ['password', 'google.com'];
    const screen = await render(<SignInMethodsCard />);

    expect(screen.queryByTestId('signin-methods-add-password')).toBeNull();
  });

  it('reports credential-in-use as its own message, not a retry prompt', async () => {
    mockLinkProvider.mockRejectedValueOnce(new LinkError('credential-in-use'));
    const screen = await render(<SignInMethodsCard />);

    await fireEvent.press(screen.getByTestId('signin-methods-connect-google.com'));

    await waitFor(() => expect(Alert.alert).toHaveBeenCalled());
    const [, body] = (Alert.alert as jest.Mock).mock.calls[0];
    expect(body).toMatch(/already its own separate/i);
    expect(body).not.toMatch(/try again/i);
    // **Where** the deletion happens is the load-bearing half. The first copy
    // said "or delete that account first" and stopped there; an account can
    // only be deleted from inside itself, so the reader hunts for a delete
    // control in the account they are already in, finds none, and concludes
    // the advice is impossible. Reported off a device 2026-08-29.
    expect(body).toMatch(/from inside it/i);
  });

  it('stays silent when the user cancels the provider picker', async () => {
    mockLinkProvider.mockRejectedValueOnce(new LinkError('cancelled'));
    const screen = await render(<SignInMethodsCard />);

    await fireEvent.press(screen.getByTestId('signin-methods-connect-google.com'));

    await waitFor(() => expect(mockLinkProvider).toHaveBeenCalled());
    // Backing out of a picker is a decision, not an error worth an alert.
    expect(Alert.alert).not.toHaveBeenCalled();
  });
});
