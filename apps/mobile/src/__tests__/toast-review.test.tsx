import React from 'react';
import { Text } from 'react-native';
import * as RN from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { ANNOUNCE_AFTER_SHEET_MS, ToastProvider, ToastSheetHost, useToast } from '@/components/Toast';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: jest.fn(),
}));
import { announce } from '@/lib/a11y';

/**
 * The toast changes from the Today review (2026-10-04): Magic Tap runs the
 * live action (A6), the announcement waits out a sheet dismissal (A6), and
 * the actions stack under the message at large text (A7).
 */
function Fire({ onUndo, onAct }: { onUndo: () => void; onAct?: (ran: boolean) => void }) {
  const toast = useToast();
  return (
    <>
      <Text testID="fire" onPress={() => toast.show('Entry deleted', { action: { label: 'Undo', onPress: onUndo } })}>
        fire
      </Text>
      <Text testID="plain" onPress={() => toast.show('Saved')}>
        plain
      </Text>
      <Text testID="magic" onPress={() => onAct?.(toast.act())}>
        magic
      </Text>
    </>
  );
}

describe('Toast — Today review', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });
  afterEach(() => jest.useRealTimers());

  it('act() runs the live action once and dismisses (the Magic Tap path)', async () => {
    const onUndo = jest.fn();
    const ran: boolean[] = [];
    const { getByTestId, queryByTestId } = await render(
      <ToastProvider>
        <Fire onUndo={onUndo} onAct={(r) => ran.push(r)} />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('fire'));
    await fireEvent.press(getByTestId('magic'));
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(queryByTestId('toast')).toBeNull();
    // Nothing left to run: answers false and does nothing.
    await fireEvent.press(getByTestId('magic'));
    expect(ran).toEqual([true, false]);
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('act() is false for a plain receipt', async () => {
    const ran: boolean[] = [];
    const { getByTestId } = await render(
      <ToastProvider>
        <Fire onUndo={() => {}} onAct={(r) => ran.push(r)} />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('plain'));
    await fireEvent.press(getByTestId('magic'));
    expect(ran).toEqual([false]);
  });

  it('speaks at once with no sheet around', async () => {
    const { getByTestId } = await render(
      <ToastProvider>
        <Fire onUndo={() => {}} />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('plain'));
    expect(announce).toHaveBeenCalledWith('Saved');
  });

  it('holds the announcement while a sheet is up, so VoiceOver does not drop it', async () => {
    const { getByTestId } = await render(
      <ToastProvider>
        <Fire onUndo={() => {}} />
        <ToastSheetHost />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('fire'));
    expect(announce).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(ANNOUNCE_AFTER_SHEET_MS);
    });
    expect(announce).toHaveBeenCalledWith('Entry deleted. Undo');
  });

  it('stacks the actions under the message from 1.35× text', async () => {
    const dims = jest
      .spyOn(RN, 'useWindowDimensions')
      .mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 1.5 });
    const { getByTestId } = await render(
      <ToastProvider>
        <Fire onUndo={() => {}} />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('fire'));
    const style = RN.StyleSheet.flatten(getByTestId('toast').props.style);
    expect(style.flexDirection).toBe('column');
    dims.mockRestore();
  });
});
