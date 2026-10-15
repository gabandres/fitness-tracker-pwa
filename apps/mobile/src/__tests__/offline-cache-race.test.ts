import AsyncStorage from '@react-native-async-storage/async-storage';
import { peekCache, readCache, writeCache } from '@/lib/offline-cache';

/**
 * Audit 2026-10-15 #25: `readCache` set the in-memory copy AFTER its disk
 * await, so a live snapshot written while the read was in flight was
 * overwritten by the older disk payload — and every screen that peeked the
 * memory copy next painted stale rows.
 */
it('a disk read never overwrites a fresher write made while it was in flight', async () => {
  await AsyncStorage.setItem('ignia.cache.v1.u1.logs', JSON.stringify(['old']));
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const real = AsyncStorage.getItem;
  const spy = jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async (k: string) => {
    await gate;
    return real.call(AsyncStorage, k);
  });

  const reading = readCache<string[]>('u1', 'logs');
  writeCache('u1', 'logs', ['fresh']);
  release();

  expect(await reading).toEqual(['fresh']);
  expect(peekCache<string[]>('u1', 'logs')).toEqual(['fresh']);
  spy.mockRestore();
});
