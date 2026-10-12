import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { ActionSheetIOS, Alert, Platform, Text } from 'react-native';
import { ConfirmHost, confirm, confirmNative } from '@/components/ConfirmSheet';
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

  it('three actions stack full-width in screen order: main, secondary, Cancel (Finish prompt, QA v2)', async () => {
    const onSecondary = jest.fn();
    const screen = await render(<ConfirmHost />);
    confirm({ title: 'Update Upper A?', confirmText: 'Update and complete', secondaryText: 'Complete only', onConfirm: jest.fn(), onSecondary });
    await waitFor(() => expect(screen.getByText('Update Upper A?')).toBeTruthy());
    const order = screen.getAllByRole('button').map((b) => b.props.testID as string | undefined)
      .filter((id) => id === 'confirm-go' || id === 'confirm-secondary' || id === 'confirm-cancel');
    expect(order).toEqual(['confirm-go', 'confirm-secondary', 'confirm-cancel']);
    // Full width each (no flex row splitting the main action beside Cancel).
    const flat = (st: unknown) => Object.assign({}, ...[st].flat(Infinity).filter(Boolean));
    expect(flat(screen.getByTestId('confirm-go').props.style).flex).toBe(0);
    await fireEvent.press(screen.getByTestId('confirm-secondary'));
    expect(onSecondary).toHaveBeenCalledTimes(1);
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

/**
 * `native: true` (train-ux F2, R30/R31): a confirm asked over a native sheet is
 * the platform's own dialog, not a branded sheet on top of the sheet.
 */
describe('ConfirmSheet — native path', () => {
  afterEach(() => jest.restoreAllMocks());

  it('iOS: an action sheet — main action first and red when destructive, Cancel last; no branded sheet', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const onConfirm = jest.fn();
    const screen = await render(<ConfirmHost />);
    confirmNative({ title: 'Discard changes?', body: 'Your edits will be lost.', confirmText: 'Discard', cancelText: 'Keep editing', destructive: true, onConfirm });
    expect(sheet).toHaveBeenCalledTimes(1);
    const [opts, pick] = sheet.mock.calls[0];
    expect(opts).toMatchObject({
      title: 'Discard changes?',
      message: 'Your edits will be lost.',
      options: ['Discard', 'Keep editing'],
      cancelButtonIndex: 1,
      destructiveButtonIndex: 0,
    });
    expect(screen.queryByTestId('confirm-go')).toBeNull();
    pick(1);
    expect(onConfirm).not.toHaveBeenCalled();
    pick(0);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('iOS: three actions — main, secondary, Cancel (localized default); not destructive → no red index', async () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const onConfirm = jest.fn();
    const onSecondary = jest.fn();
    await render(<ConfirmHost />);
    confirm({ native: true, title: 'Update Upper A?', confirmText: 'Update and finish', secondaryText: 'Finish only', onConfirm, onSecondary });
    const [opts, pick] = sheet.mock.calls[0];
    expect(opts.options).toEqual(['Update and finish', 'Finish only', 'Cancel']);
    expect(opts.cancelButtonIndex).toBe(2);
    expect(opts.destructiveButtonIndex).toBeUndefined();
    pick(1);
    expect(onSecondary).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    pick(2);
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('Android: an alert — neutral/negative/positive = secondary, Cancel, main action', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onConfirm = jest.fn();
    const onSecondary = jest.fn();
    await render(<ConfirmHost />);
    confirmNative({ title: 'Update Upper A?', body: 'Bench: 170 → 175', confirmText: 'Update and finish', secondaryText: 'Finish only', onConfirm, onSecondary });
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, body, buttons, options] = alert.mock.calls[0];
    expect(title).toBe('Update Upper A?');
    expect(body).toBe('Bench: 170 → 175');
    expect(buttons!.map((b) => b.text)).toEqual(['Finish only', 'Cancel', 'Update and finish']);
    expect(buttons![1].style).toBe('cancel');
    expect(options).toMatchObject({ cancelable: true });
    buttons![2].onPress!();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    buttons![0].onPress!();
    expect(onSecondary).toHaveBeenCalledTimes(1);
  });

  it('fails closed with no host mounted, like the branded path', () => {
    const sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {});
    const onConfirm = jest.fn();
    confirmNative({ title: 'x', confirmText: 'y', onConfirm });
    expect(sheet).not.toHaveBeenCalled();
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
