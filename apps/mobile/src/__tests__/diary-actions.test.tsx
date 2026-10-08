/**
 * `useDiaryActions` — the one implementation of a diary's writes that Today
 * and the History day share (UX_AUDIT Today review U2), plus the receipts and
 * haptics the review asked for (#7, U6, U9, P6).
 */
const mockShow = jest.fn();
jest.mock('@/components/Toast', () => ({
  useToast: () => ({ show: mockShow, hide: jest.fn(), act: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
const mockAddPresetNow = jest.fn();
jest.mock('@/lib/ledger', () => ({ addPresetNow: (...a: unknown[]) => mockAddPresetNow(...a) }));
const mockAddLogDurably = jest.fn().mockResolvedValue('logged');
jest.mock('@/lib/pending-logs', () => ({
  undoAdds: jest.fn().mockResolvedValue(undefined),
  addLogDurably: (...a: unknown[]) => mockAddLogDurably(...a),
}));
jest.mock('@/lib/haptics', () => ({
  tap: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  removed: jest.fn(),
  celebrate: jest.fn(),
  selection: jest.fn(),
}));

import { act, renderWithProviders as render } from '@/test-utils';
import type { DailyLog, LogEntry } from '@macrolog/core';
import { type DiaryActions, type DiaryActionsOptions, useDiaryActions } from '@/hooks/useDiaryActions';
import * as haptics from '@/lib/haptics';

const oats: DailyLog = { id: 'r1', calories: 300, protein: 10, mealLabel: 'Oatmeal', date: new Date(2026, 9, 4, 8) };

function setup(over: Partial<DiaryActionsOptions> = {}) {
  const writes = {
    addEntry: jest.fn().mockResolvedValue({ outcome: 'logged', id: 'new-1' }),
    updateEntry: jest.fn().mockResolvedValue(undefined),
    deleteEntry: jest.fn().mockResolvedValue(undefined),
    deletePreset: jest.fn().mockResolvedValue(undefined),
  };
  const ref: { current: DiaryActions | null } = { current: null };
  function Harness() {
    ref.current = useDiaryActions({ where: 'today', dateKey: '2026-10-04', dayLogs: [oats], presets: [], ...writes, ...over });
    return null;
  }
  return { ref, writes, render: () => render(<Harness />) };
}

beforeEach(() => jest.clearAllMocks());

describe('useDiaryActions', () => {
  it('deletes from the list with an Undo that re-adds at the same id — and a knock, not a success', async () => {
    const { ref, writes, render: r } = setup();
    await r();
    await act(async () => ref.current!.deleteFromList(oats));
    expect(writes.deleteEntry).toHaveBeenCalledWith('r1');
    expect(haptics.removed).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
    const [msg, opts] = mockShow.mock.calls[0];
    expect(msg).toBe('Entry deleted');
    opts.action.onPress();
    expect(mockAddLogDurably).toHaveBeenCalledWith('u1', expect.objectContaining({ calories: 300 }), 'r1');
  });

  it('reopens the form holding a refused add — the sheet has already closed', async () => {
    // The add sheet closes at dispatch, so this is where a refusal is
    // recovered: what was typed comes back for the one wrong value to be fixed.
    const { ref, render: r } = setup({ addEntry: jest.fn().mockResolvedValue({ outcome: 'rejected', id: 'x' }) });
    await r();
    await act(async () => {
      await ref.current!.onSave({ calories: 300, mealLabel: 'Oatmeal', note: 'with milk' });
    });
    expect(ref.current!.sheetOpen).toBe(true);
    expect(ref.current!.prefill).toEqual(expect.objectContaining({ calories: 300, mealLabel: 'Oatmeal', note: 'with milk' }));
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('says how much of the day is left in the add receipt', async () => {
    const { ref, render: r } = setup({ remainingAfter: (e: LogEntry) => 2000 - 650 - e.calories });
    await r();
    await act(async () => {
      await ref.current!.onSave({ calories: 300, mealLabel: 'Oatmeal' });
    });
    expect(mockShow.mock.calls[0][0]).toBe('Logged Oatmeal · 300 kcal · 1,050 left');
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });

  it('plays the celebration INSTEAD of the success when the add is a moment', async () => {
    const { ref, render: r } = setup({ celebrates: () => true });
    await r();
    await act(async () => {
      await ref.current!.onSave({ calories: 300 });
    });
    expect(haptics.celebrate).toHaveBeenCalledTimes(1);
    expect(haptics.success).not.toHaveBeenCalled();
  });

  it('opens the sheet seeded with the slot a "+ Add" was tapped in', async () => {
    const { ref, render: r } = setup();
    await r();
    await act(async () => ref.current!.openSlot('dinner'));
    expect(ref.current!.sheetOpen).toBe(true);
    expect(ref.current!.editing).toBeNull();
    expect(ref.current!.prefill).toEqual({ mealType: 'dinner' });
    await act(async () => ref.current!.closeSheet());
    expect(ref.current!.prefill).toBeNull();
  });

  it('opens the editor for a row by id, and reports when the row is not on screen', async () => {
    const { ref, render: r } = setup();
    await r();
    let found = false;
    await act(async () => {
      found = ref.current!.openEditById('r1');
    });
    expect(found).toBe(true);
    expect(ref.current!.editing?.id).toBe('r1');
    expect(ref.current!.openEditById('missing')).toBe(false);
  });

  it('saves to Quick add with an optimistic success, and warns if the write is refused', async () => {
    let reject!: (e: Error) => void;
    mockAddPresetNow.mockReturnValue({ id: 'p1', written: new Promise<void>((_, rj) => (reject = rj)) });
    const { ref, render: r } = setup();
    await r();
    await act(async () => ref.current!.savePresetFromLog(oats));
    expect(haptics.success).toHaveBeenCalledTimes(1);
    expect(mockShow.mock.calls[0][0]).toBe('“Oatmeal” saved to Quick add.');
    await act(async () => {
      reject(new Error('permission-denied'));
    });
    expect(haptics.warning).toHaveBeenCalledTimes(1);
  });

  it('refuses a duplicate Quick add without writing', async () => {
    const { ref, render: r } = setup({
      presets: [{ id: 'p', name: 'oatmeal', calories: 300, protein: 10, carbs: 0, fat: 0 }],
    });
    await r();
    await act(async () => ref.current!.savePresetFromLog(oats));
    expect(mockAddPresetNow).not.toHaveBeenCalled();
    expect(mockShow.mock.calls[0][0]).toBe('“Oatmeal” is already in Quick add.');
  });
});
