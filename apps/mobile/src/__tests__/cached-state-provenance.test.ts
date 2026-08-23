import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCachedState } from '@/hooks/useCachedState';
import { writeCache } from '@/lib/offline-cache';

/**
 * `useCachedState` provenance — the rule that took three publishes to land.
 *
 * Firestore runs MEMORY-ONLY in this app (RN has no IndexedDB), so an offline
 * listener fires immediately with an EMPTY result carrying `fromCache: true`.
 * That is the absence of an answer, and treating it as one broke the cache three
 * separate ways, each of which looked identical on screen — an empty tab:
 *
 *   1. it latched the "first live write wins" guard, so the disk hydration was
 *      discarded and never painted;
 *   2. it was written THROUGH to AsyncStorage, destroying the cached value for
 *      the next cold start as well;
 *   3. once (1) and (2) were fixed it still called `setValue`, replacing a list
 *      that HAD hydrated from disk a frame earlier.
 *
 * All three were found on a device with the network off, never by a test — which
 * is why these exist.
 */

/** `writeCache` debounces by 400 ms; seed and let it land before mounting. */
async function seed(uid: string, slice: 'templates' | 'presets' | 'exercises' | 'logs', v: unknown) {
  writeCache(uid, slice, v);
  await new Promise((r) => setTimeout(r, 600));
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('useCachedState provenance', () => {
  it('hydrates from disk when only cache-sourced values have arrived', async () => {
    await seed('u1', 'templates', ['a', 'b']);
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'templates', []));
    // The offline listener's empty cache hit lands first.
    await act(async () => hook.result.current[1]([], { authoritative: false }));
    await waitFor(() => expect(hook.result.current[2]).toBe(true));
    expect(hook.result.current[0]).toEqual(['a', 'b']);
  });

  it('a cache-only value does NOT clobber what hydration painted', async () => {
    await seed('u1', 'templates', ['a', 'b']);
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'templates', []));
    await waitFor(() => expect(hook.result.current[2]).toBe(true));

    await act(async () => hook.result.current[1]([], { authoritative: false }));
    expect(hook.result.current[0]).toEqual(['a', 'b']);
  });

  it('a cache-only value is NOT written through', async () => {
    await seed('u1', 'presets', ['keep']);
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'presets', []));
    await waitFor(() => expect(hook.result.current[2]).toBe(true));
    await act(async () => hook.result.current[1]([], { authoritative: false }));
    await new Promise((r) => setTimeout(r, 600));

    // A fresh mount must still find the good value on disk.
    const second = await renderHook(() => useCachedState<string[]>('u1', 'presets', []));
    await waitFor(() => expect(second.result.current[0]).toEqual(['keep']));
  });

  it('a SERVER value wins, and is persisted', async () => {
    await seed('u1', 'exercises', ['stale']);
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'exercises', []));
    await waitFor(() => expect(hook.result.current[2]).toBe(true));

    await act(async () => hook.result.current[1](['fresh'], { authoritative: true }));
    expect(hook.result.current[0]).toEqual(['fresh']);
    await new Promise((r) => setTimeout(r, 600));

    const second = await renderHook(() => useCachedState<string[]>('u1', 'exercises', []));
    await waitFor(() => expect(second.result.current[0]).toEqual(['fresh']));
  });

  it('defaults to authoritative, so existing callers are unchanged', async () => {
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'logs', []));
    await act(async () => hook.result.current[1](['x']));
    await new Promise((r) => setTimeout(r, 600));
    const second = await renderHook(() => useCachedState<string[]>('u1', 'logs', []));
    await waitFor(() => expect(second.result.current[0]).toEqual(['x']));
  });
});
