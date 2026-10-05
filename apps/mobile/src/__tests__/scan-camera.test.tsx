import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * The in-app viewfinder, and the tap count it exists for: shutter → Add (S20 —
 * the first shot is analyzed straight away, Cancel on the wait is its undo),
 * with no system camera, no "Use Photo" confirm and no describe step for a
 * plate with nothing to say about it.
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
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o), ConfirmHost: () => null }));
// Online unless a test says otherwise (U9).
let mockOffline = false;
jest.mock('@/lib/connectivity', () => ({
  isOffline: () => mockOffline,
  useIsOffline: () => mockOffline,
}));
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

import Scan from '@/app/scan';

const GRANTED: Perm = { granted: true, canAskAgain: true, status: 'granted' };

let announce: jest.SpyInstance;
beforeEach(() => {
  mockShot = 0;
  mockOffline = false;
  mockConfirm.mockReset();
  mockReplace.mockReset();
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
  // Presented as a root-stack fullScreenModal, a native `SafeAreaView` read a
  // 0 top inset on iOS and the header drew under the status bar, where Back
  // cannot be tapped (Maestro 06, 2026-10-04). The pad comes from the
  // provider's window insets now — test-utils pins top: 47.
  it('pads the header below the status bar from the window inset', async () => {
    const screen = await openViewfinder();
    const style = [screen.getByTestId('scan-screen').props.style].flat(3);
    expect(style).toEqual(expect.arrayContaining([expect.objectContaining({ paddingTop: 47 })]));
  });

  it('opens straight into the camera when access is already granted', async () => {
    const screen = await openViewfinder();
    expect(screen.queryByTestId('scan-take')).toBeNull();
    // Labelled, and the only way to Analyze is to have a photo first.
    expect(screen.getByLabelText('Take photo')).toBeTruthy();
    expect(screen.queryByTestId('scan-analyze')).toBeNull();
  });

  it('analyzes the first shot straight away — shutter, then review', async () => {
    const screen = await openViewfinder();

    await fireEvent.press(screen.getByTestId('scan-shutter'));

    // Same quality the picker was called with, so the encoder sees the same file.
    expect(mockTake).toHaveBeenCalledWith({ quality: 1 });
    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockEncode).toHaveBeenCalledWith('file://shot-1.jpg');
    expect(mockAnalyze).toHaveBeenCalledWith(['b64:file://shot-1.jpg'], expect.any(String), '');
    // No Analyze tap, and the describe step was never visited.
    expect(screen.queryByTestId('scan-note')).toBeNull();
  });

  it('collects a shot after a library pick in the strip, and Analyze sends both', async () => {
    mockPick.mockResolvedValue('file://library.jpg');
    const screen = await openViewfinder();
    await fireEvent.press(screen.getByTestId('scan-choose'));
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-1')).toBeTruthy());
    expect(announce).toHaveBeenCalledWith('Photo added, 2 of 3');
    expect(mockAnalyze).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('scan-analyze'));
    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockAnalyze).toHaveBeenCalledWith(
      ['b64:file://library.jpg', 'b64:file://shot-1.jpg'],
      expect.any(String),
      '',
    );
  });

  it('stops the shutter at the photo limit', async () => {
    mockPick.mockResolvedValue('file://library.jpg');
    const screen = await openViewfinder();
    await fireEvent.press(screen.getByTestId('scan-choose'));
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    for (let i = 1; i < 3; i++) {
      await fireEvent.press(screen.getByTestId('scan-shutter'));
      await waitFor(() => expect(screen.getByTestId(`scan-shot-remove-${i}`)).toBeTruthy());
    }
    expect(screen.getByTestId('scan-shutter').props.accessibilityState).toEqual(
      expect.objectContaining({ disabled: true }),
    );
    expect(screen.getByText('3 photos is the most for one meal')).toBeTruthy();
  });

  it('carries a note written BEFORE the shot, from the "Add a note" chip', async () => {
    const screen = await openViewfinder();
    // The chip is there with no photo yet — the shot that follows is sent at once.
    await fireEvent.press(screen.getByTestId('scan-add-note'));
    await fireEvent.changeText(screen.getByTestId('scan-note'), 'half a cup of rice');
    await fireEvent.press(screen.getByTestId('scan-note-done'));
    await waitFor(() => expect(screen.getByTestId('scan-shutter')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-shutter'));

    await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
    expect(mockAnalyze).toHaveBeenCalledWith(expect.any(Array), expect.any(String), 'half a cup of rice');
  });

  it('cancels a slow reading and puts the photo back in the strip (U9)', async () => {
    let finish: (v: unknown) => void = () => {};
    mockAnalyze.mockReturnValue(new Promise((r) => (finish = r)));
    const screen = await openViewfinder();

    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-cancel')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('scan-cancel'));

    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    expect(screen.getByTestId('scan-analyze')).toBeTruthy();
    // The answer for the cancelled run arrives late and is dropped.
    await act(async () => {
      finish({ items: [{ name: 'Rice', grams: 150, calories: 200, protein: 4, carbs: 44, fat: 0.5, confidence: 0.9, source: 'usda' }], confidence: 'high' });
    });
    expect(screen.queryByTestId('scan-add')).toBeNull();
  });

  it('says it is offline before the shot, keeps the photo, and offers the search (U9)', async () => {
    mockOffline = true;
    const screen = await openViewfinder();
    expect(screen.getByText(/offline/i)).toBeTruthy();

    await fireEvent.press(screen.getByTestId('scan-shutter'));

    // No encode, no model call: the photo waits in the strip.
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    expect(mockEncode).not.toHaveBeenCalled();
    expect(mockAnalyze).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('scan-search-instead'));
    expect(mockReplace).toHaveBeenCalledWith({ pathname: '/(app)', params: { openAdd: expect.any(String) } });
  });

  it('takes another angle from the review, asking first (it re-reads every photo)', async () => {
    const screen = await openViewfinder();
    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-add-angle')).toBeTruthy());

    await fireEvent.press(screen.getByTestId('scan-add-angle'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Add another angle?' }));
    await act(async () => (mockConfirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm());

    // Back in the viewfinder with the first photo kept; the next shot joins it.
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-0')).toBeTruthy());
    await fireEvent.press(screen.getByTestId('scan-shutter'));
    await waitFor(() => expect(screen.getByTestId('scan-shot-remove-1')).toBeTruthy());
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
