import React from 'react';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * Android, camera denied once (add-meal re-score, bug 1). After a first
 * "Deny" Android reports `denied` with `canAskAgain: true`; the scanner asked
 * only while `undetermined` and gave up only when `!canAskAgain`, so it sat on
 * a spinner on black with no Cancel, every time it opened.
 *
 * Now an open asks again (once), and a "Deny" to that leaves a plain panel
 * with the ask and the way out. A permanent denial still hands back to the
 * caller (`onDenied`), which explains it inline — App Review 5.1.1(iv).
 */

// `@/test-utils` → i18n → auth → firebase's ESM build; mock auth out.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

type Perm = { granted: boolean; canAskAgain: boolean; status: string };
let mockPerm: Perm = { granted: false, canAskAgain: true, status: 'denied' };
const mockRequest = jest.fn();
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [mockPerm, mockRequest],
  CameraView: () => null,
}));
jest.mock('@/lib/connectivity', () => ({ isOffline: () => false }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/barcode', () => ({ lookupProduct: jest.fn() }));

import { BarcodeScanner } from '@/components/BarcodeScanner';

const base = () => ({ visible: true, onClose: jest.fn(), onPick: jest.fn(), onDenied: jest.fn() });

beforeEach(() => {
  mockRequest.mockReset();
  mockPerm = { granted: false, canAskAgain: true, status: 'denied' };
});

it('asks again on open, once, and then offers Allow and Cancel', async () => {
  const props = base();
  const screen = await render(<BarcodeScanner {...props} />);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  // Still denied after that prompt: no loop of prompts, a panel instead.
  await act(async () => {
    await screen.rerender(<BarcodeScanner {...props} />);
  });
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('barcode-perm-retry')).toBeTruthy();
  expect(screen.getByText('Ignia needs the camera to scan barcodes.')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('barcode-perm-allow'));
  expect(mockRequest).toHaveBeenCalledTimes(2);
  await fireEvent.press(screen.getByTestId('barcode-cancel'));
  expect(props.onClose).toHaveBeenCalled();
  expect(props.onDenied).not.toHaveBeenCalled();
});

it('still hands a permanent denial back to the caller, with no panel', async () => {
  mockPerm = { granted: false, canAskAgain: false, status: 'denied' };
  const props = base();
  const screen = await render(<BarcodeScanner {...props} />);
  expect(props.onDenied).toHaveBeenCalled();
  expect(mockRequest).not.toHaveBeenCalled();
  expect(screen.queryByTestId('barcode-perm-retry')).toBeNull();
});

it('asks on a first open as before, and shows no panel before the OS prompt', async () => {
  mockPerm = { granted: false, canAskAgain: true, status: 'undetermined' };
  const screen = await render(<BarcodeScanner {...base()} />);
  expect(mockRequest).toHaveBeenCalledTimes(1);
  expect(screen.queryByTestId('barcode-perm-retry')).toBeNull();
});
