import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Two things the typed-meal flow has to get right, and did not.
 *
 * 1. **Echo the reading back.** The photo-scan flow shows what it understood
 *    before it writes anything, and that is most of why it feels trustworthy.
 *    The typed flow resolved straight to numbers, so a user who wrote
 *    "2 tbsp peanut butter" saw a row labelled "peanut butter · ≈32 g" with no
 *    confirmation the *2 tbsp* had registered at all.
 *
 * 2. **Fall through to a food that can answer the unit.** The best-ranked
 *    generic entry is often the one with no portion table — 37% of Foundation
 *    foods carry one, against 99% of FNDDS — so the top hit frequently cannot
 *    say what a cup weighs, and the answer silently degrades to a guess.
 */

const mockSearchFoods = jest.fn();
const mockGetFoodDetail = jest.fn();

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: (...a: unknown[]) => mockGetFoodDetail(...a),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

import { MealText } from '@/components/MealText';

const PER_100 = { label: '100 g', grams: 100, kcal: 588, protein: 25, carbs: 20, fat: 50, kind: 'per100g' as const };
const TBSP = { label: '1 tablespoon (16 g)', grams: 16, kcal: 94, protein: 4, carbs: 3.2, fat: 8, kind: 'portion' as const };

function hit(id: string, dataType: string) {
  return { source: 'fdc', id, dataType, description: id };
}

function setup(seedText: string) {
  return render(<MealText seedText={seedText} onAddMany={jest.fn()} onCancel={jest.fn()} />);
}

beforeEach(() => {
  mockSearchFoods.mockReset();
  mockGetFoodDetail.mockReset();
});

it('echoes what it read, and resolves the tablespoon from the food', async () => {
  mockSearchFoods.mockResolvedValue([hit('peanut butter', 'Survey (FNDDS)')]);
  mockGetFoodDetail.mockResolvedValue({ servings: [PER_100, TBSP] });

  const { getByTestId, getByText } = await setup('2 tbsp peanut butter');
  await act(async () => { fireEvent.press(getByTestId('mealtext-parse')); });

  await waitFor(() => getByText('We read: 2 tbsp peanut butter'));
  // 2 x the 16 g tablespoon row — not 2 x 100 g, and not one tablespoon.
  getByText('≈32 g · 1 tablespoon (16 g)');
});

it('says nothing when echoing would only repeat the food name', async () => {
  mockSearchFoods.mockResolvedValue([hit('peanut butter', 'Survey (FNDDS)')]);
  mockGetFoodDetail.mockResolvedValue({ servings: [PER_100, TBSP] });

  const { getByTestId, queryByText } = await setup('peanut butter');
  await act(async () => { fireEvent.press(getByTestId('mealtext-parse')); });

  await waitFor(() => expect(queryByText(/≈/)).not.toBeNull());
  expect(queryByText(/We read:/)).toBeNull();
});

it('falls through to a food that can answer the unit', async () => {
  // Foundation ranks first and has only a per-100 g row, so it cannot say what
  // a cup weighs; FNDDS ranks second and can.
  mockSearchFoods.mockResolvedValue([
    hit('rice-fndds', 'Survey (FNDDS)'),
    hit('rice-foundation', 'Foundation'),
  ]);
  mockGetFoodDetail.mockImplementation((_source: string, id: string) =>
    Promise.resolve(
      id === 'rice-foundation'
        ? { servings: [{ label: '100 g', grams: 100, kcal: 370, protein: 7, carbs: 80, fat: 1, kind: 'per100g' }] }
        : {
          servings: [
            { label: '100 g', grams: 100, kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, kind: 'per100g' },
            { label: '1 cup, cooked (158 g)', grams: 158, kcal: 205, protein: 4.3, carbs: 45, fat: 0.4, kind: 'portion' },
          ],
        },
    ),
  );

  const { getByTestId, getByText, queryByText } = await setup('1 cup white rice');
  await act(async () => { fireEvent.press(getByTestId('mealtext-parse')); });

  // Foundation is asked first (it ranks higher) and rejected for being unable
  // to answer, rather than resolved to a density guess.
  await waitFor(() => getByText('≈158 g · 1 cup, cooked (158 g)'));
  expect(mockGetFoodDetail).toHaveBeenCalledWith('fdc', 'rice-foundation');
  expect(queryByText(/Assumed portion/)).toBeNull();
});
