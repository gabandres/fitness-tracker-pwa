import type { CustomFood } from '@macrolog/core';
import { lookupProduct, productFromLibrary, setScanLibrary } from '@/lib/barcode';

/**
 * A product the user typed in from its label must match on the next scan.
 *
 * "Enter it from the label" saves the food under its barcode
 * (`customFoodDocId`), but the scanner only ever asked Open Food Facts — which
 * is exactly the database that did not have it — so the save bought nothing.
 * The user's own library now answers first.
 */
const bar: CustomFood = {
  id: '0123456789012',
  name: 'Corner-shop protein bar',
  barcode: '0123456789012',
  servingSize: 45,
  servingUnit: 'g',
  calories: 190,
  protein: 20,
  carbs: 18,
  source: 'barcode',
  createdAt: new Date('2026-09-01'),
};

const fetchMock = jest.fn();
beforeAll(() => {
  (global as { fetch: unknown }).fetch = fetchMock;
});
beforeEach(() => fetchMock.mockReset());

it('maps a saved food to the scanner shape, keeping its barcode and gram weight', () => {
  const p = productFromLibrary([bar], bar.barcode!);
  expect(p).toMatchObject({
    calories: 190,
    protein: 20,
    carbs: 18,
    fat: null,
    productName: bar.name,
    grams: 45,
    serving: { grams: 45, source: 'barcode', barcode: bar.barcode },
  });
  expect(productFromLibrary([bar], '999')).toBeNull();
});

it('answers from the registered library without touching the network, until unregistered', async () => {
  const off = setScanLibrary({ resolveLocal: (code) => productFromLibrary([bar], code) });
  await expect(lookupProduct(bar.barcode!)).resolves.toMatchObject({ productName: bar.name });
  expect(fetchMock).not.toHaveBeenCalled();
  off();

  fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ status: 0 }) });
  await expect(lookupProduct(bar.barcode!)).rejects.toBeTruthy();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
