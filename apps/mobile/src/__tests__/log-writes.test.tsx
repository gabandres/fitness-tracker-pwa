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

const mockAddLog = jest.fn(async () => 'new-id');
const mockUpdateLog = jest.fn(async () => undefined);
const mockDeleteLog = jest.fn(async () => undefined);
const mockAddPreset = jest.fn(async () => 'p1');
const mockDeletePreset = jest.fn(async () => undefined);
const mockAddCustomFood = jest.fn(async () => 'f1');
const mockDeleteCustomFood = jest.fn(async () => undefined);
const mockExportNutrition = jest.fn(async () => undefined);
const mockUid = { current: undefined as string | undefined };

// The factories run at require time, before the consts above are initialized,
// so each property has to forward lazily rather than capture the mock itself.
jest.mock('@/lib/ledger', () => ({
  addLog: (...a: unknown[]) => mockAddLog(...(a as [])),
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

import { useLogWrites } from '@/hooks/useLogWrites';

beforeEach(() => {
  mockUid.current = 'u1';
  jest.clearAllMocks();
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

    expect(mockAddLog).toHaveBeenCalledWith('u1', expect.objectContaining({ calories: 700 }));
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

    expect(mockAddLog).toHaveBeenCalledTimes(1);
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
      mockAddLog,
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
