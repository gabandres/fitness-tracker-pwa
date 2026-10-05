import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Android back inside the add sheet (S20, measured 2026-10-05 on the OnePlus
 * 8T). The native Material sheet dismisses on back unless its owner says back
 * is a step — `backSteps` — and then routes it to `onRequestClose('back')`.
 * The form and the recipe modes said so; the search's portion picker, a step
 * INSIDE browse, did not, so back from "Chicken, ground, raw" closed the whole
 * sheet instead of returning to the results.
 */

const mockSearchFoods = jest.fn();
// Records what the sheet is told, and draws it in place (the JS sheet).
const mockSheetProps: { backSteps?: boolean }[] = [];
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual<typeof import('@/components/BottomSheet')>('@/components/BottomSheet');
  return {
    ...actual,
    BottomSheet: (props: Parameters<typeof actual.BottomSheet>[0]) => {
      mockSheetProps.push({ backSteps: props.backSteps });
      return actual.BottomSheet({ ...props, native: false });
    },
  };
});
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
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

const chickenHit = {
  source: 'usda',
  id: 'c1',
  description: 'Chicken, ground, raw',
  dataType: 'sr_legacy',
  // Two portions, so the pick opens the picker (one skips it).
  servings: [
    { label: '4 oz crumbled (113 g)', grams: 113, kcal: 162, protein: 20, carbs: 0, fat: 9, kind: 'portion' },
    { label: '100 g', grams: 100, kcal: 143, protein: 17, carbs: 0, fat: 8, kind: 'per100g' },
  ],
};

const backSteps = () => mockSheetProps[mockSheetProps.length - 1]?.backSteps;

beforeEach(() => {
  mockSheetProps.length = 0;
  mockSearchFoods.mockReset().mockResolvedValue([chickenHit]);
});

it('tells the sheet back is a step while the portion picker is up, and not after', async () => {
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />,
  );
  await fireEvent.changeText(screen.getByTestId('food-search-input'), 'chicken');
  await waitFor(() => screen.getByText('Chicken, ground, raw'));
  expect(backSteps()).toBe(false);

  await fireEvent.press(screen.getByText('Chicken, ground, raw'));
  expect(screen.getByTestId('portion-back')).toBeTruthy();
  expect(backSteps()).toBe(true);

  await fireEvent.press(screen.getByTestId('portion-back'));
  expect(backSteps()).toBe(false);
});

it('stays a step on the review form a portion leads to', async () => {
  const screen = await render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} />,
  );
  await fireEvent.changeText(screen.getByTestId('food-search-input'), 'chicken');
  await fireEvent.press(await waitFor(() => screen.getByText('Chicken, ground, raw')));
  await fireEvent.press(screen.getByTestId('portion-0'));
  expect(backSteps()).toBe(true);

  // Back on browse, with the picker unmounted along the way: nothing to step.
  await fireEvent.press(screen.getByTestId('custom-back'));
  expect(backSteps()).toBe(false);
});
