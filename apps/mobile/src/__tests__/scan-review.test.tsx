import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { ScannedFoodItem } from '@macrolog/core';

/**
 * The scan review's write and its exits — the parts a device run cannot
 * re-check cheaply:
 *
 * - Add shows the SAME receipt every other add surface does (useAddReceipt),
 *   naming the meal and its kcal, before it navigates back to Today.
 * - Retake beside Add asks first: the scan behind it already spent a quota slot.
 * - "Add an item it missed" appends a typed row whose kcal reaches the total.
 * - Every field on the review names itself to a screen reader.
 *
 * Reached through a restored draft, which lands straight in `review` with no
 * camera and no model call — the honest way in for a test.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn() }),
}));

const mockAddEntry = jest.fn(async () => ({ outcome: 'synced', id: 'row1' }));
jest.mock('@/hooks/useToday', () => ({
  useToday: () => ({ addEntry: mockAddEntry, customFoods: [] }),
}));

const mockShowAdded = jest.fn();
jest.mock('@/hooks/useAddReceipt', () => ({
  useAddReceipt: () => ({ showAdded: mockShowAdded, showCopied: jest.fn() }),
}));

const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  confirm: (opts: unknown) => mockConfirm(opts),
}));

jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));

// The model call: imports `firebase/functions`, which jest cannot parse, and is
// never reached from a restored draft anyway.
jest.mock('@/lib/mealScan', () => ({
  analyzeMealPhoto: jest.fn(),
  encodeMealPhoto: jest.fn(),
  pickMealPhoto: jest.fn(),
  scanErrorMessage: () => ({ key: 'scan.failed', params: {} }),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
// The viewfinder is native; jest only needs it to mount. A granted camera also
// pins that a restored review still wins over the open-into-camera default.
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [
    { granted: true, canAskAgain: true, status: 'granted' },
    jest.fn(),
    jest.fn(),
  ],
  CameraView: () => null,
}));

const RICE: ScannedFoodItem = {
  name: 'Rice',
  grams: 150,
  calories: 200,
  protein: 4,
  carbs: 44,
  fat: 0.5,
  confidence: 0.9,
  source: 'usda',
  matchedDescription: 'Rice, white, cooked',
};

jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () => ({
    uid: 'u1',
    atMs: Date.now(),
    items: [RICE],
    mealName: 'Rice',
    portion: 1,
    lowConf: false,
    note: '',
    remaining: 2,
  }),
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));

import Scan from '@/app/(app)/scan';

beforeEach(() => {
  mockReplace.mockClear();
  mockAddEntry.mockClear();
  mockShowAdded.mockClear();
  mockConfirm.mockClear();
});

async function openReview() {
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  return screen;
}

describe('scan review', () => {
  it('shows the add receipt, then returns to Today', async () => {
    const screen = await openReview();

    await fireEvent.press(screen.getByTestId('scan-add'));

    expect(mockAddEntry).toHaveBeenCalledTimes(1);
    expect(mockShowAdded).toHaveBeenCalledWith(
      { outcome: 'synced', id: 'row1' },
      { label: 'Rice', calories: 200 },
    );
    expect(mockReplace).toHaveBeenCalledWith('/(app)');
    // Receipt first: the replace must not be what decides whether it shows.
    expect(mockShowAdded.mock.invocationCallOrder[0]).toBeLessThan(
      mockReplace.mock.invocationCallOrder[0],
    );
  });

  it('says a review was restored, offers a plain Discard, and keeps its first save time', async () => {
    // A review left with Back keeps its draft; it used to come back on every
    // "Scan meal" with no notice, re-stamped so it never expired.
    const { saveScanDraft } = jest.requireMock('@/lib/scan-draft') as { saveScanDraft: jest.Mock };
    const screen = await openReview();
    expect(screen.getByTestId('scan-restored')).toBeTruthy();
    await fireEvent.press(screen.getByTestId('scan-discard-restored'));
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ destructive: true }));
    // Any re-save carries the ORIGINAL timestamp, never "now".
    for (const [d] of saveScanDraft.mock.calls as [{ atMs: number }][]) {
      expect(d.atMs).toBeLessThanOrEqual(Date.now());
    }
  });

  it('confirms before Retake throws a charged scan away', async () => {
    const screen = await openReview();

    await fireEvent.press(screen.getByTestId('scan-retake'));
    expect(mockConfirm).toHaveBeenCalledTimes(1);
    // Nothing discarded until the user says so.
    expect(screen.getByTestId('scan-add')).toBeTruthy();

    await act(async () => {
      (mockConfirm.mock.calls[0][0] as { onConfirm: () => void }).onConfirm();
    });
    expect(screen.queryByTestId('scan-add')).toBeNull();
  });

  it('adds a missed item whose typed kcal reaches the total', async () => {
    const screen = await openReview();

    await fireEvent.press(screen.getByTestId('scan-add-item'));
    await fireEvent.changeText(screen.getByTestId('scan-item-name-1'), 'Beans');
    await fireEvent.changeText(screen.getByTestId('scan-item-kcal-1'), '120');
    await fireEvent.changeText(screen.getByTestId('scan-item-protein-1'), '7');

    await fireEvent.press(screen.getByTestId('scan-add'));
    expect(mockAddEntry).toHaveBeenCalledWith(
      expect.objectContaining({ calories: 320, protein: 11 }),
    );
  });

  it('gives an added row no grams field, and keeps a typed decimal point', async () => {
    // With a grams field, typing 150 g after 200 kcal rescaled per keystroke
    // from a 1 g basis — 200 → 3,000 → 30,000 kcal (re-score, 2026-10-04).
    const screen = await openReview();
    await fireEvent.press(screen.getByTestId('scan-add-item'));
    expect(screen.queryByTestId('scan-item-grams-1')).toBeNull();
    expect(screen.getByTestId('scan-item-grams-0')).toBeTruthy();

    await fireEvent.changeText(screen.getByTestId('scan-item-protein-1'), '12.');
    expect(screen.getByTestId('scan-item-protein-1').props.value).toBe('12.');
  });

  it('labels every field and names the item on its remove button', async () => {
    const screen = await openReview();

    expect(screen.getByLabelText('Meal name')).toBeTruthy();
    expect(screen.getByLabelText('Name of item 1')).toBeTruthy();
    expect(screen.getByLabelText('Grams of Rice')).toBeTruthy();
    expect(screen.getByLabelText('Remove Rice')).toBeTruthy();
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });
});
