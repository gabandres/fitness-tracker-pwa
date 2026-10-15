import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';

/**
 * The sign-up verification email can fail to send (09-22 item, audit
 * 2026-10-15). `signUp` swallowed that into a console warning, and this screen
 * then told the user a link was on its way — they waited on an email that was
 * never coming. The auth layer now flags it, and the screen says so and points
 * at Resend until a resend succeeds.
 */

const mockResend = jest.fn();
let mockSendFailed = false;

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co', emailVerified: false },
    reloadUser: jest.fn().mockResolvedValue(false),
    resendVerification: (...a: unknown[]) => mockResend(...a),
    verificationSendFailed: mockSendFailed,
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

import VerifyEmail from '@/app/verify-email';

beforeEach(() => {
  mockResend.mockReset().mockResolvedValue(undefined);
  mockSendFailed = false;
});

it('says the first email did not go out', async () => {
  mockSendFailed = true;
  const screen = await render(<VerifyEmail />);
  expect(screen.getByTestId('verify-error')).toHaveTextContent(/couldn't send your verification email/i);
});

it('says nothing extra when the first send worked', async () => {
  const screen = await render(<VerifyEmail />);
  expect(screen.queryByTestId('verify-error')).toBeNull();
});

it('drops the message once a resend goes through', async () => {
  mockSendFailed = true;
  const screen = await render(<VerifyEmail />);
  await fireEvent.press(screen.getByTestId('verify-resend'));
  await waitFor(() => expect(mockResend).toHaveBeenCalled());
  await waitFor(() => expect(screen.queryByTestId('verify-error')).toBeNull());
});
