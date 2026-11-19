import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * The coach waits for a confirmed email (2026-11-19): every answer is a paid
 * model call. Unverified, the screen is a locked state with Verify and Back —
 * no composer, no quota read. The server's `EMAIL_NOT_VERIFIED` (the coach
 * stream's own `{ code }`) lands in the same state.
 */

let mockVerified: boolean = false;
const mockReload = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', getIdToken: async () => 'tok' },
    emailVerified: mockVerified,
    sessionPresumed: false,
    reloadUser: () => mockReload(),
  }),
}));
const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush, back: mockBack, replace: jest.fn(), canGoBack: () => true }),
}));
jest.mock('@/hooks/useCoach', () => ({
  useCoach: () => ({ loading: false, logs: [], tdee: {}, profile: null, dailyWeights: {} }),
}));
jest.mock('@macrolog/core', () => ({
  ...jest.requireActual('@macrolog/core'),
  buildCoachRequest: () => ({ v: 2 }),
}));
const mockQuota = jest.fn();
jest.mock('@/lib/ledger', () => ({ getConsultationQuota: (...a: unknown[]) => mockQuota(...a) }));
jest.mock('@/lib/connectivity', () => ({ isOffline: () => false, useIsOffline: () => false }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
const mockStream = jest.fn();
jest.mock('@/lib/coach', () => ({
  ...jest.requireActual('@/lib/coach'),
  streamCoach: (...a: unknown[]) => mockStream(...a),
}));

import Coach from '@/app/coach';

beforeEach(() => {
  mockVerified = false;
  mockReload.mockReset().mockResolvedValue(false);
  mockQuota.mockReset().mockResolvedValue({ remaining: 3, limit: 3 });
  mockStream.mockReset();
  mockPush.mockReset();
  mockBack.mockReset();
});

it('unverified: the locked state, with no composer and no quota read', async () => {
  const screen = await render(<Coach />);
  expect(screen.getByTestId('coach-locked')).toBeTruthy();
  expect(screen.queryByTestId('coach-input')).toBeNull();
  expect(mockQuota).not.toHaveBeenCalled();

  await fireEvent.press(screen.getByTestId('locked-verify'));
  expect(mockPush).toHaveBeenCalledWith('/verify-email');
  await fireEvent.press(screen.getByTestId('locked-secondary'));
  expect(mockBack).toHaveBeenCalled();
});

it("verified: a server EMAIL_NOT_VERIFIED locks the screen when Firebase agrees", async () => {
  mockVerified = true;
  mockStream.mockRejectedValue(Object.assign(new Error('EMAIL_NOT_VERIFIED'), { code: 'EMAIL_NOT_VERIFIED' }));
  const screen = await render(<Coach />);
  expect(screen.queryByTestId('coach-locked')).toBeNull();
  await fireEvent.changeText(screen.getByTestId('coach-input'), 'How am I doing?');
  await fireEvent.press(screen.getByTestId('coach-ask'));
  await waitFor(() => expect(screen.getByTestId('coach-locked')).toBeTruthy());
});

it('verified: a stale-token refusal says try again instead of locking', async () => {
  mockVerified = true;
  mockReload.mockResolvedValue(true);
  mockStream.mockRejectedValue(Object.assign(new Error('EMAIL_NOT_VERIFIED'), { code: 'EMAIL_NOT_VERIFIED' }));
  const screen = await render(<Coach />);
  await fireEvent.changeText(screen.getByTestId('coach-input'), 'How am I doing?');
  await fireEvent.press(screen.getByTestId('coach-ask'));
  await waitFor(() => expect(screen.getByTestId('coach-reply')).toHaveTextContent(/verify\.nowConfirmed|confirmed now/));
  expect(screen.queryByTestId('coach-locked')).toBeNull();
});
