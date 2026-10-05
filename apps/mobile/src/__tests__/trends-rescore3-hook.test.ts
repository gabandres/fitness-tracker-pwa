import { act, renderHook, waitFor } from '@testing-library/react-native';
import { LOG_WINDOW_ROWS, MIDNIGHT, type DailyLog, type DateKey } from '@macrolog/core';

/**
 * Trends re-score 3, the data layer: the backfill reads only the gap when the
 * cache's oldest day moves or the range grows (B3), and the day in progress is
 * the user's own day, not the last calendar key (B4).
 */

let mockNow = new Date(2026, 9, 4, 15, 0); // Sun 2026-10-04

const mockGetLogsForRange = jest.fn();
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/lib/ledger', () => ({
  getLogsForRange: (...a: unknown[]) => mockGetLogsForRange(...a),
  subscribeMilestones: () => () => undefined,
}));
let mockSnapshot: { logs: DailyLog[]; weights: Record<string, number>; profile: unknown; loaded: boolean; error: null };
jest.mock('@/hooks/useCoreSnapshot', () => ({ useCoreSnapshot: () => mockSnapshot }));
jest.mock('@/hooks/useFocusDay', () => ({ useFocusDay: () => mockNow }));
jest.mock('@/hooks/useLedgerFeed', () => ({ feedChannel: (s: unknown) => s, useLedgerFeed: () => ({ ready: true, error: null }) }));
jest.mock('@/hooks/useSleepTrends', () => ({ useSleepTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useFastingTrends', () => ({ useFastingTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useWaterTrends', () => ({ useWaterTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useCompositionTrends', () => ({
  useCompositionTrends: () => ({ enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false }),
}));

import { mergeBackfill, planBackfill, useTrends, type Backfill } from '@/hooks/useTrends';

const BASE = new Date(2026, 9, 4, 15, 0);

function dayAt(daysAgo: number, hour: number, minute = 0): Date {
  const d = new Date(BASE);
  d.setHours(hour, minute, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function key(daysAgo: number): string {
  const d = dayAt(daysAgo, 12);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Seven entries a day, 300 kcal each, over `[fromAgo, toAgo]` days ago — oldest first. */
function rows(fromAgo: number, toAgo: number): DailyLog[] {
  const out: DailyLog[] = [];
  for (let i = fromAgo; i >= toAgo; i--) {
    for (let h = 7; h < 14; h++) out.push({ id: `${i}-${h}`, date: dayAt(i, h), calories: 300 });
  }
  return out;
}

/** The fake server: every row of `all` whose day is in [fromKey, toKey]. */
function serve(all: DailyLog[]) {
  return async (_uid: string, fromKey: string, toKey: string) =>
    all.filter((l) => {
      const k = `${l.date.getFullYear()}-${String(l.date.getMonth() + 1).padStart(2, '0')}-${String(l.date.getDate()).padStart(2, '0')}`;
      return k >= fromKey && k <= toKey;
    });
}

beforeEach(() => {
  mockGetLogsForRange.mockReset();
  mockNow = new Date(BASE);
});

describe('the backfill reads only what it does not hold (B3)', () => {
  it('reads just the newer gap when the cache moves forward, and keeps the old days drawn meanwhile', async () => {
    const all = rows(200, 0);
    // Today's late entries — 14 more rows push the 400-row window two days forward.
    const extra: DailyLog[] = Array.from({ length: 14 }, (_, i) => ({ id: `x${i}`, date: dayAt(0, 14, i * 2), calories: 10 }));
    mockSnapshot = { logs: all.slice(-LOG_WINDOW_ROWS), weights: {}, profile: null, loaded: true, error: null };
    mockGetLogsForRange.mockImplementation(serve(all));
    const view = await renderHook(() => useTrends(90));
    await waitFor(() => expect(view.result.current.intakeSeries[view.result.current.intakeSeries.length - 1 - 70]).toBe(2100));
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(1);
    expect(mockGetLogsForRange).toHaveBeenLastCalledWith('u1', key(173), key(57), MIDNIGHT, 4000);

    // The gap read is held open so the in-between state can be checked.
    let release: (r: DailyLog[]) => void = () => {};
    mockGetLogsForRange.mockImplementation(
      () =>
        new Promise<DailyLog[]>((resolve) => {
          release = resolve;
        }),
    );
    mockSnapshot = { ...mockSnapshot, logs: [...all, ...extra].slice(-LOG_WINDOW_ROWS) };
    await view.rerender(undefined);
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(2);
    // From the old edge day (re-read, so a row deleted there cannot survive)
    // to the new one — not the whole 173 days again.
    expect(mockGetLogsForRange).toHaveBeenLastCalledWith('u1', key(57), key(55), MIDNIGHT, 4000);
    // The held rows keep drawing: day 70 did not blink to "nothing logged".
    expect(view.result.current.intakeSeries[view.result.current.intakeSeries.length - 1 - 70]).toBe(2100);

    await act(async () => release(await serve(all)('u1', key(57), key(55))));
    await waitFor(() => expect(view.result.current.intakeSeries[view.result.current.intakeSeries.length - 1 - 56]).toBe(2100));
    expect(view.result.current.historyClip).toBeNull();
  });

  it('reads just the older gap when the range grows', async () => {
    const all = rows(200, 0);
    mockSnapshot = { logs: all.slice(-LOG_WINDOW_ROWS), weights: {}, profile: null, loaded: true, error: null };
    mockGetLogsForRange.mockImplementation(serve(all));
    let days = 30;
    const view = await renderHook(() => useTrends(days));
    await waitFor(() => expect(mockGetLogsForRange).toHaveBeenCalledTimes(1));
    expect(mockGetLogsForRange).toHaveBeenLastCalledWith('u1', key(29 + 84), key(57), MIDNIGHT, 4000);
    await waitFor(() => expect(view.result.current.expenditure).not.toBeNull());
    days = 90;
    await view.rerender(undefined);
    await waitFor(() => expect(mockGetLogsForRange).toHaveBeenCalledTimes(2));
    expect(mockGetLogsForRange).toHaveBeenLastCalledWith('u1', key(89 + 84), key(29 + 84 + 1), MIDNIGHT, 4000);
  });
});

describe('planBackfill / mergeBackfill', () => {
  const dk = (k: string) => k as DateKey;
  const held: Backfill = {
    uid: 'u1',
    refreshKey: 0,
    fromKey: dk('2026-05-01'),
    toKey: dk('2026-08-01'),
    status: 'done',
    rows: [
      { id: 'old', date: new Date(2026, 3, 30, 9), calories: 1 },
      { id: 'a', date: new Date(2026, 4, 2, 9), calories: 1 },
      { id: 'edge', date: new Date(2026, 7, 1, 9), calories: 1 },
    ],
  };

  it('plans nothing when covered, a gap at each end otherwise, and a fresh read on refresh or another account', () => {
    expect(planBackfill(held, { uid: 'u1', refreshKey: 0, fromKey: dk('2026-05-03'), toKey: dk('2026-07-30') })).toBeNull();
    expect(planBackfill(held, { uid: 'u1', refreshKey: 0, fromKey: dk('2026-04-20'), toKey: dk('2026-08-03') })?.ranges).toEqual([
      { fromKey: dk('2026-04-20'), toKey: dk('2026-04-30') },
      { fromKey: dk('2026-08-01'), toKey: dk('2026-08-03') },
    ]);
    expect(planBackfill(held, { uid: 'u1', refreshKey: 1, fromKey: dk('2026-05-03'), toKey: dk('2026-07-30') })?.ranges).toEqual([
      { fromKey: dk('2026-05-03'), toKey: dk('2026-07-30') },
    ]);
    expect(planBackfill(held, { uid: 'u2', refreshKey: 0, fromKey: dk('2026-05-03'), toKey: dk('2026-07-30') })?.base).toBeNull();
  });

  it('replaces re-read days and drops rows older than the need', () => {
    const plan = planBackfill(held, { uid: 'u1', refreshKey: 0, fromKey: dk('2026-05-02'), toKey: dk('2026-08-03') })!;
    // The edge row was deleted since the first read; the re-read omits it.
    const merged = mergeBackfill(plan, [[{ id: 'new', date: new Date(2026, 7, 2, 9), calories: 1 }]]);
    expect(merged.rows.map((l) => l.id)).toEqual(['a', 'new']);
    expect([merged.fromKey, merged.toKey]).toEqual(['2026-05-02', '2026-08-03']);
  });
});

describe('the day in progress is the user’s own day (B4)', () => {
  it('between midnight and a 03:00 day start, today is still yesterday’s calendar date', async () => {
    mockNow = new Date(2026, 9, 5, 1, 0); // 01:00 Mon, boundary 03:00
    mockSnapshot = {
      logs: [{ id: 'late', date: new Date(2026, 9, 5, 0, 30), calories: 400 }],
      weights: {},
      profile: { dayBoundary: [{ from: '2026-01-01', hour: 3 }] },
      loaded: true,
      error: null,
    };
    const { result } = await renderHook(() => useTrends(30));
    expect(result.current.chartKeys[result.current.chartKeys.length - 1]).toBe('2026-10-05');
    expect(result.current.todayKey).toBe('2026-10-04');
    // The 00:30 entry belongs to the boundary day still in progress.
    expect(result.current.intakeSeries[result.current.intakeSeries.length - 2]).toBe(400);
  });

  it('plots carbs and fat, a zero (an entry without the field) as a gap', async () => {
    mockSnapshot = {
      logs: [
        { id: 'a', date: dayAt(1, 12), calories: 500, carbs: 60, fat: 0 },
        { id: 'b', date: dayAt(2, 12), calories: 500 },
      ],
      weights: {},
      profile: null,
      loaded: true,
      error: null,
    };
    const { result } = await renderHook(() => useTrends(30));
    const n = result.current.chartKeys.length;
    expect(result.current.carbsSeries[n - 2]).toBe(60);
    expect(result.current.fatSeries[n - 2]).toBeNull();
    expect(result.current.carbsSeries[n - 3]).toBeNull();
  });
});
