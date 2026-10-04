import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { Text } from 'react-native';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { BottomSheet } from '@/components/BottomSheet';

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

describe('ConfirmSheet — asked from inside an open sheet (2026-10-04)', () => {
  it('renders in the sheet\'s own host, not the tab-layout one', async () => {
    // iOS will not present a Modal from a controller already presenting one,
    // so a confirm raised while a sheet is up must draw INSIDE that sheet.
    // Pinned structurally: with a sheet open, exactly one confirm renders, and
    // it is the nested host's (the root host stands down by stack order).
    const onConfirm = jest.fn();
    const screen = await render(
      <>
        <ConfirmHost />
        <BottomSheet visible onClose={() => {}}>
          <Text>sheet body</Text>
        </BottomSheet>
      </>,
    );
    confirm({ title: 'Discard this entry?', confirmText: 'Discard', destructive: true, onConfirm });
    await waitFor(() => expect(screen.getAllByText('Discard this entry?')).toHaveLength(1));
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
