import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * Photo scan needs a door you can SEE. Since the + went tap-to-search
 * (UX_AUDIT S18-18) the only other way to the camera was a long-press on it,
 * and the owner could not find it (2026-10-04). The sheet's "More ways" list
 * now carries "Scan meal" — on Today only, because the scan screen logs to
 * today and would misdate a past day's meal.
 */

const mockNavigate = jest.fn();
// iOS presents this sheet natively, through a route this test does not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => mockNavigate(...a) } }));
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn(async () => []),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

beforeEach(() => mockNavigate.mockClear());

it('More ways → Scan meal closes the sheet and opens the camera', async () => {
  const onClose = jest.fn();
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={onClose} unitSystem="us" />,
  );
  await fireEvent.press(screen.getByTestId('open-more'));
  expect(screen.getByText('Scan meal')).toBeTruthy();
  await fireEvent.press(screen.getByTestId('open-scan'));
  expect(onClose).toHaveBeenCalled();
  expect(mockNavigate).toHaveBeenCalledWith('/scan');
});

it('is not offered when adding to a past day', async () => {
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" dateKey="2026-10-01" />,
  );
  await fireEvent.press(screen.getByTestId('open-more'));
  expect(screen.getByTestId('open-barcode')).toBeTruthy();
  expect(screen.queryByTestId('open-scan')).toBeNull();
});
