import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { OffLookupError } from '@macrolog/core';
import { BarcodeScanner } from '@/components/BarcodeScanner';

// `@/test-utils` → i18n → auth → firebase's ESM build; mock auth out like every
// component test.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: null }),
}));

// The camera is the one thing jest cannot run. The mock hands the test the
// scan callback so a "barcode in frame" is a plain function call.
let mockScan: ((r: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
  CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
    mockScan = props.onBarcodeScanned;
    return null;
  },
}));

const mockLookup = jest.fn();
jest.mock('@/lib/barcode', () => ({
  lookupProduct: (code: string) => mockLookup(code),
}));

/**
 * A barcode miss is a dead end unless it says what to do next, and to a screen
 * reader it was not even a dead end — it was silence. Pinned: the miss is
 * announced once per code, the next step is on screen, and the optional
 * "Enter it from the label" action appears only when the caller wires it and
 * hands back the code that missed.
 */
describe('BarcodeScanner miss', () => {
  let announce: jest.SpyInstance;
  beforeEach(() => {
    mockScan = undefined;
    mockLookup.mockReset().mockRejectedValue(new OffLookupError('FOOD_NOT_FOUND'));
    announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
  });
  afterEach(() => announce.mockRestore());

  const base = { visible: true, onClose: jest.fn(), onPick: jest.fn(), onDenied: jest.fn() };

  it('announces the miss with a next step, and offers the label action when wired', async () => {
    const onEnterFromLabel = jest.fn();
    const screen = await render(<BarcodeScanner {...base} onEnterFromLabel={onEnterFromLabel} />);

    await act(async () => mockScan?.({ data: '0123456789012' }));
    await waitFor(() => expect(screen.getByTestId('barcode-miss')).toBeTruthy());

    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce.mock.calls[0][0]).toMatch(/Open Food Facts/);

    await fireEvent.press(screen.getByTestId('barcode-enter-label'));
    expect(onEnterFromLabel).toHaveBeenCalledWith('0123456789012');

    // The camera keeps reading after a miss; the same code must not repeat
    // the whole sentence on every lookup.
    await act(async () => mockScan?.({ data: '0123456789012' }));
    expect(announce).toHaveBeenCalledTimes(1);
  });

  it('still names a next step without the action, and renders no dead button', async () => {
    const screen = await render(<BarcodeScanner {...base} />);

    await act(async () => mockScan?.({ data: '4006381333931' }));
    await waitFor(() => expect(screen.getByTestId('barcode-miss')).toBeTruthy());

    expect(screen.getByText(/type it in from the package label/)).toBeTruthy();
    expect(screen.queryByTestId('barcode-enter-label')).toBeNull();
  });
});
