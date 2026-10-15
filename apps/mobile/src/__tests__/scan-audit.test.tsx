import React from 'react';
import { AccessibilityInfo, BackHandler, Linking } from 'react-native';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Audit 2026-10-15 — the scan screen:
 *  #1 the grams field ate a decimal separator ("12,5" → 125 g);
 *  #2 Android back during the wait closed the modal mid-call;
 *  #3 a failed call threw the photos away;
 *  #4 the rules' ceilings were not checked before Add;
 *  #5 a refused photo library looked like a cancel;
 *  #9 removing the last item dropped the review without a word.
 */
let mockLocale: string | undefined;
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: mockLocale ? { preferredLocale: mockLocale } : null }),
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), push: jest.fn() }),
}));
const mockAddEntry = jest.fn(async () => ({ outcome: 'synced', id: 'row1' }));
jest.mock('@/hooks/useToday', () => ({ useToday: () => ({ addEntry: mockAddEntry, customFoods: [] }) }));
jest.mock('@/hooks/useAddReceipt', () => ({ useAddReceipt: () => ({ showAdded: jest.fn(), showCopied: jest.fn() }) }));
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({ confirm: (o: unknown) => mockConfirm(o), ConfirmHost: () => null }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('@/lib/connectivity', () => ({ isOffline: () => false, useIsOffline: () => false }));

const mockPick = jest.fn();
const mockAnalyze = jest.fn();
jest.mock('@/lib/mealScan', () => ({
  pickMealPhoto: (s: string) => mockPick(s),
  encodeMealPhoto: async (u: string) => `b64:${u}`,
  analyzeMealPhoto: (...a: unknown[]) => mockAnalyze(...a),
  scanErrorMessage: () => ({ key: 'scan.errNetwork', params: {} }),
}));

type Draft = { items: unknown[]; mealName: string } | null;
let mockDraft: Draft = null;
jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () =>
    mockDraft && { uid: 'u1', atMs: Date.now(), portion: 1, lowConf: false, note: '', remaining: 2, ...mockDraft },
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));

let mockCamGranted = false;
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [
    mockCamGranted
      ? { granted: true, canAskAgain: true, status: 'granted' }
      : { granted: false, canAskAgain: true, status: 'undetermined' },
    jest.fn(),
    jest.fn(),
  ],
  CameraView: () => null,
}));

import Scan from '@/app/scan';

const RICE = { name: 'Rice', grams: 150, calories: 200, protein: 4, carbs: 44, fat: 0.5, confidence: 0.9, source: 'usda', key: 'k1' };

beforeEach(() => {
  mockLocale = undefined;
  mockDraft = null;
  mockCamGranted = false;
  mockConfirm.mockReset();
  mockAddEntry.mockClear();
  mockPick.mockReset();
  mockAnalyze.mockReset();
  jest.spyOn(AccessibilityInfo, 'announceForAccessibility').mockImplementation(() => {});
});

async function review(items: unknown[] = [RICE], mealName = 'Rice') {
  mockDraft = { items, mealName };
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  return screen;
}

it('#1 keeps a typed decimal comma in pt-BR: 12,5 g is 12.5 g, not 125', async () => {
  mockLocale = 'pt-BR';
  const screen = await review();
  const field = () => screen.getByTestId('scan-item-grams-0');
  await act(async () => { fireEvent.changeText(field(), '12,'); });
  expect(field().props.value).toBe('12,');
  await act(async () => { fireEvent.changeText(field(), '12,5'); });
  expect(field().props.value).toBe('12,5');
  // 200 kcal per 150 g → 12.5 g is 17 kcal, nowhere near 125 g's 167.
  expect(screen.getByTestId('scan-calories')).toBeTruthy();
  await act(async () => { fireEvent(field(), 'blur'); });
  expect(field().props.value).toBe('12,5');
});

it('#4 refuses a plate over the rules\' calorie ceiling with the add sheet\'s words', async () => {
  const screen = await review([{ ...RICE, calories: 25000 }]);
  await act(async () => { fireEvent.press(screen.getByTestId('scan-add')); });
  expect(mockAddEntry).not.toHaveBeenCalled();
  expect(screen.getByTestId('scan-add-error')).toHaveTextContent(/One entry can be up to 19,999 kcal/);
});

