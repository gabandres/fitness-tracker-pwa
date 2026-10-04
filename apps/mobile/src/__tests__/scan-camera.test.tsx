import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * The in-app viewfinder, and the tap count it exists for: shutter → Analyze →
 * Add, with no system camera, no "Use Photo" confirm and no describe step for
 * a plate with nothing to say about it.
 *
 * Pinned here because none of it is visible to a device run that has already
 * granted the camera — the intro and the blocked state are what a fresh
 * install and a "Don't Allow" user see, and a screen reader is what proves the
 * shutter worked now that no confirm screen does.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
}));

jest.mock('@/hooks/useToday', () => ({
  useToday: () => ({ addEntry: jest.fn(async () => ({ outcome: 'synced', id: 'r' })), customFoods: [] }),
}));
jest.mock('@/hooks/useAddReceipt', () => ({
  useAddReceipt: () => ({ showAdded: jest.fn(), showCopied: jest.fn() }),
}));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));

const mockPick = jest.fn();
const mockEncode = jest.fn(async (uri: string) => `b64:${uri}`);
const mockAnalyze = jest.fn();
jest.mock('@/lib/mealScan', () => ({
  pickMealPhoto: (s: string) => mockPick(s),
  encodeMealPhoto: (u: string) => mockEncode(u),
  analyzeMealPhoto: (...a: unknown[]) => mockAnalyze(...a),
  scanErrorMessage: () => ({ key: 'scan.failed', params: {} }),
}));

// No draft: the screen opens fresh, which is what the viewfinder default is about.
jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () => null,
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));

// The camera is the one thing jest cannot run. The mock exposes the same
// imperative `takePictureAsync` the real ref does, so a shutter press is a
// resolved promise with a file URI.
type Perm = { granted: boolean; canAskAgain: boolean; status: string };
let mockPerm: Perm | null = null;
const mockRequest = jest.fn();
let mockShot = 0;
const mockTake = jest.fn(async (_opts?: unknown) => ({ uri: `file://shot-${++mockShot}.jpg` }));
jest.mock('expo-camera', () => {
  const R = jest.requireActual<typeof import('react')>('react');
  return {
    useCameraPermissions: () => [mockPerm, mockRequest, jest.fn()],
    CameraView: R.forwardRef((p: { onCameraReady?: () => void }, ref: React.Ref<unknown>) => {
      R.useImperativeHandle(ref, () => ({ takePictureAsync: mockTake }));
      // The real view fires this once the session is up; the shutter waits on it.
      const { onCameraReady } = p;
      R.useEffect(() => {
        onCameraReady?.();
      }, [onCameraReady]);
      return null;
    }),
  };
});

import Scan from '@/app/(app)/scan';

const GRANTED: Perm = { granted: true, canAskAgain: true, status: 'granted' };

let announce: jest.SpyInstance;
beforeEach(() => {
  mockShot = 0;
  mockPerm = GRANTED;
  mockRequest.mockReset();
  mockTake.mockClear();
  mockPick.mockReset();
  mockEncode.mockClear();
  mockAnalyze.mockReset().mockResolvedValue({
    items: [{ name: 'Rice', grams: 150, calories: 200, protein: 4, carbs: 44, fat: 0.5, confidence: 0.9, source: 'usda' }],
    confidence: 'high',
    photosRemaining: 2,
  });
  announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});
afterEach(() => announce.mockRestore());

async function openViewfinder() {
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-shutter')).toBeTruthy());
  return screen;
}

describe('scan viewfinder', () => {
  it('opens straight into the camera when access is already granted', async () => {
    const screen = await openViewfinder();
    expect(screen.queryByTestId('scan-take')).toBeNull();
    // Labelled, and the only way to Analyze is to have a photo first.
    expect(screen.getByLabelText('Take photo')).toBeTruthy();
    expect(screen.queryByTestId('scan-analyze')).toBeNull();
  });

  it('puts a shot straight into the strip and says so', async () => {
    const screen = await openViewfinder();

    await fireEvent.press(screen.getByTestId('scan-shutter'));

    // Same quality the picker was called with, so the encoder sees the same file.
    expect(mockTake).toHaveBeenCalledWith({ quality: 1 });
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    expect(announce).toHaveBeenCalledWith('Photo added, 1 of 3');
    // Still in the viewfinder: another angle is one more shutter press.
    expect(screen.getByTestId('scan-shutter')).toBeTruthy();
  });

  it('stops the shutter at the photo limit', async () => {
    const screen = await openViewfinder();
    for (let i = 0; i < 3; i++) {
      await fireEvent.press(screen.getByTestId('scan-shutter'));
      await waitFor(() => expect(screen.getByTestId(`scan-shot-remove-${i}`)).toBeTruthy());
    }
    expect(screen.getByTestId('scan-shutter').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByText('3 photos is the most for one meal')).toBeTruthy();
  });

  it('analyzes without a note — shutter, Analyze, review', async () => {
    const screen = await openViewfinder();
    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-analyze')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-analyze'));

    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockEncode).toHaveBeenCalledWith('file://shot-1.jpg');
    expect(mockAnalyze).toHaveBeenCalledWith(['b64:file://shot-1.jpg'], expect.any(String), '');
    // The describe step was never visited.
    expect(screen.queryByTestId('scan-note')).toBeNull();
  });

  it('carries a note written from the "Add a note" chip', async () => {
    const screen = await openViewfinder();
    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-add-note')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-add-note'));
    await fireEvent.changeText(screen.getByTestId('scan-note'), 'half a cup of rice');
    await fireEvent.press(screen.getByTestId('scan-analyze'));

    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockAnalyze).toHaveBeenCalledWith(expect.any(Array), expect.any(String), 'half a cup of rice');
  });

  it('adds a library photo to the strip without leaving the viewfinder', async () => {
    mockPick.mockResolvedValue('file://library.jpg');
    const screen = await openViewfinder();

    await fireEvent.press(screen.getByTestId('scan-choose'));

    expect(mockPick).toHaveBeenCalledWith('library');
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    expect(screen.getByTestId('scan-shutter')).toBeTruthy();
  });
});

describe('scan without camera access', () => {
  it('asks the OS on "Take photo" when access was never decided, then opens the camera', async () => {
    mockPerm = { granted: false, canAskAgain: true, status: 'undetermined' };
    mockRequest.mockResolvedValue(GRANTED);
    const screen = await render(<Scan />);
    await waitFor(() => expect(screen.getByTestId('scan-take')).toBeTruthy());
    // No prompt from a screen the user has not acted on yet.
    expect(mockRequest).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('scan-take'));

    expect(mockRequest).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId('scan-shutter')).toBeTruthy());
  });

  it('explains a blocked camera, offers Settings, and keeps the library path', async () => {
    mockPerm = { granted: false, canAskAgain: false, status: 'denied' };
    mockPick.mockResolvedValue('file://library.jpg');
    const screen = await render(<Scan />);
    await waitFor(() => expect(screen.getByTestId('scan-camera-off')).toBeTruthy());
    expect(screen.getByTestId('scan-open-settings')).toBeTruthy();
    expect(screen.queryByTestId('scan-take')).toBeNull();
    expect(screen.queryByTestId('scan-shutter')).toBeNull();

    await fireEvent.press(screen.getByTestId('scan-choose'));
    expect(mockPick).toHaveBeenCalledWith('library');
    // The describe step, as before — Analyze is right there, the note optional.
    await waitFor(() => expect(screen.getByTestId('scan-note')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('scan-analyze'));
    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockAnalyze).toHaveBeenCalledWith(['b64:file://library.jpg'], expect.any(String), '');
  });
});
