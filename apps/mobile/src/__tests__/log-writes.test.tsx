/**
 * The write half of the logging tabs.
 *
 * `useToday` and `useHistory` used to carry their own copies of these seven
 * verbs, and the copies drifted — Today's `addEntry` grew a meal-slot default
 * and an Apple Health mirror, History's did not, so a meal added from the
 * day-detail sheet filed into `other` and never reached Health. Both hooks now
 * source them from `useLogWrites`; these tests hold that in place.
 *
 * The slot default itself is asserted in `packages/core/src/meal-slots.test.ts`
 * (`withDefaultMealSlot`) and applied at the ledger write, below this layer.
 */
import { renderHook, act } from '@testing-library/react-native';

const mockAddLogDurably = jest.fn(async () => 'logged' as const);
const mockUpdateLog = jest.fn(async () => undefined);
const mockDeleteLog = jest.fn(async () => undefined);
const mockAddPreset = jest.fn(async () => 'p1');
const mockDeletePreset = jest.fn(async () => undefined);
const mockAddCustomFood = jest.fn(async () => 'f1');
const mockDeleteCustomFood = jest.fn(async () => undefined);
const mockExportNutrition = jest.fn(async () => undefined);
const mockRecordMilestone = jest.fn(async () => true);
const mockRecordPositiveMoment = jest.fn(async () => false);
const mockUid = { current: undefined as string | undefined };

// The factories run at require time, before the consts above are initialized,
// so each property has to forward lazily rather than capture the mock itself.
// Adds go through the durable path now (`pending-logs.ts`), which parks the row
// on disk when Firestore is unreachable. Mocked at that seam rather than at the
// ledger: the real module reaches `quick-add.ts` and therefore `firebase.ts`,
// whose untranspiled ESM cannot load here.
jest.mock('@/lib/pending-logs', () => ({
  addLogDurably: (...a: unknown[]) => mockAddLogDurably(...(a as [])),
}));

jest.mock('@/lib/ledger', () => ({
  recordMilestone: (...a: unknown[]) => mockRecordMilestone(...(a as [])),
  updateLog: (...a: unknown[]) => mockUpdateLog(...(a as [])),
  deleteLog: (...a: unknown[]) => mockDeleteLog(...(a as [])),
  addPreset: (...a: unknown[]) => mockAddPreset(...(a as [])),
  deletePreset: (...a: unknown[]) => mockDeletePreset(...(a as [])),
  addCustomFood: (...a: unknown[]) => mockAddCustomFood(...(a as [])),
  deleteCustomFood: (...a: unknown[]) => mockDeleteCustomFood(...(a as [])),
}));

jest.mock('@/lib/health-sync', () => ({
  exportNutrition: (...a: unknown[]) => mockExportNutrition(...(a as [])),
  exportDaily: jest.fn(),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: mockUid.current ? { uid: mockUid.current } : null }),
}));

// `reviewPrompt` reaches expo-application and expo-store-review; the award path
// only needs to know THAT it was spent, never how.
jest.mock('@/lib/reviewPrompt', () => ({
  recordPositiveMoment: (...a: unknown[]) => mockRecordPositiveMoment(...(a as [])),
}));

import { useLogWrites } from '@/hooks/useLogWrites';
import { resetFirstScanLatch } from '@/lib/first-scan';

beforeEach(() => {
  mockUid.current = 'u1';
  jest.clearAllMocks();
  // Module state, deliberately — one attempt per account per PROCESS. Without
  // this reset the second test in this file would silently assert nothing.
  resetFirstScanLatch();
});