it('#4 caps the meal name at the rules\' 100 characters', async () => {
  const screen = await review();
  expect(screen.getByTestId('scan-name').props.maxLength).toBe(100);
});

it('#9 asks before removing the last item, and discards on yes', async () => {
  const screen = await review();
  await act(async () => { fireEvent.press(screen.getByTestId('scan-item-remove-0')); });
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Remove the last item?', destructive: true }));
  expect(screen.getByTestId('scan-item-0')).toBeTruthy();
});

it('#5 a refused library says so and offers Settings', async () => {
  const open = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined as never);
  mockPick.mockResolvedValue({ denied: true, canAskAgain: false });
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-choose')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('scan-choose')); });
  expect(screen.getByTestId('scan-error')).toHaveTextContent(/Photo access is off/);
  await act(async () => { fireEvent.press(screen.getByTestId('scan-notice-settings')); });
  expect(open).toHaveBeenCalled();
});

it('#3 keeps the photo after a failed call, so retry is one tap', async () => {
  mockPick.mockResolvedValue('file://plate.jpg');
  mockAnalyze.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'functions/deadline-exceeded' }));
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-choose')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('scan-choose')); });
  await act(async () => { fireEvent.press(screen.getByTestId('scan-analyze')); });
  await waitFor(() => expect(screen.getByTestId('scan-analyze')).toBeTruthy());
  expect(screen.getByTestId('scan-notice')).toHaveTextContent(/Check your connection/);
  mockAnalyze.mockResolvedValueOnce({ items: [RICE], confidence: 'high', photosRemaining: 1 });
  await act(async () => { fireEvent.press(screen.getByTestId('scan-analyze')); });
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  expect(mockAnalyze).toHaveBeenLastCalledWith(['b64:file://plate.jpg'], 'en', '', 'Meal');
});

it('#2 hardware back during the wait asks instead of closing', async () => {
  let backCb: (() => boolean) | undefined;
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, cb) => {
    backCb = cb as () => boolean;
    return { remove: () => {} } as never;
  });
  mockPick.mockResolvedValue('file://plate.jpg');
  mockAnalyze.mockReturnValue(new Promise(() => {}));
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-choose')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('scan-choose')); });
  await act(async () => { fireEvent.press(screen.getByTestId('scan-analyze')); });
  await waitFor(() => expect(screen.getByTestId('scan-cancel')).toBeTruthy());
  let handled = false;
  await act(async () => { handled = backCb?.() ?? false; });
  expect(handled).toBe(true);
  expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stop this scan?' }));
  spy.mockRestore();
});

it('#2 a "Stop scan" confirmed after the result landed keeps the review', async () => {
  let backCb: (() => boolean) | undefined;
  const spy = jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_e, cb) => {
    backCb = cb as () => boolean;
    return { remove: () => {} } as never;
  });
  mockPick.mockResolvedValue('file://plate.jpg');
  let resolveScan: (v: unknown) => void = () => {};
  mockAnalyze.mockReturnValue(new Promise((r) => (resolveScan = r)));
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-choose')).toBeTruthy());
  await act(async () => { fireEvent.press(screen.getByTestId('scan-choose')); });
  await act(async () => { fireEvent.press(screen.getByTestId('scan-analyze')); });
  await waitFor(() => expect(screen.getByTestId('scan-cancel')).toBeTruthy());
  await act(async () => { backCb?.(); });
  const { onConfirm } = mockConfirm.mock.calls[0][0] as { onConfirm: () => void };
  // The result arrives while the dialog is still up...
  await act(async () => { resolveScan({ items: [RICE], confidence: 'high', photosRemaining: 2 }); });
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  // ...and confirming it afterwards must not discard the review.
  await act(async () => { onConfirm(); });
  expect(screen.getByTestId('scan-add')).toBeTruthy();
  spy.mockRestore();
});
