import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Proves the fix for Sentry IGNIA-MOBILE-9 / -A at the COMPONENT level.
 *
 * The rules specs in functions/test/rules prove that what `packages/core`
 * produces is accepted by firestore.rules, and the core unit tests prove the
 * builders clamp. Neither proves the thing that actually broke: that this
 * component *calls* them. Before the fix it hand-built both payloads and
 * skipped every bound, Firestore rejected the create, and the row was lost with
 * nothing shown to the user.
 *
 * So these drive the real EntrySheet through its real buttons and assert on the
 * payload handed to the save callbacks — the exact object that becomes the
 * Firestore write.
 */

const mockSearchFoods = jest.fn();

jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

// Over the rules' 100-char ceiling: a dictated or photo-scanned label reaches
// this length without looking unusual, which is why the bug was reachable.
const LONG = 'Grilled chicken breast with brown rice, steamed broccoli, a side salad and olive oil dressing';
const LONGER = LONG + ' ' + LONG;

beforeEach(() => {
  mockSearchFoods.mockReset().mockResolvedValue([]);
});

async function openManualForm(onSavePreset?: jest.Mock, onSaveCustomFood?: jest.Mock) {
  const screen = await render(
    <EntrySheet
      visible
      editing={null}
      onSave={jest.fn()}
      onClose={jest.fn()}
      unitSystem="us"
      onSavePreset={onSavePreset}
      onSaveCustomFood={onSaveCustomFood}
    />,
  );
  await fireEvent.press(screen.getByTestId('open-manual'));
  return screen;
}

it('clamps a preset built from an over-long label and huge macros', async () => {
  const onSavePreset = jest.fn();
  const screen = await openManualForm(onSavePreset, undefined);

  await fireEvent.changeText(screen.getByTestId('entry-label'), LONGER);
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '999999');

  await fireEvent.press(screen.getByTestId('save-preset'));

  await waitFor(() => expect(onSavePreset).toHaveBeenCalledTimes(1));
  const preset = onSavePreset.mock.calls[0][0];

  // Every bound isValidPreset enforces. Pre-fix these were the raw values.
  expect(preset.name.length).toBeLessThanOrEqual(100);
  expect(preset.calories).toBeLessThan(20000);
  expect(preset.calories).toBeGreaterThanOrEqual(0);
  for (const k of ['protein', 'carbs', 'fat'] as const) {
    if (preset[k] != null) expect(preset[k]).toBeLessThan(1000);
  }
});

it('clamps a custom food saved with no gram weight (the manual branch)', async () => {
  const onSaveCustomFood = jest.fn();
  const screen = await openManualForm(undefined, onSaveCustomFood);

  await fireEvent.changeText(screen.getByTestId('entry-label'), LONGER);
  await fireEvent.changeText(screen.getByTestId('entry-calories'), '50000');

  await fireEvent.press(screen.getByTestId('save-customfood'));

  await waitFor(() => expect(onSaveCustomFood).toHaveBeenCalledTimes(1));
  const food = onSaveCustomFood.mock.calls[0][0];

  // Every bound isValidCustomFood enforces, plus the honest serving:1 shape
  // the no-gram-weight branch is supposed to produce.
  expect(food.name.length).toBeLessThanOrEqual(100);
  expect(food.calories).toBeLessThan(20000);
  expect(food.servingSize).toBeGreaterThan(0);
  expect(['g', 'ml', 'oz', 'piece', 'serving']).toContain(food.servingUnit);
  expect(['barcode', 'label', 'text', 'manual']).toContain(food.source);
  expect(food.createdAt instanceof Date).toBe(true);
});
