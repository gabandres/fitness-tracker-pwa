import React from 'react';
import { act, fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { ScannedFoodItem } from '@macrolog/core';

/**
 * The scan review, add-meal re-score third pass:
 *
 * - gap 1: the per-item number fields have a way off the keyboard — a
 *   localized Done (no Return key on a decimal pad), `decimal` input, and a
 *   drag that dismisses.
 * - gap 4: each macro total is ONE spoken item with its unit.
 * - gap 5: the fields and the hero stop growing where the row stops fitting.
 */

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), back: jest.fn(), push: jest.fn(), navigate: jest.fn() }),
}));
jest.mock('@/hooks/useToday', () => ({ useToday: () => ({ addEntry: jest.fn(), customFoods: [] }) }));
jest.mock('@/hooks/useAddReceipt', () => ({ useAddReceipt: () => ({ showAdded: jest.fn() }) }));
jest.mock('@/components/Toast', () => ({ showToast: jest.fn() }));
jest.mock('@/components/ConfirmSheet', () => ({ confirm: jest.fn(), ConfirmHost: () => null }));
jest.mock('@/components/HeaderAvatar', () => ({ HeaderAvatar: () => null }));
jest.mock('@/lib/mealScan', () => ({
  analyzeMealPhoto: jest.fn(),
  encodeMealPhoto: jest.fn(),
  pickMealPhoto: jest.fn(),
  scanErrorMessage: () => ({ key: 'scan.failed', params: {} }),
}));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('expo-camera', () => ({
  useCameraPermissions: () => [{ granted: true, canAskAgain: true, status: 'granted' }, jest.fn(), jest.fn()],
  CameraView: () => null,
}));

const RICE: ScannedFoodItem = {
  name: 'Rice',
  grams: 180,
  calories: 234,
  protein: 4.8,
  carbs: 51.6,
  fat: 0.5,
  confidence: 0.8,
  source: 'model',
};
jest.mock('@/lib/scan-draft', () => ({
  readScanDraft: async () => ({
    uid: 'u1',
    atMs: Date.now(),
    items: [RICE],
    mealName: 'Rice',
    portion: 1,
    lowConf: false,
    note: '',
    remaining: 2,
  }),
  saveScanDraft: jest.fn(async () => {}),
  clearScanDraft: jest.fn(async () => {}),
}));

import Scan from '@/app/scan';

async function openReview() {
  const screen = await render(<Scan />);
  await waitFor(() => expect(screen.getByTestId('scan-add')).toBeTruthy());
  return screen;
}

it('gives the grams field a Done, decimal input and a size cap (gaps 1, 5)', async () => {
  const screen = await openReview();
  const grams = screen.getByTestId('scan-item-grams-0');
  expect(grams.props.returnKeyType).toBe('done');
  expect(grams.props.inputAccessoryViewButtonLabel).toBe('Done');
  expect(grams.props.inputMode).toBe('decimal');
  expect(grams.props.keyboardType).toBeUndefined();
  expect(grams.props.maxFontSizeMultiplier).toBe(1.4);
  expect(screen.getByTestId('scan-item-name-0').props.maxFontSizeMultiplier).toBe(1.4);
  expect(screen.getByTestId('scan-name').props.maxFontSizeMultiplier).toBe(1.4);
});

it('an added row’s kcal and protein fields get the same', async () => {
  const screen = await openReview();
  await act(async () => {
    await fireEvent.press(screen.getByTestId('scan-add-item'));
  });
  for (const id of ['scan-item-kcal-1', 'scan-item-protein-1']) {
    const f = screen.getByTestId(id);
    expect(f.props.returnKeyType).toBe('done');
    expect(f.props.inputMode).toBe('decimal');
  }
});

it('reads each macro total as one item with its unit (gap 4)', async () => {
  const screen = await openReview();
  const chipOf = (id: string) => {
    let node = screen.getByTestId(id).parent;
    while (node && !node.props.accessible) node = node.parent;
    return node!;
  };
  expect(chipOf('scan-protein').props.accessibilityLabel).toBe('5 g protein');
  expect(chipOf('scan-carbs').props.accessibilityLabel).toBe('52 g carbs');
  expect(chipOf('scan-fat').props.accessibilityLabel).toBe('1 g fat');
});
