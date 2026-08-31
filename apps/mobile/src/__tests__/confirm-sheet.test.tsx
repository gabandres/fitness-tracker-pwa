import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';

// `@/test-utils` → i18n → auth → firebase's ESM build, which jest's transform
// cannot parse — the standing trap; mock auth out like every component test.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null }),
}));

/**
 * The branded confirm sheet (UX_AUDIT S16-10) — the invariants worth pinning:
 * confirm runs the action exactly once, cancel runs it never, and a call with
 * no host mounted performs nothing (fail closed, not open).
 */
describe('ConfirmSheet', () => {
  it('runs onConfirm when the affirmative button is pressed', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<ConfirmHost />);

    confirm({ title: 'Delete this?', body: 'It is gone for good.', confirmText: 'Delete', destructive: true, onConfirm });

    await waitFor(() => expect(screen.getByText('Delete this?')).toBeTruthy());
    expect(screen.getByText('It is gone for good.')).toBeTruthy();

    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does NOT run onConfirm on cancel', async () => {
    const onConfirm = jest.fn();
    const screen = await render(<ConfirmHost />);

    confirm({ title: 'Sure?', confirmText: 'Yes', onConfirm });
    await waitFor(() => expect(screen.getByText('Sure?')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('fails closed with no host mounted', () => {
    const onConfirm = jest.fn();
    expect(() => confirm({ title: 'x', confirmText: 'y', onConfirm })).not.toThrow();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