describe('useLogWrites', () => {
  it('writes an entry through the ledger and mirrors it to Health at its own time', async () => {
    const at = new Date(2026, 7, 6, 20, 0);
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({
        calories: 700,
        protein: 40,
        carbs: 60,
        fat: 25,
        timestamp: at,
      });
    });

    expect(mockAddLogDurably).toHaveBeenCalledWith('u1', expect.objectContaining({ calories: 700 }));
    expect(mockExportNutrition).toHaveBeenCalledWith({
      at,
      kcal: 700,
      protein: 40,
      carbs: 60,
      fat: 25,
    });
  });

  it('does not mirror a zero-calorie marker row to Health', async () => {
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 0, weight: 181.2 });
    });

    expect(mockAddLogDurably).toHaveBeenCalledTimes(1);
    expect(mockExportNutrition).not.toHaveBeenCalled();
  });

  it('writes nothing at all while signed out', async () => {
    mockUid.current = undefined;
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 500 });
      await result.current.updateEntry('id', { calories: 500 });
      await result.current.deleteEntry('id');
      await result.current.addPreset({ name: 'Shake', calories: 200 });
      await result.current.deletePreset('id');
      await result.current.deleteCustomFood('id');
    });

    for (const fn of [
      mockAddLogDurably,
      mockUpdateLog,
      mockDeleteLog,
      mockAddPreset,
      mockDeletePreset,
      mockDeleteCustomFood,
    ]) {
      expect(fn).not.toHaveBeenCalled();
    }
    expect(mockExportNutrition).not.toHaveBeenCalled();
  });

  it('de-dups a barcode-sourced food at its barcode doc id, and auto-ids the rest', async () => {
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addCustomFood({
        name: 'Oats',
        source: 'barcode',
        barcode: '0123456789012',
        calories: 150,
      } as never);
      await result.current.addCustomFood({ name: 'Chili', calories: 420 } as never);
    });

    expect(mockAddCustomFood).toHaveBeenNthCalledWith(
      1,
      'u1',
      expect.anything(),
      '0123456789012',
    );
    expect(mockAddCustomFood).toHaveBeenNthCalledWith(2, 'u1', expect.anything(), null);
  });
});

/**
 * `first-scan` at the write (#109).
 *
 * The award lives in this funnel rather than in `scan.tsx` so a future
 * photo-scan surface inherits it; these hold that, and hold the three
 * properties the ticket made non-negotiable — it fires on the scan and only on
 * the scan, it is never awaited into the meal's own commit, and a repeated
 * trigger does not produce a second write.
 */
describe('useLogWrites — the first-scan award', () => {
  const flush = () => act(async () => { await Promise.resolve(); });

  it('records the milestone and spends a positive moment on a photo-scanned add', async () => {
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 620, mealLabel: 'Chicken bowl', source: 'photo' });
    });
    await flush();

    expect(mockAddLogDurably).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ source: 'photo' }),
    );
    expect(mockRecordMilestone).toHaveBeenCalledWith('u1', 'first-scan');
    expect(mockRecordPositiveMoment).toHaveBeenCalledTimes(1);
  });

  it('records nothing for a typed meal', async () => {
    // The whole point of the marker: a meal that was not photographed must be
    // indistinguishable from one that was NOT scanned, in this direction too.
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 620, mealLabel: 'Chicken bowl' });
    });
    await flush();

    expect(mockRecordMilestone).not.toHaveBeenCalled();
    expect(mockRecordPositiveMoment).not.toHaveBeenCalled();
  });

  it('attempts the write ONCE however many meals one session scans', async () => {
    // #109's "a repeated trigger produces exactly one document". The database
    // enforces it (the key is the doc id and `update` is denied), so this is
    // about not paying for a write that can only be refused.
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 400, source: 'photo' });
      await result.current.addEntry({ calories: 300, source: 'photo' });
      await result.current.addEntry({ calories: 200, source: 'photo' });
    });
    await flush();

    expect(mockAddLogDurably).toHaveBeenCalledTimes(3);
    expect(mockRecordMilestone).toHaveBeenCalledTimes(1);
  });

  it('does not spend a positive moment when the milestone was already on file', async () => {
    // `recordMilestone` answers false for "already recorded" — asking a
    // long-time user to rate the app because they scanned lunch is exactly the
    // badly-spent request `reviewPrompt.ts` exists to avoid.
    mockRecordMilestone.mockResolvedValueOnce(false);
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await result.current.addEntry({ calories: 400, source: 'photo' });
    });
    await flush();

    expect(mockRecordMilestone).toHaveBeenCalledTimes(1);
    expect(mockRecordPositiveMoment).not.toHaveBeenCalled();
  });

  it('still saves the meal when the milestone write fails', async () => {
    // The #97 failure mode, asserted rather than assumed: the award is a
    // SEPARATE commit, so a rules rejection cannot roll back the meal. If these
    // were ever batched, `addEntry` would reject here and the row would vanish.
    mockRecordMilestone.mockRejectedValueOnce(new Error('permission-denied'));
    const { result } = await renderHook(() => useLogWrites());

    await act(async () => {
      await expect(
        result.current.addEntry({ calories: 500, source: 'photo' }),
      ).resolves.toBeUndefined();
    });

    expect(mockAddLogDurably).toHaveBeenCalledTimes(1);
  });
});
