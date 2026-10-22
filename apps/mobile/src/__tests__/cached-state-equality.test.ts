import { act, renderHook } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCachedState, useStableState } from '@/hooks/useCachedState';
import {
  FIRST_PAINT_SLICES,
  clearOfflineCache,
  peekCache,
  preloadCache,
  sameCacheValue,
  writeCache,
} from '@/lib/offline-cache';

/**
 * The equality skip (2026-10-21 performance pass).
 *
 * Today re-attaches its listeners on every focus, and each first answer was a
 * NEW array or map holding exactly what was on screen — about ten renders of
 * Today per refocus, and a re-serialization of every slice to AsyncStorage. A
 * delivery equal to what is shown now renders nothing, and one equal to what is
 * stored writes nothing. The provenance rules `cached-state-provenance.test.ts`
 * pins still hold underneath.
 */

const WAIT_WRITE = () => new Promise((r) => setTimeout(r, 600));

beforeEach(async () => {
  await clearOfflineCache();
  await AsyncStorage.clear();
  jest.mocked(AsyncStorage.setItem).mockClear();
  jest.mocked(AsyncStorage.multiGet).mockClear();
});

const rows = () => [
  { id: 'a', calories: 100, date: new Date(2026, 9, 20, 8) },
  { id: 'b', calories: 250, date: new Date(2026, 9, 21, 12) },
];

describe('useCachedState skips an equal delivery', () => {
  it('does not re-render or re-write for a structurally equal value', async () => {
    let renders = 0;
    const hook = await renderHook(() => {
      renders++;
      return useCachedState<ReturnType<typeof rows>>('u1', 'logs', []);
    });
    await act(async () => hook.result.current[1](rows()));
    await WAIT_WRITE();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    const shown = hook.result.current[0];
    const before = renders;

    // A refocus: the re-opened listener answers with a NEW array, same data —
    // Dates included, compared by time.
    await act(async () => hook.result.current[1](rows()));
    await WAIT_WRITE();
    expect(renders).toBe(before);
    expect(hook.result.current[0]).toBe(shown);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);

    // A real change still lands, and is persisted.
    await act(async () => hook.result.current[1]([...rows(), { id: 'c', calories: 5, date: new Date() }]));
    await WAIT_WRITE();
    expect(hook.result.current[0]).toHaveLength(3);
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(2);
  });

  it('a value shown cache-only, then confirmed by the server, IS persisted', async () => {
    // The screen already shows it, so no render — but disk does not hold it
    // yet, and skipping the write would leave the next cold start stale.
    writeCache('u1', 'presets', ['old']);
    await WAIT_WRITE();
    jest.mocked(AsyncStorage.setItem).mockClear();
    const hook = await renderHook(() => useCachedState<string[]>('u1', 'presets', []));
    expect(hook.result.current[0]).toEqual(['old']);
    // A server answer first, so a later cache-only value is allowed through.
    await act(async () => hook.result.current[1](['old']));
    await act(async () => hook.result.current[1](['old', 'offline-add'], { authoritative: false }));
    expect(hook.result.current[0]).toEqual(['old', 'offline-add']);
    await WAIT_WRITE();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();

    await act(async () => hook.result.current[1](['old', 'offline-add']));
    await WAIT_WRITE();
    expect(AsyncStorage.setItem).toHaveBeenCalledTimes(1);
    expect(peekCache('u1', 'presets')).toEqual(['old', 'offline-add']);
  });

  it('an equal server answer still counts as the server answering (provenance)', async () => {
    writeCache('u2', 'templates', ['t']);
    await WAIT_WRITE();
    const hook = await renderHook(() => useCachedState<string[]>('u2', 'templates', []));
    // Equal to the paint: skipped as a render, but it latches "the server has
    // answered", so the cache-only delete that follows is shown, not dropped.
    await act(async () => hook.result.current[1](['t']));
    await act(async () => hook.result.current[1]([], { authoritative: false }));
    expect(hook.result.current[0]).toEqual([]);
  });

  it('drops the slice from screen when the account goes away', async () => {
    writeCache('u1', 'customFoods', ['mine']);
    await WAIT_WRITE();
    const hook = await renderHook(({ uid }: { uid: string | undefined }) => useCachedState<string[]>(uid, 'customFoods', []), {
      initialProps: { uid: 'u1' as string | undefined },
    });
    expect(hook.result.current[0]).toEqual(['mine']);
    await act(async () => hook.rerender({ uid: undefined }));
    expect(hook.result.current[0]).toEqual([]);
  });
});

