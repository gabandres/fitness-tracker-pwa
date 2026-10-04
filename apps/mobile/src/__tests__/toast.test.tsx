import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { ToastProvider, ToastSheetHost, showToast, useToast } from '@/components/Toast';

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null, profile: null }),
}));

/**
 * The toast (S18-6 undo, S18-12 offline receipt). Pinned: the action fires
 * exactly once and dismisses; a plain receipt auto-dismisses; a newer toast
 * replaces the old one; and the imperative form reaches the mounted host.
 */
function Trigger({ onAction }: { onAction?: () => void }) {
  const toast = useToast();
  return (
    <Text
      testID="fire"
      onPress={() =>
        toast.show('Entry deleted', { durationMs: 5000, action: { label: 'Undo', onPress: onAction ?? (() => {}) } })
      }
    >
      fire
    </Text>
  );
}

describe('Toast', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('shows the message, runs the action once, and dismisses', async () => {
    const onAction = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ToastProvider>
        <Trigger onAction={onAction} />
      </ToastProvider>,
    );
    expect(queryByTestId('toast')).toBeNull();

    await act(async () => {
      fireEvent.press(getByTestId('fire'));
    });
    expect(getByTestId('toast')).toHaveTextContent(/Entry deleted/);

    await act(async () => {
      fireEvent.press(getByTestId('toast-action'));
    });
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(queryByTestId('toast')).toBeNull();
  });

  it('auto-dismisses after its duration', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    );
    await act(async () => {
      fireEvent.press(getByTestId('fire'));
    });
    expect(queryByTestId('toast')).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(5001);
    });
    expect(queryByTestId('toast')).toBeNull();
  });

  it('reaches the host through the imperative showToast()', async () => {
    const { getByTestId } = await render(
      <ToastProvider>
        <Text>app</Text>
      </ToastProvider>,
    );
    await act(async () => {
      showToast('Saved offline', { testID: 'receipt' });
    });
    expect(getByTestId('receipt')).toHaveTextContent(/Saved offline/);
    // A plain receipt offers Dismiss, never an unlabeled dead end.
    expect(getByTestId('toast-dismiss')).toBeTruthy();
  });

  it('lets a newer toast replace the old one without the old timer clearing it', async () => {
    const { getByTestId, queryByTestId } = await render(
      <ToastProvider>
        <Text>app</Text>
      </ToastProvider>,
    );
    await act(async () => {
      showToast('first', { durationMs: 1000 });
    });
    await act(async () => {
      jest.advanceTimersByTime(800);
      showToast('second', { durationMs: 4000 });
    });
    await act(async () => {
      jest.advanceTimersByTime(300);
    });
    // 1.1 s in: the first toast's timer would have fired; the second must stand.
    expect(getByTestId('toast')).toHaveTextContent(/second/);
    await act(async () => {
      jest.advanceTimersByTime(4000);
    });
    expect(queryByTestId('toast')).toBeNull();
  });

  it('is a no-op with no provider mounted', () => {
    expect(() => showToast('nobody home')).not.toThrow();
  });
});

describe('Toast — Edit beside Undo, and inside sheets (2026-10-04)', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function Fire({ onEdit, onUndo }: { onEdit: () => void; onUndo: () => void }) {
    const toast = useToast();
    return (
      <Text
        testID="fire2"
        onPress={() =>
          toast.show('Logged Oatmeal · 300 kcal', {
            action: { label: 'Undo', onPress: onUndo },
            secondaryAction: { label: 'Edit', onPress: onEdit },
          })
        }
      >
        fire
      </Text>
    );
  }

  it('draws the secondary action and runs only that one', async () => {
    const onEdit = jest.fn();
    const onUndo = jest.fn();
    const { getByTestId, queryByTestId } = await render(
      <ToastProvider>
        <Fire onEdit={onEdit} onUndo={onUndo} />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('fire2'));
    await fireEvent.press(getByTestId('toast-secondary-action'));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onUndo).not.toHaveBeenCalled();
    expect(queryByTestId('toast')).toBeNull();
  });

  it('while a sheet host is mounted, only the sheet draws the toast', async () => {
    const onEdit = jest.fn();
    const { getByTestId, getAllByTestId, rerender } = await render(
      <ToastProvider>
        <Fire onEdit={onEdit} onUndo={() => {}} />
        <ToastSheetHost />
      </ToastProvider>,
    );
    await fireEvent.press(getByTestId('fire2'));
    // One toast, not two: the root host stands down for the sheet's.
    expect(getAllByTestId('toast')).toHaveLength(1);
    await act(async () => {
      rerender(
        <ToastProvider>
          <Fire onEdit={onEdit} onUndo={() => {}} />
        </ToastProvider>,
      );
    });
  });
});
