import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, renderWithProviders as render, waitFor } from '@/test-utils';
import { OffLookupError } from '@macrolog/core';
import { BarcodeScanner } from '@/components/BarcodeScanner';

/**
 * The camera reports the code in frame on every frame. After a miss the same
 * label is usually still there, and each report used to be a fresh lookup —
 * a haptic, a `barcode_scan` event and a blink of the miss panel, several
 * times a second (add-meal re-score, bug 3). Pinned: a product the database
 * lacks is not asked again until a different code is read; a miss the network
 * caused rests a few seconds and then may retry, without blinking the panel.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

let mockScan: ((r: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
  CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
    mockScan = props.onBarcodeScanned;
    return null;
  },
}));
jest.mock('@/lib/connectivity', () => ({ isOffline: () => false }));
const mockTrack = jest.fn();
jest.mock('@/lib/analytics', () => ({ track: (...a: unknown[]) => mockTrack(...a) }));
const mockLookup = jest.fn();
jest.mock('@/lib/barcode', () => ({ lookupProduct: (code: string) => mockLookup(code) }));

const base = { visible: true, onClose: jest.fn(), onPick: jest.fn(), onDenied: jest.fn() };

let announce: jest.SpyInstance;
let now = 1_000_000;
beforeEach(() => {
  mockScan = undefined;
  mockTrack.mockClear();
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

it('does not look a not-found code up again while it stays in frame', async () => {
  mockLookup.mockReset().mockRejectedValue(new OffLookupError('FOOD_NOT_FOUND'));
  const screen = await render(<BarcodeScanner {...base} />);

  await act(async () => mockScan?.({ data: '0123456789012' }));
  await waitFor(() => expect(screen.getByTestId('barcode-miss')).toBeTruthy());
  for (let i = 0; i < 5; i++) {
    now += 2000;
    await act(async () => mockScan?.({ data: '0123456789012' }));
  }
  expect(mockLookup).toHaveBeenCalledTimes(1);
  expect(mockTrack).toHaveBeenCalledTimes(1);
  expect(screen.getByTestId('barcode-miss')).toBeTruthy();

  // A different product in frame is a new question.
  await act(async () => mockScan?.({ data: '4006381333931' }));
  expect(mockLookup).toHaveBeenCalledTimes(2);
  expect(announce).toHaveBeenCalledTimes(2);
});

it('lets a network miss retry after it rests, keeping the miss on screen meanwhile', async () => {
  mockLookup.mockReset().mockRejectedValue(new TypeError('Network request failed'));
  const screen = await render(<BarcodeScanner {...base} />);

  await act(async () => mockScan?.({ data: '0123456789012' }));
  await waitFor(() => expect(screen.getByTestId('barcode-miss')).toBeTruthy());
  now += 1000;
  await act(async () => mockScan?.({ data: '0123456789012' }));
  expect(mockLookup).toHaveBeenCalledTimes(1);

  now += 3000;
  let resolve: (v: unknown) => void = () => {};
  mockLookup.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
  // Not awaited through `act`: the lookup is held open on purpose.
  await act(async () => {
    void mockScan?.({ data: '0123456789012' });
  });
  expect(mockLookup).toHaveBeenCalledTimes(2);
  // Still asking: the miss stays up rather than blinking away.
  expect(screen.getByTestId('barcode-miss')).toBeTruthy();
  await act(async () => resolve({ calories: 200, productName: 'Bar', serving: { source: 'barcode' } }));
  expect(base.onPick).toHaveBeenCalledWith(expect.objectContaining({ calories: 200, mealLabel: 'Bar' }));
});
