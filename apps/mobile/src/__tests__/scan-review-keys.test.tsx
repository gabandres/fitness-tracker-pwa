import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { ScannedFoodItem } from '@macrolog/core';

/**
 * Two scan-review fixes from the add-meal re-score:
 *
 * - Bug 2: a review row is keyed on an id minted when it joins the list, not
 *   on `fdcId ?? name`. A model estimate has no `fdcId`, so every keystroke
 *   in its name field changed the key, remounted the row and dropped the
 *   keyboard after one letter — "add the beans it missed" could not be typed.
 * - Bug 4: Add waits a bounded time for the write. A slow one lets the screen
 *   go back to Today and the receipt reports when it lands.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: mockReplace, back: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
}));
const mockAddEntry = jest.fn();
jest.mock('@/hooks/useToday', () => ({ useToday: () => ({ addEntry: mockAddEntry, customFoods: [] }) }));
const mockShowAdded = jest.fn();
jest.mock('@/hooks/useAddReceipt', () => ({ useAddReceipt: () => ({ showAdded: mockShowAdded }) }));
const mockShowToast = jest.fn();
jest.mock('@/components/Toast', () => ({ showToast: (...a: unknown[]) => mockShowToast(...a) }));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn(), ConfirmHost: () => null }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/lib/mealScan', () => ({
  analyzeMealPhoto: jest.fn(),
  encodeMealPhoto: jest.fn(),
  pickMealPhoto: jest.fn(),
  scanErrorMessage: () => ({ key: 'scan.failed', params: {} }),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn(), jest.fn()],
  CameraView: () => null,
}));

// A model estimate: no `fdcId`, which is what made the old key unstable.
const MOFONGO: ScannedFoodItem = {
  name: 'Mofongo',
  grams: 250,
  calories: 480,
  protein: 9,
  carbs: 60,
  fat: 22,
  confidence: 0.6,
  source: 'model',
};
jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () => ({
    uid: 'u1',
    atMs: Date.now(),
    items: [MOFONGO],
    mealName: 'Mofongo',
    portion: 1,
    lowConf: false,
    note: '',
    remaining: 2,
  }),
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));

import Scan from '@/app/scan';

beforeEach(() => {
  mockReplace.mockClear();
  mockShowAdded.mockClear();
  mockShowToast.mockClear();
  mockAddEntry.mockReset().mockResolvedValue({ outcome: 'logged', id: 'row1' });
});

async function openReview() {
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  return screen;
}

it('keeps the row (and its field) mounted while its name is typed', async () => {
  const screen = await openReview();
  const before = screen.getByTestId('scan-item-name-0');
  await fireEvent.changeText(before, 'M');
  await fireEvent.changeText(screen.getByTestId('scan-item-name-0'), 'Mo');
  const after = screen.getByTestId('scan-item-name-0');
  expect(after.props.value).toBe('Mo');
  // The same host instance — a remount would hand back a new one.
  expect(after).toBe(before);
});

it('keeps an added row mounted while its name is typed', async () => {
  const screen = await openReview();
  await fireEvent.press(screen.getByTestId('scan-add-item'));
  const before = screen.getByTestId('scan-item-name-1');
  await fireEvent.changeText(before, 'B');
  await fireEvent.changeText(screen.getByTestId('scan-item-name-1'), 'Be');
  expect(screen.getByTestId('scan-item-name-1')).toBe(before);
});

it('goes back to Today after the bounded wait when the write is slow, and the receipt follows', async () => {
  let land: (v: unknown) => void = () => {};
  mockAddEntry.mockImplementationOnce(() => new Promise((r) => (land = r)));
  const screen = await openReview();
  await fireEvent.press(screen.getByTestId('scan-add'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalledWith('/(app)'), { timeout: 4000 });
  expect(mockShowAdded).not.toHaveBeenCalled();
  await act(async () => land({ outcome: 'queued', id: 'row1' }));
  await waitFor(() => expect(mockShowAdded).toHaveBeenCalledWith({ outcome: 'queued', id: 'row1' }, { label: 'Mofongo', calories: 480 }));
});

it('says a slow write the rules refused, with a way back to the review', async () => {
  let land: (v: unknown) => void = () => {};
  mockAddEntry.mockImplementationOnce(() => new Promise((r) => (land = r)));
  const { clearScanDraft } = jest.requireMock('@/lib/scan-draft') as { clearScanDraft: jest.Mock };
  clearScanDraft.mockClear();
  const screen = await openReview();
  await fireEvent.press(screen.getByTestId('scan-add'));
  await waitFor(() => expect(mockReplace).toHaveBeenCalled(), { timeout: 4000 });
  await act(async () => land({ outcome: 'rejected', id: 'row1' }));
  await waitFor(() => expect(mockShowToast).toHaveBeenCalled());
  expect(mockShowToast.mock.calls[0][1]).toMatchObject({ testID: 'toast-rejected', action: expect.any(Object) });
  // The draft stays on disk — it is what the action reopens.
  expect(clearScanDraft).not.toHaveBeenCalled();
});
