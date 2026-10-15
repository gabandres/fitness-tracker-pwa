import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, renderWithProviders as render, waitFor } from '@/test-utils';

/**
 * Audit 2026-10-15 #6: a barcode lookup ran on after the scanner closed and
 * its result (or its error) landed on whatever opened next — and the fetch had
 * no timeout, so on one bar of signal the spinner never ended. The lookup now
 * aborts on close, gives up after a deadline, and a stale answer is ignored.
 */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null }) }));

describe('lookupProduct transport', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  beforeEach(() => AsyncStorage.clear());

  /** A fetch that never answers, but honours its abort signal like RN's. */
  function hangingFetch() {
    global.fetch = jest.fn((_url: unknown, init?: { signal?: AbortSignal }) =>
      new Promise((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(Object.assign(new Error('Aborted'), { name: 'AbortError' })));
      }),
    ) as never;
  }

  it('gives up after its deadline instead of hanging', async () => {
    hangingFetch();
    const { lookupProduct } = jest.requireActual('@/lib/barcode') as typeof import('@/lib/barcode');
    await expect(lookupProduct('5000112637922', { timeoutMs: 20 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('stops when the caller aborts', async () => {
    hangingFetch();
    const { lookupProduct } = jest.requireActual('@/lib/barcode') as typeof import('@/lib/barcode');
    const c = new AbortController();
    const p = lookupProduct('5000112637922', { signal: c.signal });
    c.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
  });
});

