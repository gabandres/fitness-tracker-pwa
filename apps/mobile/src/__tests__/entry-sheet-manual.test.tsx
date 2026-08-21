import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Manual food entry must be reachable without scrolling and without losing
 * typed text.
 *
 * Both routes here used to be dead ends. "Create custom food" was the last
 * element of the browse list, under Recent + My Foods + Quick add — and the
 * latter two are uncapped, so it sank as the user saved foods. Typing removed
 * it altogether, because the browse list only renders in the search's idle
 * phase, and a miss offered nothing but "try a simpler term". See
 * docs/research/mobile-manual-food-entry.md.
 */

const mockSearchFoods = jest.fn();

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  // FoodSearch warms the bundled on-device index on mount (Tier D). A partial
  // module mock leaves this undefined, which throws inside the effect.
  warmFoodIndex: jest.fn(),
}));

jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));

// I18nProvider reads the profile through auth, which boots the Firebase SDK.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

function setup() {
  return render(
    <EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" />,
  );
}

beforeEach(() => {
  mockSearchFoods.mockReset().mockResolvedValue([]);
});

it('opens the manual form from the header, with no scrolling and no search', async () => {
  const screen = await setup();

  await fireEvent.press(screen.getByTestId('open-manual'));

  // The manual form's name field is the proof we switched surfaces.
  expect(screen.getByTestId('entry-label')).toBeTruthy();
});

it('offers to create the food when a search finds nothing, keeping what was typed', async () => {
  const screen = await setup();

  await fireEvent.changeText(screen.getByTestId('food-search-input'), "abuela's arroz");

  const create = await waitFor(() => screen.getByTestId('create-from-query'));
  await fireEvent.press(create);

  // The typed query becomes the food's name — retyping it would be pure loss.
  expect(screen.getByTestId('entry-label').props.value).toBe("abuela's arroz");
});
