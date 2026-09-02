import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * The manual form reconciles calories against macros and SAYS so — a note,
 * never a block. 240 kcal with P16/C40/F20 (404 kcal by Atwater) saved
 * silently on 2026-08-31; the same numbers now print a note and the Save
 * button stays enabled.
 */

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn().mockResolvedValue([]),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

async function openManual() {
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  return screen;
}

it('notes a calorie figure the macros do not support, and still allows saving', async () => {
  const screen = await openManual();
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '240');
  await fireEvent.changeText(screen.getByTestId('entry-protein'), '16');
  await fireEvent.changeText(screen.getByTestId('entry-carbs'), '40');
  await fireEvent.changeText(screen.getByTestId('entry-fat'), '20');

  expect(screen.getByTestId('entry-macro-note').props.children).toContain('404');
  expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled ?? false).toBe(false);
});

it('stays quiet when the numbers agree, and for a protein-only entry', async () => {
  const screen = await openManual();
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '240');
  await fireEvent.changeText(screen.getByTestId('entry-protein'), '3');
  await fireEvent.changeText(screen.getByTestId('entry-carbs'), '25');
  await fireEvent.changeText(screen.getByTestId('entry-fat'), '15');
  expect(screen.queryByTestId('entry-macro-note')).toBeNull();

  await fireEvent.changeText(screen.getByTestId('entry-carbs'), '');
  await fireEvent.changeText(screen.getByTestId('entry-fat'), '');
  await fireEvent.changeText(screen.getByTestId('entry-protein'), '45');
  expect(screen.queryByTestId('entry-macro-note')).toBeNull();
});
