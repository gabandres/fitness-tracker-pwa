import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * The nutrition-label scan (2026-11-20): a photo of a label fills the review
 * form. Two layers — the flow (`lib/labelScan.ts`) against a faked camera and
 * callable, and the entry sheet's door against a faked flow.
 */

const mockPick = jest.fn();
const mockEncode = jest.fn();
const mockCall = jest.fn();
const mockSearchFoods = jest.fn();

jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: (...a: unknown[]) => mockSearchFoods(...a),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn(), selection: jest.fn(), tapThenOutcome: jest.fn(), removed: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/components/BarcodeScanner', () => ({ BarcodeScanner: () => null }));
jest.mock('@/lib/firebase', () => ({ functions: {}, db: {}, auth: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => (data: unknown) => mockCall(data) }));
jest.mock('@/lib/mealScan', () => ({
  ...jest.requireActual('@/lib/mealScan'),
  pickMealPhoto: (...a: unknown[]) => mockPick(...a),
  encodeMealPhoto: (...a: unknown[]) => mockEncode(...a),
}));

import { EntrySheet } from '@/components/EntrySheet';
import { labelEstimate, labelFactsOf, scanLabel } from '@/lib/labelScan';

const panel = { name: 'Greek Yogurt, Plain', brand: 'Kirkland', servingText: '3/4 cup (170g)', servingGrams: 170, calories: 100, protein: 18, carbs: 6, fat: 0 };

beforeEach(() => {
  mockSearchFoods.mockReset().mockResolvedValue([]);
  mockPick.mockReset().mockResolvedValue('file://label.jpg');
  mockEncode.mockReset().mockResolvedValue('BASE64');
  mockCall.mockReset().mockResolvedValue({ data: { label: panel, photosRemaining: 2 } });
});

describe('the flow', () => {
  it('photographs, encodes and asks for a LABEL read of that one photo', async () => {
    const reading = jest.fn();
    const out = await scanLabel('en', reading);
    expect(mockPick).toHaveBeenCalledWith('camera');
    expect(mockCall).toHaveBeenCalledWith({ photoBase64: 'BASE64', mode: 'label', locale: 'en' });
    expect(reading).toHaveBeenCalledTimes(1);
    expect(out).toEqual({ kind: 'label', facts: panel });
  });

  it('says nothing when the camera was closed without a photo, and reads nothing', async () => {
    mockPick.mockResolvedValue(null);
    const reading = jest.fn();
    expect(await scanLabel('en', reading)).toEqual({ kind: 'cancelled' });
    expect(reading).not.toHaveBeenCalled();
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('reports a refused camera as denied', async () => {
    mockPick.mockResolvedValue({ denied: true, canAskAgain: false });
    expect(await scanLabel('en', jest.fn())).toEqual({ kind: 'denied' });
  });

  it('a photo with no panel is "none", not an error', async () => {
    mockCall.mockResolvedValue({ data: { label: null, photosRemaining: 1 } });
    expect(await scanLabel('en', jest.fn())).toEqual({ kind: 'none' });
  });

  it('never throws: a used-up day reads as the quota sentence, a failed read as the label sentence', async () => {
    mockCall.mockRejectedValue({ code: 'functions/resource-exhausted', details: { code: 'PHOTO_QUOTA_EXCEEDED', limit: 3 } });
    expect(await scanLabel('en', jest.fn())).toEqual({ kind: 'error', message: { key: 'scan.errQuota', params: { n: 3 } } });
    mockCall.mockRejectedValue({ code: 'functions/internal', details: { code: 'PHOTO_ANALYZE_FAILED' } });
    expect(await scanLabel('en', jest.fn())).toEqual({ kind: 'error', message: { key: 'label.failed' } });
    mockEncode.mockResolvedValue(null);
    expect(await scanLabel('en', jest.fn())).toEqual({ kind: 'error', message: { key: 'label.failed' } });
  });

  it('refuses an answer it does not recognise', () => {
    expect(labelFactsOf(null)).toBeNull();
    expect(labelFactsOf({ name: 'x' })).toBeNull();
    expect(labelFactsOf({ calories: 'many' })).toBeNull();
    expect(labelFactsOf({ calories: 100, protein: -1, check: true })).toEqual({ name: '', calories: 100, check: true });
  });

  it('hands the form a label-sourced food, with its grams and the barcode it started from', () => {
    expect(labelEstimate(panel, 'Packaged food', '0123456789012')).toEqual({
      calories: 100,
      protein: 18,
      carbs: 6,
      fat: 0,
      mealLabel: 'Greek Yogurt, Plain',
      serving: { source: 'label', name: 'Greek Yogurt, Plain', grams: 170, brand: 'Kirkland', barcode: '0123456789012' },
    });
    expect(labelEstimate({ name: '', calories: 190 }, 'Packaged food').mealLabel).toBe('Packaged food');
  });
});

describe("the entry sheet's door", () => {
  const setup = () => render(<EntrySheet visible editing={null} onSave={jest.fn()} onClose={jest.fn()} unitSystem="us" />);

  async function scanFromMore(screen: Awaited<ReturnType<typeof setup>>) {
    await fireEvent.press(screen.getByTestId('open-more'));
    await act(async () => {
      await fireEvent.press(screen.getByTestId('open-label'));
    });
  }

  it('opens the review form on what the label says, and asks for a check against the package', async () => {
    const screen = await setup();
    await scanFromMore(screen);
    await waitFor(() => expect(screen.getByTestId('entry-label').props.value).toBe('Greek Yogurt, Plain'));
    expect(screen.getByTestId('label-note')).toHaveTextContent(/Read from the label\. Compare the numbers with the package/);
  });

  it('says so plainly when the read does not add up', async () => {
    mockCall.mockResolvedValue({ data: { label: { ...panel, calories: 1000, check: true } } });
    const screen = await setup();
    await scanFromMore(screen);
    await waitFor(() => expect(screen.getByTestId('label-note')).toHaveTextContent(/do not add up/));
  });

  it('stays on the search and says why when no label could be read', async () => {
    mockCall.mockResolvedValue({ data: { label: null } });
    const screen = await setup();
    await scanFromMore(screen);
    await waitFor(() => expect(screen.getByTestId('label-notice')).toHaveTextContent(/Couldn't read a nutrition label/));
    expect(screen.queryByTestId('label-note')).toBeNull();
  });

  it('a closed camera leaves the sheet as it was', async () => {
    mockPick.mockResolvedValue(null);
    const screen = await setup();
    await scanFromMore(screen);
    expect(screen.queryByTestId('label-notice')).toBeNull();
    expect(screen.queryByTestId('label-reading')).toBeNull();
  });
});
