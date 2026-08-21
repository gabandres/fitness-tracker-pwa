import AsyncStorage from '@react-native-async-storage/async-storage';
import { OffLookupError } from '@macrolog/core';
import { clearBarcodeCache, lookupProduct } from '@/lib/barcode';

/**
 * The React Native half of the barcode lookup.
 *
 * `packages/core` owns and tests the two pure pieces — `offProductUrl` (which
 * fields are asked for) and `resolveOffProduct` (the nutriment-basis rule). What
 * is only checkable HERE is the transport and the on-device cache: that a repeat
 * scan makes no network call, that an expired entry does, and that OFF's 404
 * still reaches the resolver so a missing product raises a typed
 * `FOOD_NOT_FOUND` rather than a bare transport error.
 *
 * That last one is a regression test with a real incident behind it. OFF v3
 * answers **404** for an unknown product, and this module used to reject every
 * non-2xx before parsing — so the single most common barcode outcome surfaced as
 * "couldn't read that barcode", telling the user to re-scan a barcode that had
 * scanned perfectly. Shipped that way until 2026-08-21.
 */

const BARCODE = '3017620422003';

/** A minimal OFF v3 success body — enough for the resolver to produce macros. */
function offBody(kcal = 539) {
  return {
    status: 'success',
    product: {
      code: BARCODE,
      product_name: 'Nutella',
      brands: 'Ferrero',
      nutriments: {
        'energy-kcal_100g': kcal,
        proteins_100g: 6,
        carbohydrates_100g: 57,
        fat_100g: 31,
      },
    },
  };
}

function mockFetchOnce(body: unknown, status = 200) {
  return jest.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

beforeEach(async () => {
  await AsyncStorage.clear();
  jest.restoreAllMocks();
});

describe('lookupProduct', () => {
  it('asks OFF for only the fields the resolver reads', async () => {
    const fetchMock = mockFetchOnce(offBody());
    global.fetch = fetchMock as unknown as typeof fetch;

    await lookupProduct(BARCODE);

    const url = new URL(fetchMock.mock.calls[0][0] as string);
    expect(url.pathname).toBe(`/api/v3/product/${BARCODE}`);
    expect(url.searchParams.get('fields')).toContain('serving_quantity');
    // The app identifies itself in the query string — `User-Agent` is a
    // forbidden header in browsers, so the shared helper cannot use one.
    expect(url.searchParams.get('app_name')).toBe('Ignia');
  });

  it('serves a repeat scan from the cache with NO network call', async () => {
    const fetchMock = mockFetchOnce(offBody());
    global.fetch = fetchMock as unknown as typeof fetch;

    const first = await lookupProduct(BARCODE);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const second = await lookupProduct(BARCODE);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the point of the cache
    expect(second).toEqual(first);
  });

  it('re-fetches once the entry is older than the TTL', async () => {
    const fetchMock = mockFetchOnce(offBody());
    global.fetch = fetchMock as unknown as typeof fetch;
    await lookupProduct(BARCODE);

    // Age the stored entry past 30 days rather than mocking the clock, so this
    // asserts the persisted shape too — a schema drift breaks it loudly.
    const raw = JSON.parse((await AsyncStorage.getItem('barcodeCache.v1'))!);
    raw[BARCODE].at = Date.now() - 31 * 24 * 60 * 60 * 1000;
    await AsyncStorage.setItem('barcodeCache.v1', JSON.stringify(raw));

    await lookupProduct(BARCODE);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('raises FOOD_NOT_FOUND on OFF\'s 404 instead of a bare transport error', async () => {
    // v3 answers 404 with a normal JSON body for an unknown product.
    global.fetch = mockFetchOnce({ code: BARCODE, errors: [{}] }, 404) as unknown as typeof fetch;

    await expect(lookupProduct(BARCODE)).rejects.toBeInstanceOf(OffLookupError);
    await expect(lookupProduct(BARCODE)).rejects.toMatchObject({ code: 'FOOD_NOT_FOUND' });
  });

  it('still throws a plain Error on a real transport failure', async () => {
    global.fetch = mockFetchOnce({}, 503) as unknown as typeof fetch;
    await expect(lookupProduct(BARCODE)).rejects.toThrow(/503/);
  });

  it('does not cache a failed lookup — OFF may simply not have been edited yet', async () => {
    const fetchMock = mockFetchOnce({ code: BARCODE, errors: [{}] }, 404);
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(lookupProduct(BARCODE)).rejects.toBeInstanceOf(OffLookupError);
    await expect(lookupProduct(BARCODE)).rejects.toBeInstanceOf(OffLookupError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('falls through to the network when the stored blob is corrupt', async () => {
    await AsyncStorage.setItem('barcodeCache.v1', 'not json at all');
    const fetchMock = mockFetchOnce(offBody());
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(lookupProduct(BARCODE)).resolves.toMatchObject({ productName: 'Nutella' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('clearBarcodeCache forces the next scan back to the network', async () => {
    const fetchMock = mockFetchOnce(offBody());
    global.fetch = fetchMock as unknown as typeof fetch;

    await lookupProduct(BARCODE);
    await clearBarcodeCache();
    await lookupProduct(BARCODE);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
