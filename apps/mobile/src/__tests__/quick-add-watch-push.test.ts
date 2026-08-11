/**
 * A quick-add must reach the WATCH, not just the phone's own widget.
 *
 * This is the gap that made the complication look broken after build 44 shipped
 * the two-queue transport. The transport was fine — the diagnostics showed the
 * complication on the active face and 44 of the day's 50 wake-ups still
 * unspent. What was missing is that `performQuickAdd` never asked for one:
 *
 *   - it persists the optimistic snapshot through `saveWidgetSnapshot`, which
 *     is Android-only and pushes nowhere, and
 *   - it is the one write path that does NOT pass through `syncWidget`, where
 *     the watch push lives inside `persist()`.
 *
 * So a quick-added meal moved the phone's widget and left the wrist showing
 * stale numbers until the app was next opened on Today. The assertion below is
 * cheap; the bug was invisible for as long as nobody watched a face after a
 * quick-add.
 */
const mockAssertWatchSnapshot = jest.fn();
const mockSaveWidgetSnapshot = jest.fn(async () => undefined);
const mockLogQuickAdd = jest.fn(async () => 'ok' as const);

const SNAPSHOT = {
  v: 1,
  dateKey: '2026-08-11',
  kcalConsumed: 1200,
  kcalTarget: 1850,
  proteinConsumed: 90,
  proteinTarget: 140,
  updatedMs: 1_000,
  locale: 'en',
  quickAdd: [{ name: 'Overnight oats', calories: 520, protein: 57.8 }],
};

jest.mock('@/lib/widget', () => ({
  APP_GROUP: 'group.test',
  readWidgetSnapshot: async () => SNAPSHOT,
  saveWidgetSnapshot: (...a: unknown[]) => mockSaveWidgetSnapshot(...(a as [])),
  assertWatchSnapshot: (...a: unknown[]) => mockAssertWatchSnapshot(...(a as [])),
}));

jest.mock('@/lib/ledger', () => ({ addLogWithId: jest.fn(async () => undefined) }));
jest.mock('@/lib/health-sync', () => ({ exportNutrition: jest.fn() }));
jest.mock('@/lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: () => () => {} },
}));

import * as quickAdd from '@/lib/quick-add';

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(quickAdd, 'logQuickAdd').mockImplementation(mockLogQuickAdd as never);
});

describe('performQuickAdd', () => {
  it('pushes the optimistic snapshot to the watch, not just to local storage', async () => {
    await quickAdd.performQuickAdd(0, new Date('2026-08-11T15:00:00Z'));

    expect(mockAssertWatchSnapshot).toHaveBeenCalledTimes(1);
    const pushed = mockAssertWatchSnapshot.mock.calls[0][0] as typeof SNAPSHOT;
    // The snapshot that reaches the watch must be the UPDATED one — pushing the
    // pre-add blob would spend a wake-up to redraw the same numbers.
    expect(pushed.kcalConsumed).toBeGreaterThan(SNAPSHOT.kcalConsumed);
  });

  it('still writes local storage — the watch push is additive, not a swap', async () => {
    await quickAdd.performQuickAdd(0, new Date('2026-08-11T15:00:00Z'));
    expect(mockSaveWidgetSnapshot).toHaveBeenCalledTimes(1);
  });

  it('pushes nothing when the slot has no preset', async () => {
    await quickAdd.performQuickAdd(9, new Date('2026-08-11T15:00:00Z'));
    expect(mockAssertWatchSnapshot).not.toHaveBeenCalled();
  });
});
