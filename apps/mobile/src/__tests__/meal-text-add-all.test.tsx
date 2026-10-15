import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Audit 2026-10-15 #14: "Add all" logged a no-match row as a 0-kcal entry
 * (blank calories were coerced to 0) and dropped any row the draft parser
 * refused, with nothing said either way. A row that needs a number now holds
 * the button and names itself; a decimal comma reads as a decimal.
 */
const mockSearchFoods = jest.fn();
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warning: jest.fn() }));
let mockLocale: string | undefined;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockLocale ? { preferredLocale: mockLocale } : null }),
}));

import { MealText } from '@/components/MealText';

beforeEach(() => {
  mockSearchFoods.mockReset();
  mockSearchFoods.mockResolvedValue([]); // every food a no-match
  mockLocale = undefined;
});

async function review(onAddMany: jest.Mock, text = 'mofongo') {
  const view = await render(<MealText seedText={text} onAddMany={onAddMany} onCancel={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByTestId('mealtext-parse')); });
  await waitFor(() => view.getByTestId('mealtext-add-all'));
  return view;
}

it('does not log a no-match row as 0 kcal — it asks for the number first', async () => {
  const onAddMany = jest.fn();
  const view = await review(onAddMany);
  expect(view.getByTestId('mealtext-needs')).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('mealtext-add-all')); });
  expect(onAddMany).not.toHaveBeenCalled();
});

it('adds once the number is typed, reading a decimal comma in pt-BR', async () => {
  mockLocale = 'pt-BR';
  const onAddMany = jest.fn();
  const view = await review(onAddMany);
  const inputs = view.getAllByPlaceholderText('0');
  await act(async () => { fireEvent.changeText(inputs[0], '350'); });
  await act(async () => { fireEvent.changeText(inputs[1], '12,5'); });
  expect(view.queryByTestId('mealtext-needs')).toBeNull();
  await act(async () => { fireEvent.press(view.getByTestId('mealtext-add-all')); });
  expect(onAddMany).toHaveBeenCalledWith([expect.objectContaining({ calories: 350, protein: 12.5 })]);
});
