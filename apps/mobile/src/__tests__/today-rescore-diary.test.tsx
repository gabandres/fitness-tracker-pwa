/**
 * The Today re-score (2026-10-04), the diary half: "Move to…" and "Copy to
 * today" on a row — the gap every diary competitor closes and this one did
 * not — plus the pure helpers the re-score's other fixes stand on.
 */
const mockShow = jest.fn();
jest.mock('@/components/Toast', () => ({
  useToast: () => ({ show: mockShow, hide: jest.fn(), act: jest.fn() }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/ledger', () => ({ addPresetNow: jest.fn() }));
jest.mock('@/lib/pending-logs', () => ({
  undoAdds: jest.fn().mockResolvedValue(undefined),
  addLogDurably: jest.fn().mockResolvedValue('logged'),
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
import type { DailyLog } from '@macrolog/core';
import { copyForToday, type DiaryActions, type DiaryActionsOptions, useDiaryActions } from '@/hooks/useDiaryActions';
import { moveTargets, previewHeight } from '@/components/MealEntries';
import { enteredCalorieBand, sweeps } from '@/components/HeroRings';
import * as haptics from '@/lib/haptics';

const lunch: DailyLog = {
  id: 'r1',
  calories: 450,
  protein: 30,
  mealLabel: 'Chicken bowl',
  mealType: 'lunch',
  date: new Date(2026, 9, 2, 12, 30),
  createdAt: new Date(2026, 9, 2, 12, 31),
};

function setup(over: Partial<DiaryActionsOptions> = {}) {
  const writes = {
    addEntry: jest.fn().mockResolvedValue({ outcome: 'logged', id: 'new-1' }),
    updateEntry: jest.fn().mockResolvedValue(undefined),
    deleteEntry: jest.fn().mockResolvedValue(undefined),
    deletePreset: jest.fn().mockResolvedValue(undefined),
  };
  const ref: { current: DiaryActions | null } = { current: null };
  function Harness() {
    ref.current = useDiaryActions({ where: 'history', dateKey: '2026-10-02', dayLogs: [lunch], presets: [], ...writes, ...over });
    return null;
  }
  return { ref, writes, render: () => render(<Harness />) };
}

beforeEach(() => jest.clearAllMocks());

describe('Move to…', () => {
  it('offers the other three meals, never the one the row is in', () => {
    expect(moveTargets({ mealType: 'lunch' })).toEqual(['breakfast', 'dinner', 'snack']);
    // An untagged row ("other") can go to any of the four.
    expect(moveTargets({})).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
  });

  it('re-files the row — same time, same everything — with a receipt whose Undo puts it back', async () => {
    const { ref, writes, render: r } = setup();
    await r();
    await act(async () => ref.current!.moveToSlot(lunch, 'dinner'));
    expect(writes.updateEntry).toHaveBeenCalledWith(
      'r1',
      expect.objectContaining({ mealType: 'dinner', timestamp: lunch.date, calories: 450, mealLabel: 'Chicken bowl' }),
    );
    expect(haptics.success).toHaveBeenCalledTimes(1);
    const [msg, opts] = mockShow.mock.calls[0];
    expect(msg).toBe('Moved to Dinner');
    opts.action.onPress();
    expect(writes.updateEntry).toHaveBeenLastCalledWith('r1', expect.objectContaining({ mealType: 'lunch' }));
  });

  it('does nothing for a move into the slot it is already in', async () => {
    const { ref, writes, render: r } = setup();
    await r();
    await act(async () => ref.current!.moveToSlot(lunch, 'lunch'));
    expect(writes.updateEntry).not.toHaveBeenCalled();
    expect(mockShow).not.toHaveBeenCalled();
  });

  it('says so when the move is refused', async () => {
    const updateEntry = jest.fn().mockRejectedValue(new Error('permission-denied'));
    const { ref, render: r } = setup({ updateEntry });
    await r();
    await act(async () => ref.current!.moveToSlot(lunch, 'snack'));
    expect(haptics.warning).toHaveBeenCalled();
    expect(mockShow).toHaveBeenLastCalledWith("Couldn't save that change. Open the entry to try again.");
  });
});

describe('Copy to today', () => {
  it('is the row again, stamped now, without the original createdAt', () => {
    const now = new Date(2026, 9, 4, 19, 0);
    const copy = copyForToday(lunch, now);
    expect(copy.timestamp).toBe(now);
    expect(copy.mealType).toBe('lunch');
    expect(copy.calories).toBe(450);
    expect('createdAt' in copy).toBe(false);
  });

  it('adds through the durable path with the named receipt and its Undo', async () => {
    const { ref, writes, render: r } = setup();
    await r();
    await act(async () => {
      await ref.current!.copyToToday(lunch);
    });
    expect(writes.addEntry).toHaveBeenCalledWith(expect.objectContaining({ calories: 450, mealLabel: 'Chicken bowl' }));
    const [msg, opts] = mockShow.mock.calls[0];
    expect(msg).toBe('Logged Chicken bowl · 450 kcal');
    expect(opts.action.label).toBe('Undo');
    // No "Edit": the copy is on Today, not on the day this screen shows.
    expect(opts.secondaryAction).toBeUndefined();
    expect(haptics.success).toHaveBeenCalledTimes(1);
  });
});

describe('re-score helpers', () => {
  it('grows the context-menu preview with the text, up to the cap its text carries', () => {
    expect(previewHeight({}, 1)).toBe(176);
    expect(previewHeight({ note: 'x' }, 1)).toBe(220);
    expect(previewHeight({}, 1.2)).toBe(Math.round(176 * 1.2));
    expect(previewHeight({}, 3)).toBe(Math.round(176 * 1.3));
    // A smaller-than-default text size never shrinks the box below its 1× size.
    expect(previewHeight({}, 0.8)).toBe(176);
  });

  it('jumps a ring for a hairline change and sweeps for a visible one', () => {
    expect(sweeps(null, 0.4)).toBe(true);
    expect(sweeps(0.4, 0.41)).toBe(false);
    expect(sweeps(0.4, 0.43)).toBe(true);
    expect(sweeps(0.43, 0.4)).toBe(true);
  });

  it('flares the calorie ring only on coming INTO ±5% of the target, from either side', () => {
    expect(enteredCalorieBand(1700, 1950, 2000)).toBe(true);
    expect(enteredCalorieBand(2300, 2080, 2000)).toBe(true);
    // Already there, or still outside: no flare.
    expect(enteredCalorieBand(1960, 2010, 2000)).toBe(false);
    expect(enteredCalorieBand(1500, 1800, 2000)).toBe(false);
    // Mount, or no target: never.
    expect(enteredCalorieBand(null, 2000, 2000)).toBe(false);
    expect(enteredCalorieBand(1500, 2000, 0)).toBe(false);
  });
});
