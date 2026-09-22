import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import React from 'react';

/**
 * Resend must come back. It used to latch off forever.
 *
 * `resent` was a one-way boolean: the first SUCCESSFUL resend disabled the
 * button for the life of the screen. If that second mail also went missing —
 * spam, a typo'd address, a provider bounce — the only way off the
 * verification wall was to force-quit the app or sign out, from the one screen
 * standing between sign-up and the product. The RATE_LIMITED branch in the
 * same function had already reasoned its way to the right shape ("the button
 * stays enabled, because a minute later it will work"); the success path never
 * adopted it. Found by the 2026-09-22 code review.
 */

const mockResend = jest.fn();

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co', emailVerified: false },
    reloadUser: jest.fn().mockResolvedValue(false),
    resendVerification: (...a: unknown[]) => mockResend(...a),
    signOut: jest.fn(),
  }),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

import VerifyEmail from '@/app/verify-email';

beforeEach(() => {
  mockResend.mockReset().mockResolvedValue(undefined);
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

it('re-enables Resend once the cooldown expires', async () => {
  const screen = await render(<VerifyEmail />);

  await fireEvent.press(screen.getByTestId('verify-resend'));
  await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));

  // Inside the cooldown the control is genuinely disabled, not just styled.
  expect(screen.getByTestId('verify-resend').props.accessibilityState.disabled).toBe(true);
  await fireEvent.press(screen.getByTestId('verify-resend'));
  expect(mockResend).toHaveBeenCalledTimes(1);

  // A minute later it works again — which is the whole point.
  await act(async () => {
    jest.advanceTimersByTime(61_000);
  });

  expect(screen.getByTestId('verify-resend').props.accessibilityState.disabled).toBe(false);
  await fireEvent.press(screen.getByTestId('verify-resend'));
  await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(2));
});

it('leaves the button usable when the send fails outright', async () => {
  mockResend.mockRejectedValue({ details: { code: 'INTERNAL' } });
  const screen = await render(<VerifyEmail />);

  await fireEvent.press(screen.getByTestId('verify-resend'));
  await waitFor(() => expect(mockResend).toHaveBeenCalledTimes(1));

  // A failure starts no cooldown: there is nothing in flight to wait for.
  expect(screen.getByTestId('verify-resend').props.accessibilityState.disabled).toBe(false);
});
