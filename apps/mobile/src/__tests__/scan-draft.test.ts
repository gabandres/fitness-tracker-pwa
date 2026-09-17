import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ScannedFoodItem } from '@macrolog/core';
import { clearScanDraft, readScanDraft, saveScanDraft } from '@/lib/scan-draft';

// A scan draft is the one thing in this app that cannot be recreated by trying
// again: the quota slot is spent, the model call is paid for, and the meal is
// already being eaten. These tests are about the lifecycle that makes an
// unexpected restore trustworthy — it survives an ACCIDENT, never a DECISION.

const item = (name: string): ScannedFoodItem =>
  ({ name, grams: 280, calories: 128, protein: 10, carbs: 16, fat: 3 }) as ScannedFoodItem;

const draft = (over: Partial<Parameters<typeof saveScanDraft>[0]> = {}) => ({
  uid: 'u1',
  atMs: 1_000_000,
  items: [item('Kefir')],
  mealName: 'Kefir',
  portion: 1,
  lowConf: false,
  note: 'Vaso de yogurt kefir lifeway de mango',
  remaining: 2,
  ...over,
});

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('scan draft', () => {
  it('round-trips a reviewed scan', async () => {
    await saveScanDraft(draft());
    const back = await readScanDraft('u1', 1_000_000);
    expect(back?.items).toHaveLength(1);
    expect(back?.mealName).toBe('Kefir');
    expect(back?.note).toContain('lifeway');
    expect(back?.remaining).toBe(2);
  });

  it('restores within the TTL and expires past it', async () => {
    await saveScanDraft(draft());
    const fiveHours = 1_000_000 + 5 * 60 * 60 * 1000;
    expect(await readScanDraft('u1', fiveHours)).not.toBeNull();

    await saveScanDraft(draft());
    const sevenHours = 1_000_000 + 7 * 60 * 60 * 1000;
    // Past the TTL the entry would be written with the timestamp of the Add,
    // filing last night's dinner under this morning's breakfast.
    expect(await readScanDraft('u1', sevenHours)).toBeNull();
  });

  it('drops an expired draft rather than leaving it to be re-read', async () => {
    await saveScanDraft(draft());
    await readScanDraft('u1', 1_000_000 + 7 * 60 * 60 * 1000);
    // Expiry happens on the path that would have used it; nothing else sweeps.
    expect(await AsyncStorage.getItem('ignia.scanDraft.v1')).toBeNull();
  });

  it('never restores another account’s scan', async () => {
    await saveScanDraft(draft());
    expect(await readScanDraft('u2', 1_000_000)).toBeNull();
    expect(await AsyncStorage.getItem('ignia.scanDraft.v1')).toBeNull();
  });

  it('clears on demand — leaving on purpose ends the scan', async () => {
    await saveScanDraft(draft());
    await clearScanDraft();
    expect(await readScanDraft('u1', 1_000_000)).toBeNull();
  });

  it('parks nothing for an empty review or a signed-out uid', async () => {
    await saveScanDraft(draft({ items: [] }));
    expect(await AsyncStorage.getItem('ignia.scanDraft.v1')).toBeNull();
    await saveScanDraft(draft({ uid: '' }));
    expect(await AsyncStorage.getItem('ignia.scanDraft.v1')).toBeNull();
  });

  it('survives a corrupt payload without throwing', async () => {
    await AsyncStorage.setItem('ignia.scanDraft.v1', '{not json');
    expect(await readScanDraft('u1', 1_000_000)).toBeNull();
  });
});
