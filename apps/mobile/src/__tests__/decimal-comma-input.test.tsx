import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { numOrUndef } from '@/components/train/train-shared';

/**
 * A comma is a decimal point in every screen-local number parser.
 *
 * The app ships pt-BR, and a Brazilian keyboard (or an iOS decimal pad under a
 * Brazilian region) types `12,5`. `Number('12,5')` is NaN, so the meal sheet's
 * Save greyed out with nothing explaining why, a macro typed with a comma was
 * silently dropped from the entry, and the template editor read a `22,5` row
 * as empty. Core's unit parsers already normalised the comma; the local
 * parsers in the screens did not. This pins the sheet end-to-end (the payload
 * handed to `onSave` is the Firestore write) and the shared train parser.
 */

const mockSearchFoods = jest.fn();
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));

import { EntrySheet } from '@/components/EntrySheet';

beforeEach(() => {
  mockSearchFoods.mockReset().mockResolvedValue([]);
});

describe('EntrySheet manual form', () => {
  it('saves a comma-decimal macro as the number it means', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} unitSystem="metric" />,
    );
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '250');
    await fireEvent.changeText(screen.getByTestId('entry-fat'), '12,5');
    await fireEvent.press(screen.getByTestId('entry-save'));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0]).toMatchObject({ calories: 250, fat: 12.5 });
  });

  it('lets a comma-decimal calorie count save at all', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} unitSystem="metric" />,
    );
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '250,5');
    // Before the fix `canSave` was false here and the button was disabled.
    expect(screen.getByTestId('entry-save').props.accessibilityState?.disabled).not.toBe(true);
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].calories).toBe(250.5);
  });

  it('drops a negative macro instead of writing it', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <EntrySheet visible editing={null} onSave={onSave} onClose={jest.fn()} unitSystem="us" />,
    );
    await fireEvent.press(screen.getByTestId('open-manual'));
    await fireEvent.changeText(screen.getByTestId('entry-calories'), '300');
    await fireEvent.changeText(screen.getByTestId('entry-protein'), '-5');
    await fireEvent.press(screen.getByTestId('entry-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].protein).toBeUndefined();
  });
});

describe('train-shared numOrUndef', () => {
  it('reads a comma as the decimal point', () => {
    expect(numOrUndef('7,5')).toBe(7.5);
    expect(numOrUndef(' 12,25 ')).toBe(12.25);
  });
  it('still treats blank as not entered and rejects a negative count', () => {
    expect(numOrUndef('')).toBeUndefined();
    expect(numOrUndef('   ')).toBeUndefined();
    expect(numOrUndef('-3')).toBeUndefined();
    expect(numOrUndef('abc')).toBeUndefined();
  });
});
