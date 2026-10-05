/**
 * The pure halves of the Today review fixes (UX_AUDIT Today review,
 * 2026-10-04): one haptic per log (#7), the receipt's remaining figure (U6),
 * the diary's slot list and cascade (U3, #1, V6), and the slot seed a "+ Add"
 * carries into the sheet (U3).
 */
// `@/i18n` (via MealEntries) reaches the auth module, which imports firebase.
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
// `jest.setup.js` mocks the haptics module for every suite; this one tests it.
jest.unmock('@/lib/haptics');
jest.mock('expo-haptics', () => ({
  impactAsync: jest.fn().mockResolvedValue(undefined),
  notificationAsync: jest.fn().mockResolvedValue(undefined),
  selectionAsync: jest.fn().mockResolvedValue(undefined),
  performAndroidHapticsAsync: jest.fn().mockResolvedValue(undefined),
  ImpactFeedbackStyle: { Light: 'light', Medium: 'medium', Soft: 'soft' },
  NotificationFeedbackType: { Success: 'success', Warning: 'warning' },
  AndroidHaptics: { Confirm: 'confirm', Reject: 'reject', Segment_Tick: 'segment-tick', Virtual_Key: 'virtual-key', Gesture_End: 'gesture-end' },
}));

import * as Haptics from 'expo-haptics';
import { type DailyLog, type DateKey, dayBoundaryOf } from '@macrolog/core';
import { diarySlots, groupStartIndexes } from '@/components/MealEntries';
import { remainingAfterAdd, willCelebrate } from '@/lib/celebration';
import { encodeEntryPrefill, isDraftPrefill, parseEntryPrefill } from '@/lib/entry-prefill';
import * as haptics from '@/lib/haptics';

const boundary = dayBoundaryOf(null);
const todayKey = '2026-10-04' as DateKey;
const at = (h: number, day = 4) => new Date(2026, 9, day, h, 0);

describe('willCelebrate — the save plays the one celebration', () => {
  const base = { todayKey, boundary, proteinTarget: 150 };

  it('is the first food row of the day (the streak extends)', () => {
    expect(willCelebrate({ ...base, entry: { calories: 300 }, todayFoodRows: 0, proteinSoFar: 0 })).toBe(true);
    expect(willCelebrate({ ...base, entry: { calories: 300 }, todayFoodRows: 2, proteinSoFar: 40 })).toBe(false);
  });

  it('is the add that closes the protein ring, and only that one', () => {
    const entry = { calories: 300, protein: 30 };
    expect(willCelebrate({ ...base, entry, todayFoodRows: 3, proteinSoFar: 125 })).toBe(true);
    // Already closed: no second celebration for the next meal.
    expect(willCelebrate({ ...base, entry, todayFoodRows: 3, proteinSoFar: 150 })).toBe(false);
    // Short of it.
    expect(willCelebrate({ ...base, entry, todayFoodRows: 3, proteinSoFar: 100 })).toBe(false);
    // No target, no ring to close.
    expect(willCelebrate({ ...base, proteinTarget: 0, entry, todayFoodRows: 3, proteinSoFar: 125 })).toBe(false);
  });

  it('never for an entry timed onto another day', () => {
    const entry = { calories: 300, protein: 80, timestamp: at(12, 3) };
    expect(willCelebrate({ ...base, entry, todayFoodRows: 0, proteinSoFar: 100 })).toBe(false);
  });
});

describe('remainingAfterAdd — "1,050 left" in the receipt', () => {
  const base = { todayKey, boundary, consumed: 900, target: 2000 };
  it('is the target minus everything, this add included; negative is over', () => {
    expect(remainingAfterAdd({ ...base, kcal: 50 })).toBe(1050);
    expect(remainingAfterAdd({ ...base, kcal: 1300 })).toBe(-200);
  });
  it('says nothing with no target or for another day', () => {
    expect(remainingAfterAdd({ ...base, target: 0, kcal: 50 })).toBeNull();
    expect(remainingAfterAdd({ ...base, kcal: 50, timestamp: at(9, 2) })).toBeNull();
  });
});

describe('haptics — one outcome per gesture', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    haptics.__resetHaptics();
  });
  afterEach(() => jest.useRealTimers());

  it('drops the leading tap when the outcome lands inside the grace window', () => {
    haptics.tapThenOutcome();
    jest.advanceTimersByTime(100);
    haptics.success();
    jest.advanceTimersByTime(haptics.LEAD_TAP_GRACE_MS);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
  });

  it('still acknowledges a press whose outcome is slow', () => {
    haptics.tapThenOutcome();
    jest.advanceTimersByTime(haptics.LEAD_TAP_GRACE_MS + 1);
    expect(Haptics.impactAsync).toHaveBeenCalledTimes(1);
  });

  it('keeps an effect-raised celebration quiet right after the save’s haptic', () => {
    haptics.success();
    haptics.celebrateIfQuiet();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(haptics.OUTCOME_QUIET_MS + 1);
    haptics.celebrateIfQuiet();
    expect(Haptics.notificationAsync).toHaveBeenCalledTimes(2);
  });

  it('plays a delete as a knock, never as a success', () => {
    haptics.removed();
    expect(Haptics.notificationAsync).not.toHaveBeenCalled();
    expect(Haptics.impactAsync).toHaveBeenCalledWith('medium');
  });

  it('plays a stepper as a selection tick', () => {
    haptics.selection();
    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
  });
});

describe('MealEntries slot list', () => {
  const row = (id: string, mealType?: DailyLog['mealType']): DailyLog =>
    ({ id, calories: 100, date: at(8), mealType }) as DailyLog;

  it('computes each group’s cascade start before rendering (no row++ in the map)', () => {
    expect(groupStartIndexes([{ entries: [row('a'), row('b')] }, { entries: [] }, { entries: [row('c')] }])).toEqual([
      0, 2, 2,
    ]);
  });

  it('always lists the four meals when the diary can add, empty ones included', () => {
    const slots = diarySlots([row('a', 'lunch')], true);
    expect(slots.map((g) => g.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack']);
    expect(slots[1].entries).toHaveLength(1);
    expect(slots[0]).toEqual({ slot: 'breakfast', entries: [], totalCalories: 0 });
  });

  it('adds "other" only when a row is filed there, and is plain grouping otherwise', () => {
    expect(diarySlots([row('a')], true).map((g) => g.slot)).toEqual(['breakfast', 'lunch', 'dinner', 'snack', 'other']);
    expect(diarySlots([row('a', 'dinner')], false).map((g) => g.slot)).toEqual(['dinner']);
    expect(diarySlots([], true)).toHaveLength(4);
  });
});

describe('entry-prefill slot seed', () => {
  it('round-trips a bare meal slot, which is not a draft', () => {
    const seed = parseEntryPrefill(encodeEntryPrefill({ mealType: 'dinner' }));
    expect(seed).toEqual({ mealType: 'dinner' });
    expect(isDraftPrefill(seed)).toBe(false);
  });

  it('keeps a slot riding on a draft, and a draft is a draft', () => {
    const p = parseEntryPrefill(JSON.stringify({ calories: 300, mealType: 'lunch' }));
    expect(p).toEqual({ calories: 300, mealType: 'lunch' });
    expect(isDraftPrefill(p)).toBe(true);
  });

  it('refuses a slot that is not one of the four', () => {
    expect(parseEntryPrefill(JSON.stringify({ mealType: 'other' }))).toBeNull();
    expect(parseEntryPrefill(JSON.stringify({ mealType: 'brunch' }))).toBeNull();
  });
});
