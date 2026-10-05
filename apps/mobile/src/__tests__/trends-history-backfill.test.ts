import { renderHook, waitFor } from '@testing-library/react-native';
import { LOG_WINDOW_ROWS, MIDNIGHT, type DailyLog, type TdeeSeriesPoint } from '@macrolog/core';

/**
 * Trends over a ROW window (review S20, bug 1). `useCoreSnapshot` holds 400
 * entries, not days: a 7-entry-a-day logger's cache covers ~57 days while the
 * 3M chart spans 90 and its replay needs 84 before that. The hook fetches the
 * stretch the cache cannot cover — once, bounded, and only when the cache is
 * full — and clips honestly when it cannot.
 */

const mockNow = new Date(2026, 9, 4, 15, 0); // Sun 2026-10-04
const NOW = mockNow;

const mockGetLogsForRange = jest.fn();
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/lib/ledger', () => ({
  getLogsForRange: (...a: unknown[]) => mockGetLogsForRange(...a),
  subscribeMilestones: () => () => undefined,
}));
let mockSnapshot: { logs: DailyLog[]; weights: Record<string, number>; profile: null; loaded: boolean; error: null };
jest.mock('@/hooks/useCoreSnapshot', () => ({ useCoreSnapshot: () => mockSnapshot }));
jest.mock('@/hooks/useFocusDay', () => ({ useFocusDay: () => mockNow }));
jest.mock('@/hooks/useLedgerFeed', () => ({ feedChannel: (s: unknown) => s, useLedgerFeed: () => ({ ready: true, error: null }) }));
jest.mock('@/hooks/useSleepTrends', () => ({ useSleepTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useFastingTrends', () => ({ useFastingTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useWaterTrends', () => ({ useWaterTrends: () => ({ kind: 'pending' }) }));
jest.mock('@/hooks/useCompositionTrends', () => ({
  useCompositionTrends: () => ({ enabled: false, composition: null, recomp: null, lastTapeAt: null, female: false }),
}));

import { mergeSeries, replaySignature, useTrends, withOlderRows } from '@/hooks/useTrends';

function dayAt(daysAgo: number, hour: number): Date {
  const d = new Date(NOW);
  d.setHours(hour, 0, 0, 0);
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

beforeEach(() => {
  mockGetLogsForRange.mockReset();
});

describe('a full 400-row cache', () => {
  // 400 rows at 7 a day: the newest 57 days complete, plus 1 row of day 57.
  const all = rows(200, 0);
  const cache = all.slice(-LOG_WINDOW_ROWS);

  it('fetches exactly the stretch the cache cannot cover, and the old days then read as logged', async () => {
    mockSnapshot = { logs: cache, weights: {}, profile: null, loaded: true, error: null };
    mockGetLogsForRange.mockImplementation(async () => all.filter((l) => l.date < cache[0].date || l.id === cache[0].id));
    const { result } = await renderHook(() => useTrends(90));
    expect(mockGetLogsForRange).toHaveBeenCalledTimes(1);
    // 90 days on screen + the estimator's 84-day lookback, up to the cache's
    // oldest (partial) day; midnight-keyed, bounded rows.
    expect(mockGetLogsForRange).toHaveBeenCalledWith('u1', key(89 + 84), key(57), MIDNIGHT, 4000);
    await waitFor(() => expect(result.current.intakeSeries[result.current.intakeSeries.length - 1 - 70]).toBe(2100));
    // The cache's own partial oldest day is whole again.
    expect(result.current.intakeSeries[result.current.intakeSeries.length - 1 - 57]).toBe(2100);
    expect(result.current.historyClip).toBeNull();
    await waitFor(() => expect(result.current.expenditure?.length ?? 0).toBeGreaterThanOrEqual(90));
  });

  it('clips to the days the cache covers in full when the fetch fails, instead of "nothing logged"', async () => {
    mockSnapshot = { logs: cache, weights: {}, profile: null, loaded: true, error: null };
    mockGetLogsForRange.mockRejectedValue(new Error('offline'));
    const { result } = await renderHook(() => useTrends(90));
    await waitFor(() => expect(result.current.historyClip).toEqual({ days: 57, reason: 'failed' }));
    // The replay still runs, from the cache alone.
    await waitFor(() => expect(result.current.expenditure).not.toBeNull());
  });
});

it('costs no reads at all when the cache holds the whole history', async () => {
  mockSnapshot = { logs: rows(30, 0), weights: {}, profile: null, loaded: true, error: null };
  const { result } = await renderHook(() => useTrends(90));
  await waitFor(() => expect(result.current.expenditure).not.toBeNull());
  expect(mockGetLogsForRange).not.toHaveBeenCalled();
  expect(result.current.historyClip).toBeNull();
});

it('"Last 7 days" ends YESTERDAY — a half-logged today is not a day', async () => {
  // Six full days ending yesterday, and 380 kcal so far today.
  mockSnapshot = {
    logs: [...rows(6, 1), { id: 'lunch', date: dayAt(0, 12), calories: 380 }],
    weights: {},
    profile: null,
    loaded: true,
    error: null,
  };
  const { result } = await renderHook(() => useTrends(30));
  expect(result.current.insightWindow).toEqual({ from: key(7), to: key(1) });
  expect(result.current.loggedThisWeek).toBe(6);
});

describe('helpers', () => {
  it('withOlderRows takes only rows older than the cache, so a deleted cache row cannot come back', () => {
    const cache: DailyLog[] = [
      { id: 'b', date: new Date(2026, 9, 1, 9), calories: 200 },
      { id: 'c', date: new Date(2026, 9, 1, 12), calories: 300 },
    ];
    const older: DailyLog[] = [
      { id: 'a', date: new Date(2026, 9, 1, 8), calories: 100 },
      { id: 'b', date: new Date(2026, 9, 1, 9), calories: 200 },
      // Deleted from the live cache since the fetch.
      { id: 'gone', date: new Date(2026, 9, 1, 10), calories: 999 },
    ];
    expect(withOlderRows(cache, older).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('mergeSeries lets a newer chunk replace a day, oldest first', () => {
    const p = (dateKey: string, kcal: number) => ({ dateKey, kcal, source: 'measured', ci95: null, holding: false }) as TdeeSeriesPoint;
    expect(mergeSeries([p('2026-10-02', 1), p('2026-10-03', 1)], [p('2026-10-03', 2), p('2026-10-01', 2)]).map((x) => [x.dateKey, x.kcal])).toEqual([
      ['2026-10-01', 2],
      ['2026-10-02', 1],
      ['2026-10-03', 2],
    ]);
  });

  it('replaySignature is equal for equal data in fresh arrays, and moves with an edit', () => {
    const a = rows(3, 0);
    const b = a.map((l) => ({ ...l }));
    expect(replaySignature(null, a, { '2026-10-01': 180 }, NOW, 0)).toBe(replaySignature(null, b, { '2026-10-01': 180 }, NOW, 0));
    b[0] = { ...b[0], calories: 301 };
    expect(replaySignature(null, a, {}, NOW, 0)).not.toBe(replaySignature(null, b, {}, NOW, 0));
    expect(replaySignature(null, a, {}, NOW, 0)).not.toBe(replaySignature(null, a, {}, NOW, 1));
  });
});