describe('useStableState', () => {
  it('keeps the held value for an equal delivery', async () => {
    let renders = 0;
    const hook = await renderHook(() => {
      renders++;
      return useStableState<{ bedtime?: string }>({});
    });
    await act(async () => hook.result.current[1]({ bedtime: '23:00' }));
    const held = hook.result.current[0];
    const before = renders;
    await act(async () => hook.result.current[1]({ bedtime: '23:00' }));
    expect(hook.result.current[0]).toBe(held);
    expect(renders).toBe(before);
    await act(async () => hook.result.current[1]({ bedtime: '23:30' }));
    expect(hook.result.current[0]).toEqual({ bedtime: '23:30' });
  });
});

describe('sameCacheValue', () => {
  it.each([
    [[1, 2], [1, 2], true],
    [{ a: 1, b: undefined }, { a: 1 }, true],
    [{ d: new Date(5) }, { d: new Date(5) }, true],
    [{ d: new Date(5) }, { d: new Date(6) }, false],
    [[1, 2], [2, 1], false],
    [{ a: 1 }, { a: 1, b: 2 }, false],
    [NaN, NaN, true],
    [null, {}, false],
    [[], {}, false],
  ])('%j vs %j → %s', (a, b, want) => {
    expect(sameCacheValue(a, b)).toBe(want);
  });
});

describe('preloadCache', () => {
  it("warms every first-paint slice in ONE storage call, so peekCache hits synchronously", async () => {
    for (const s of FIRST_PAINT_SLICES) writeCache('u9', s, { slice: s });
    await WAIT_WRITE();
    // A cold process: memory gone, disk kept.
    const disk = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    await clearOfflineCache();
    await AsyncStorage.multiSet(disk.map(([k, v]) => [k, v ?? '']));
    expect(peekCache('u9', 'logs')).toBeNull();
    jest.mocked(AsyncStorage.multiGet).mockClear();

    await preloadCache('u9', FIRST_PAINT_SLICES);
    expect(AsyncStorage.multiGet).toHaveBeenCalledTimes(1);
    for (const s of FIRST_PAINT_SLICES) expect(peekCache('u9', s)).toEqual({ slice: s });

    // And a hook mounting afterwards is painted on its FIRST render.
    const hook = await renderHook(() => useCachedState<{ slice: string } | null>('u9', 'water', null));
    expect(hook.result.current[0]).toEqual({ slice: 'water' });
    expect(hook.result.current[2]).toBe(true);
  });

  it('revives Dates, and never overwrites a value written while it read', async () => {
    writeCache('u8', 'logs', [{ date: new Date(2026, 9, 21) }]);
    writeCache('u8', 'profile', { name: 'disk' });
    await WAIT_WRITE();
    const disk = await AsyncStorage.multiGet(await AsyncStorage.getAllKeys());
    await clearOfflineCache();
    await AsyncStorage.multiSet(disk.map(([k, v]) => [k, v ?? '']));

    const pending = preloadCache('u8', ['logs', 'profile']);
    writeCache('u8', 'profile', { name: 'live' }); // a snapshot lands mid-read
    await pending;
    expect(peekCache<{ date: Date }[]>('u8', 'logs')?.[0].date).toBeInstanceOf(Date);
    expect(peekCache('u8', 'profile')).toEqual({ name: 'live' });
  });
});
