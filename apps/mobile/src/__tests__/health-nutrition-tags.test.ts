import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Logged meals reach Apple Health / Health Connect tagged with their log id,
 * so undo, delete and edit can reach them again (audit #22).
 *
 * Three layers: the pure tag mapping each platform writes and deletes by, the
 * device-local list of tagged exports, and the `health-sync` orchestration —
 * which must never write an edit's new values over an export it could not
 * delete (that is how a pre-tagging meal would land in Health twice).
 */

// `jest.setup.js` stubs this module for every screen test; this one tests it.
jest.unmock('@/lib/health-sync');

const mockCalls: string[] = [];
const mockWrite = jest.fn(async (e: { logId?: string; kcal: number; at: Date }) => {
  mockCalls.push(`write:${e.logId}:${e.kcal}:${e.at.toISOString()}`);
});
let mockDeleteResult: () => Promise<number | undefined> = async () => undefined;
/** HealthKit reports a delete count; Health Connect does not. */
let mockDeleteCounts = false;
const mockDelete = jest.fn(async (id: string) => {
  mockCalls.push(`delete:${id}`);
  return mockDeleteResult();
});
jest.mock('@/lib/health', () => {
  const actual = jest.requireActual('@/lib/health');
  return {
    ...actual,
    health: {
      requestPermissions: async () => true,
      writeNutrition: (e: never) => mockWrite(e),
      deleteNutrition: (id: string) => mockDelete(id),
      get nutritionDeleteCounts() {
        return mockDeleteCounts;
      },
    },
  };
});
jest.mock('@/lib/ledger', () => ({}));
jest.mock('@/lib/pending-body', () => ({ flushPendingBody: jest.fn() }));

import {
  HK_LOG_ID_KEY,
  HK_NUTRITION_TYPES,
  hcNutritionClientRecordId,
  hcNutritionRecord,
  hkNutritionDeleteFilter,
  hkNutritionMetadata,
} from '@/lib/health';
import {
  forgetNutritionTags,
  getNutritionTag,
  markNutritionTagged,
  withTag,
} from '@/lib/health-nutrition-tags';
import {
  connectHealth,
  disconnectHealth,
  exportNutrition,
  forgetNutrition,
  replaceNutrition,
} from '@/lib/health-sync';

const AT = new Date('2026-10-14T12:30:00.000Z');

describe('tag mapping', () => {
  it('stamps HealthKit samples with the log id under a non-HK key, and deletes by it', () => {
    expect(HK_LOG_ID_KEY.startsWith('HK')).toBe(false);
    expect(hkNutritionMetadata('L1')).toEqual({ [HK_LOG_ID_KEY]: 'L1' });
    expect(hkNutritionMetadata(undefined)).toBeUndefined();
    // No date clause: the edit being replaced may have moved the meal's time.
    expect(hkNutritionDeleteFilter('L1')).toEqual({
      metadata: { withMetadataKey: HK_LOG_ID_KEY, value: 'L1' },
    });
    expect(HK_NUTRITION_TYPES).toHaveLength(4);
  });

  it('gives the Health Connect record a clientRecordId and a growing version', () => {
    const rec = hcNutritionRecord({ at: AT, kcal: 500, protein: 30, fat: 10, logId: 'L1' }, 1234);
    expect(rec).toEqual({
      recordType: 'Nutrition',
      startTime: AT.toISOString(),
      endTime: AT.toISOString(),
      energy: { unit: 'kilocalories', value: 500 },
      protein: { unit: 'grams', value: 30 },
      totalFat: { unit: 'grams', value: 10 },
      metadata: { clientRecordId: hcNutritionClientRecordId('L1'), clientRecordVersion: 1234, recordingMethod: 3 },
    });
    expect(hcNutritionClientRecordId('L1')).toBe('ignia-log-L1');
  });

  it('writes an untagged record exactly as before when no id is given', () => {
    const rec = hcNutritionRecord({ at: AT, kcal: 200 }, 1);
    expect(rec).not.toHaveProperty('metadata');
  });
});

describe('the tagged-export list', () => {
  beforeEach(() => AsyncStorage.clear());

  it('keeps the newest entry per id and drops the oldest past the cap', () => {
    const tags = [{ id: 'a', at: 1 }, { id: 'b', at: 2 }];
    expect(withTag(tags, { id: 'a', at: 3 })).toEqual([{ id: 'b', at: 2 }, { id: 'a', at: 3 }]);
    expect(withTag(tags, { id: 'c', at: 4 }, 2)).toEqual([{ id: 'b', at: 2 }, { id: 'c', at: 4 }]);
  });

  it('round-trips through storage', async () => {
    await markNutritionTagged('L1', AT);
    await markNutritionTagged('L2', AT);
    expect(await getNutritionTag('L1')).toEqual({ id: 'L1', at: AT.getTime() });
    await forgetNutritionTags(['L1']);
    expect(await getNutritionTag('L1')).toBeNull();
    expect(await getNutritionTag('L2')).not.toBeNull();
  });
});

describe('health-sync nutrition orchestration', () => {
  let warn: jest.SpyInstance;
  beforeEach(async () => {
    await AsyncStorage.clear();
    await connectFlag(true);
    mockCalls.length = 0;
    mockWrite.mockClear();
    mockDelete.mockClear();
    mockDeleteResult = async () => undefined;
    mockDeleteCounts = false;
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it('tags the export and records it', async () => {
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    expect(mockWrite).toHaveBeenCalledWith(expect.objectContaining({ logId: 'L1' }));
    expect(await getNutritionTag('L1')).toEqual({ id: 'L1', at: AT.getTime() });
  });

  it('runs an add and an immediate undo in order', async () => {
    // Fire-and-forget at both call sites: the delete must not overtake the write.
    void exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    await forgetNutrition(['L1']);
    expect(mockCalls).toEqual([`write:L1:500:${AT.toISOString()}`, 'delete:L1']);
    expect(await getNutritionTag('L1')).toBeNull();
  });

  it('replaces a tagged export, keeping its time when the edit carries none', async () => {
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    mockCalls.length = 0;
    await replaceNutrition('L1', { kcal: 650, protein: 40 });
    expect(mockCalls).toEqual(['delete:L1', `write:L1:650:${AT.toISOString()}`]);
  });

  it('moves the export when the edit retimes the meal', async () => {
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    mockCalls.length = 0;
    const later = new Date('2026-10-14T19:00:00.000Z');
    await replaceNutrition('L1', { kcal: 500, at: later });
    expect(mockCalls).toEqual(['delete:L1', `write:L1:500:${later.toISOString()}`]);
    expect(await getNutritionTag('L1')).toEqual({ id: 'L1', at: later.getTime() });
  });

  it('only deletes when the edit leaves no calories', async () => {
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    mockCalls.length = 0;
    await replaceNutrition('L1', null);
    expect(mockCalls).toEqual(['delete:L1']);
    expect(await getNutritionTag('L1')).toBeNull();
  });

  it('leaves an untagged (pre-tagging) export alone rather than double it', async () => {
    // HealthKit: no tag on file, and the delete counts nothing.
    mockDeleteCounts = true;
    mockDeleteResult = async () => 0;
    await replaceNutrition('OLD', { kcal: 650, at: AT });
    expect(mockCalls).toEqual(['delete:OLD']);
    expect(mockWrite).not.toHaveBeenCalled();
  });

  it('on Health Connect, never deletes an edit whose tag is not on file', async () => {
    // The delete reports no count, so it cannot prove the meal may be
    // rewritten. A tagged export whose tag this device lost (reinstall, cap)
    // would otherwise be deleted and never replaced — the meal gone from
    // Health. Untouched is the same outcome as any untagged export.
    await replaceNutrition('LOST', { kcal: 650, at: AT });
    expect(mockCalls).toEqual([]);
  });

  it('on Health Connect, still removes the meal when the edit leaves no calories', async () => {
    await replaceNutrition('LOST', null);
    expect(mockCalls).toEqual(['delete:LOST']);
  });

  it('trusts a HealthKit delete count when this device holds no tag', async () => {
    // Exported tagged from another iPhone on the same iCloud Health store.
    mockDeleteCounts = true;
    mockDeleteResult = async () => 4;
    await replaceNutrition('L9', { kcal: 300, at: AT });
    expect(mockCalls).toEqual(['delete:L9', `write:L9:300:${AT.toISOString()}`]);
  });

  it('touches nothing when neither the edit nor a tag says when the meal was', async () => {
    await replaceNutrition('L9', { kcal: 300 });
    expect(mockCalls).toEqual([]);
  });

  it('writes nothing after a refused delete (no permission), and does not throw', async () => {
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    mockCalls.length = 0;
    mockWrite.mockClear();
    mockDeleteResult = async () => {
      throw new Error('Not authorized');
    };
    await expect(replaceNutrition('L1', { kcal: 650 })).resolves.toBeUndefined();
    await expect(forgetNutrition(['L1'])).resolves.toBeUndefined();
    expect(mockWrite).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
  });

  it('does nothing while Health is disconnected', async () => {
    await connectFlag(false);
    await exportNutrition({ at: AT, kcal: 500, logId: 'L1' });
    await forgetNutrition(['L1']);
    await replaceNutrition('L1', { kcal: 1, at: AT });
    expect(mockCalls).toEqual([]);
  });
});

/** Flip the connected flag through the module's own paths (the permission
 *  prompt is mocked to grant). */
async function connectFlag(on: boolean): Promise<void> {
  if (on) await connectHealth();
  else await disconnectHealth();
}
