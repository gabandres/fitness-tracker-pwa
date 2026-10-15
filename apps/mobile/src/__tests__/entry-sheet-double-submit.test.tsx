import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Audit 2026-10-15 (final report): a fast double tap on Add, or on a one-tap
 * row, wrote the entry TWICE — the native sheet stays up through its dismiss
 * animation, and nothing downstream dedupes. The sheet now saves once per
 * open; reopening it re-arms.
 */
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn(async () => []),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('expo-router', () => ({ router: { navigate: jest.fn() } }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
jest.mock('@/components/Toast', () => ({ showToast: jest.fn(), ToastSheetHost: () => null }));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn() }));

import { EntrySheet } from '@/components/EntrySheet';

it('a double tap on Add saves once', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
  await fireEvent.press(screen.getByTestId('open-manual'));
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '400');
  const save = screen.getByTestId('entry-save');
  await fireEvent.press(save);
  await fireEvent.press(save);
  expect(onSave).toHaveBeenCalledTimes(1);
});

it('a double tap on a one-tap row logs once, and reopening re-arms', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const screen = await render(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
  await fireEvent.changeText(screen.getByTestId('food-search-input'), '350');
  const row = await waitFor(() => screen.getByTestId('search-quick-add'));
  await fireEvent.press(row);
  await fireEvent.press(row);
  expect(onSave).toHaveBeenCalledTimes(1);

  await screen.rerender(<EntrySheet visible={false} editing={null} onSave={onSave} onClose={jest.fn()} />);
  await screen.rerender(<EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} />);
  await fireEvent.changeText(screen.getByTestId('food-search-input'), '200');
  await fireEvent.press(await waitFor(() => screen.getByTestId('search-quick-add')));
  expect(onSave).toHaveBeenCalledTimes(2);
});
