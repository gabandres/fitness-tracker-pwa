import React, { type ReactNode } from 'react';
import { act, renderHook } from '@testing-library/react-native';

/**
 * The add receipt's two S20 cases:
 *
 * - C3: a write the rules REFUSED says it was not saved — never the
 *   "Saved offline" a parked write gets, and with no Undo or Edit, because
 *   there is no row to act on.
 * - B7: an Undo says it took ("Removed Oatmeal"). The receipt vanished on the
 *   tap and nothing confirmed the reversal.
 */

const mockShow = jest.fn();
jest.mock('@/components/Toast', () => ({ useToast: () => ({ show: mockShow, hide: jest.fn() }) }));
const mockUndoAdds = jest.fn(async () => undefined);
jest.mock('@/lib/pending-logs', () => ({ undoAdds: (...a: unknown[]) => mockUndoAdds(...(a as [])) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { useAddReceipt } from '@/hooks/useAddReceipt';
import { I18nProvider } from '@/i18n';
import * as haptics from '@/lib/haptics';

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

beforeEach(() => {
  mockShow.mockReset();
  mockUndoAdds.mockClear();
  (haptics.warning as jest.Mock).mockClear();
});

it('says a refused write was not saved, with no Undo and no Edit', async () => {
  const { result } = await renderHook(() => useAddReceipt(), { wrapper });

  await act(async () => result.current.showAdded({ outcome: 'rejected', id: 'x' }, { label: 'Oats', calories: 300 }, jest.fn()));

  expect(mockShow).toHaveBeenCalledTimes(1);
  const [message, opts] = mockShow.mock.calls[0] as [string, { action?: unknown; secondaryAction?: unknown }];
  expect(message).toBe("Couldn't save Oats — it was refused, so nothing was logged.");
  expect(message).not.toMatch(/offline/i);
  expect(opts.action).toBeUndefined();
  expect(opts.secondaryAction).toBeUndefined();
  expect(haptics.warning).toHaveBeenCalled();
});

it('confirms an Undo once it has taken', async () => {
  const { result } = await renderHook(() => useAddReceipt(), { wrapper });
  await act(async () => result.current.showAdded({ outcome: 'logged', id: 'row1' }, { label: 'Oatmeal', calories: 300 }));

  const opts = mockShow.mock.calls[0][1] as { action: { label: string; onPress: () => void } };
  expect(opts.action.label).toBe('Undo');
  await act(async () => opts.action.onPress());

  expect(mockUndoAdds).toHaveBeenCalledWith('u1', ['row1']);
  expect(mockShow).toHaveBeenLastCalledWith('Removed Oatmeal', expect.objectContaining({ testID: 'toast-undone' }));
});

it('counts the refused rows of a batch and undoes only the ones that landed', async () => {
  const { result } = await renderHook(() => useAddReceipt(), { wrapper });
  await act(async () =>
    result.current.showAddedMany(
      [
        { outcome: 'logged', id: 'a' },
        { outcome: 'rejected', id: 'b' },
        { outcome: 'logged', id: 'c' },
      ],
      900,
    ),
  );

  const [message, opts] = mockShow.mock.calls[0] as [string, { action: { onPress: () => void } }];
  expect(message).toBe("1 of 3 couldn't be saved. The rest were logged.");
  await act(async () => opts.action.onPress());
  expect(mockUndoAdds).toHaveBeenCalledWith('u1', ['a', 'c']);
});
