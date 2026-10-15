import React from 'react';
import { act, renderWithProviders as render, waitFor } from '@/test-utils';

/** Audit 2026-10-15 #6, the scanner half: see barcode-cancel.test.tsx. */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));
let mockScan: ((r: { data: string }) => void) | undefined;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn()],
  CameraView: (props: { onBarcodeScanned?: (r: { data: string }) => void }) => {
    mockScan = props.onBarcodeScanned;
    return null;
  },
}));
let mockResolve: (v: unknown) => void = () => {};
let mockSignal: AbortSignal | undefined;
jest.mock('@/lib/barcode', () => ({
  lookupProduct: (_code: string, opts?: { signal?: AbortSignal }) => {
    mockSignal = opts?.signal;
    return new Promise((r) => {
      mockResolve = r;
    });
  },
}));

import { BarcodeScanner } from '@/components/BarcodeScanner';

it('aborts the lookup on close and ignores its late answer', async () => {
  const onPick = jest.fn();
  const base = { onClose: jest.fn(), onPick, onDenied: jest.fn() };
  const screen = await render(<BarcodeScanner visible {...base} />);
  await waitFor(() => expect(mockScan).toBeDefined());
  await act(async () => {
    mockScan?.({ data: '5000112637922' });
  });
  await screen.rerender(<BarcodeScanner visible={false} {...base} />);
  expect(mockSignal?.aborted).toBe(true);
  await act(async () => {
    mockResolve({ calories: 100, protein: 1, carbs: 1, fat: 1, productName: 'Late', serving: undefined });
  });
  expect(onPick).not.toHaveBeenCalled();
});
