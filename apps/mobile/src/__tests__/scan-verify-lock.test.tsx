import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Photo scan waits for a confirmed email (owner's call, 2026-11-19).
 *
 * An unverified account logs everything else; the scan is an AI call that costs
 * money, so the screen shows a locked state in place of the camera — before
 * any warm-up, encode or upload — and the server's own `EMAIL_NOT_VERIFIED`
 * lands in the same state rather than a "try another angle" failure.
 */

let mockVerified: boolean | undefined = false;
const mockReload = jest.fn();
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1' },
    emailVerified: mockVerified,
    sessionPresumed: false,
    reloadUser: () => mockReload(),
  }),
}));

const mockReplace = jest.fn();
const mockPush = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: mockPush }),
}));
jest.mock('@/hooks/useToday', () => ({
  useToday: () => ({ addEntry: jest.fn(async () => ({ outcome: 'synced', id: 'r' })), customFoods: [] }),
}));
jest.mock('@/hooks/useAddReceipt', () => ({
  useAddReceipt: () => ({ showAdded: jest.fn(), showCopied: jest.fn() }),
}));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn(), ConfirmHost: () => null }));
jest.mock('@/lib/connectivity', () => ({ isOffline: () => false, useIsOffline: () => false }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const mockWarm = jest.fn();
const mockAnalyze = jest.fn();
jest.mock('@/lib/mealScan', () => ({
  warmUpPhotoScan: () => mockWarm(),
  pickMealPhoto: jest.fn(),
  encodeMealPhoto: async (u: string) => `b64:${u}`,
  analyzeMealPhoto: (...a: unknown[]) => mockAnalyze(...a),
  scanErrorMessage: () => ({ key: 'scan.failed', params: {} }),
}));
jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () => null,
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));
jest.mock('expo-camera', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn(), jest.fn()],
    CameraView: R.forwardRef((p: { onCameraReady?: () => void }, ref: React.Ref<unknown>) => {
      R.useImperativeHandle(ref, () => ({ takePictureAsync: async () => ({ uri: 'file://shot.jpg' }) }));
      const { onCameraReady } = p;
      R.useEffect(() => {
        onCameraReady?.();
      }, [onCameraReady]);
      return null;
    }),
  };
});

import Scan from '@/app/scan';

beforeEach(() => {
  mockVerified = false;
  mockReload.mockReset().mockResolvedValue(false);
  mockReplace.mockReset();
  mockPush.mockReset();
  mockWarm.mockReset();
  mockAnalyze.mockReset();
});

describe('unverified', () => {
  it('shows the locked state instead of the camera, and warms nothing up', async () => {
    const screen = await render(<Scan />);
    expect(screen.getByTestId('scan-locked')).toBeTruthy();
    expect(screen.queryByTestId('scan-shutter')).toBeNull();
    expect(mockWarm).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();
  });

  it('Verify email opens the verify screen; the secondary goes to the add sheet', async () => {
    const screen = await render(<Scan />);
    expect(screen.getByTestId('locked-verify').props.accessibilityRole).toBe('button');
    await fireEvent.press(screen.getByTestId('locked-verify'));
    expect(mockPush).toHaveBeenCalledWith('/verify-email');

    await fireEvent.press(screen.getByTestId('locked-secondary'));
    expect(mockReplace).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: '/(app)', params: expect.objectContaining({ openAdd: expect.any(String) }) }),
    );
  });

  it('re-checks verification when the screen opens', async () => {
    await render(<Scan />);
    await waitFor(() => expect(mockReload).toHaveBeenCalled());
  });
});

describe('verified, but the server says otherwise', () => {
  const refusal = { code: 'functions/failed-precondition', details: { code: 'EMAIL_NOT_VERIFIED' } };

  it('locks when Firebase agrees the email is unverified', async () => {
    mockVerified = true;
    mockAnalyze.mockRejectedValue(refusal);
    const screen = await render(<Scan />);
    await waitFor(() => expect(screen.getByTestId('scan-shutter')).toBeTruthy());
    expect(screen.queryByTestId('scan-locked')).toBeNull();

    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-locked')).toBeTruthy());
    expect(mockReload).toHaveBeenCalled();
  });

  it('does not lock when the reload finds it verified (a stale token) — it says try again', async () => {
    mockVerified = true;
    mockReload.mockResolvedValue(true);
    mockAnalyze.mockRejectedValue(refusal);
    const screen = await render(<Scan />);
    await waitFor(() => expect(screen.getByTestId('scan-shutter')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-notice')).toHaveTextContent(/verify\.nowConfirmed|confirmed now/));
    expect(screen.queryByTestId('scan-locked')).toBeNull();
  });
});
