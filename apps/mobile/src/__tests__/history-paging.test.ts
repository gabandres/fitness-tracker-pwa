import { type DailyLog, dayBoundaryOf } from '@macrolog/core';
import { mergeLogs, monthKeyOf, monthRange, monthToFetch, oldestLogKey } from '@/lib/history-paging';

/**
 * Paging the History calendar past the 400-row window (UX_AUDIT S18-13).
 *
 * Three decisions, each pure: which month to fetch, what ends up on screen
 * once it lands, and that nothing is fetched twice. The hook (`useHistory`)
 * holds the state; these are the rules it applies.
 */

const view = (y: number, m: number) => new Date(y, m - 1, 15);

function row(id: string, iso: string, calories = 500): DailyLog {
  return { id, calories, date: new Date(iso) };
}

describe('monthKeyOf / monthRange', () => {
  it('names the month and its inclusive first and last day', () => {
    expect(monthKeyOf(view(2026, 9))).toBe('2026-09');
    expect(monthRange('2026-09')).toEqual({ fromKey: '2026-09-01', toKey: '2026-09-30' });
    // A leap February, since "last day" is where a hand-rolled calendar goes wrong.
    expect(monthRange('2024-02')).toEqual({ fromKey: '2024-02-01', toKey: '2024-02-29' });
    expect(monthRange('2026-02').toKey).toBe('2026-02-28');
    expect(monthRange('2026-12')).toEqual({ fromKey: '2026-12-01', toKey: '2026-12-31' });
  });
});

describe('monthToFetch — which months need a query', () => {
  const none = new Set<string>();

  it('nothing while the window has room — everything is already loaded', () => {
    expect(
      monthToFetch({ view: view(2020, 1), oldestWindowKey: '2026-09-01', windowRows: 399, requested: none }),
    ).toBeNull();
  });

  it('nothing with no rows at all (the window has not answered yet)', () => {
    expect(monthToFetch({ view: view(2020, 1), oldestWindowKey: null, windowRows: 0, requested: none })).toBeNull();
  });

  it('nothing for a month the full window already covers', () => {
    expect(
      monthToFetch({ view: view(2026, 9), oldestWindowKey: '2026-09-01', windowRows: 400, requested: none }),
    ).toBeNull();
    expect(
      monthToFetch({ view: view(2026, 10), oldestWindowKey: '2026-09-01', windowRows: 400, requested: none }),
    ).toBeNull();
  });

  it('the viewed month when it starts before the oldest row of a full window', () => {
    expect(
      monthToFetch({ view: view(2026, 8), oldestWindowKey: '2026-09-01', windowRows: 400, requested: none }),
    ).toBe('2026-08');
  });

  it("the oldest row's OWN month when the window starts mid-month — its early days are missing", () => {
    expect(
      monthToFetch({ view: view(2026, 9), oldestWindowKey: '2026-09-14', windowRows: 400, requested: none }),
    ).toBe('2026-09');
  });

  it('never the same month twice — requested covers in-flight and done alike', () => {
    const requested = new Set(['2026-08']);
    expect(
      monthToFetch({ view: view(2026, 8), oldestWindowKey: '2026-09-01', windowRows: 400, requested }),
    ).toBeNull();
    // A different month is still fetched.
    expect(
      monthToFetch({ view: view(2026, 7), oldestWindowKey: '2026-09-01', windowRows: 400, requested }),
    ).toBe('2026-07');
  });

  it('honours a custom window capacity', () => {
    expect(
      monthToFetch({
        view: view(2026, 8),
        oldestWindowKey: '2026-09-01',
        windowRows: 10,
        requested: none,
        windowCapacity: 10,
      }),
    ).toBe('2026-08');
  });
});

describe('oldestLogKey', () => {
  it('returns the earliest day key under the boundary, or null', () => {
    expect(oldestLogKey([], dayBoundaryOf(null))).toBeNull();
    const logs = [row('a', '2026-09-12T12:00:00'), row('b', '2026-09-10T12:00:00'), row('c', '2026-09-11T12:00:00')];
    expect(oldestLogKey(logs, dayBoundaryOf(null))).toBe('2026-09-10');
  });
});

describe('mergeLogs — what ends up on screen', () => {
  it('returns the window plus every fetched month, oldest first', () => {
    const windowLogs = [row('w1', '2026-09-14T08:00:00'), row('w2', '2026-09-20T08:00:00')];
    const fetched = {
      '2026-08': [row('a1', '2026-08-03T08:00:00'), row('a2', '2026-08-30T08:00:00')],
      '2026-07': [row('j1', '2026-07-15T08:00:00')],
    };
    expect(mergeLogs(windowLogs, fetched).map((l) => l.id)).toEqual(['j1', 'a1', 'a2', 'w1', 'w2']);
  });

  it('deduplicates by id and lets the LIVE window win a collision', () => {
    // The oldest row's own month overlaps the window; the fetched copy is a
    // snapshot, the window copy is live and may carry an edit.
    const windowLogs = [row('x', '2026-09-14T08:00:00', 700)];
    const fetched = { '2026-09': [row('s', '2026-09-02T08:00:00'), row('x', '2026-09-14T08:00:00', 500)] };
    const merged = mergeLogs(windowLogs, fetched);
    expect(merged.map((l) => l.id)).toEqual(['s', 'x']);
    expect(merged[1].calories).toBe(700);
  });

  it('with nothing fetched, is the window unchanged in content', () => {
    const windowLogs = [row('w1', '2026-09-14T08:00:00'), row('w2', '2026-09-20T08:00:00')];
    expect(mergeLogs(windowLogs, {})).toEqual(windowLogs);
  });
});

describe('mergeLogs — same-minute rows (2026-10-03)', () => {
  it('lists rows sharing a minute in logged order, not by their random ids', () => {
    const at = '2026-10-03T12:15:00Z';
    const eggs = { ...row('zz', at), createdAt: new Date('2026-10-04T01:00:00Z') };
    const pancake = { ...row('aa', at), createdAt: new Date('2026-10-04T01:01:00Z') };
    const fruit = { ...row('mm', at), createdAt: new Date('2026-10-04T01:02:00Z') };
    expect(mergeLogs([fruit, pancake], { '2026-10': [eggs] }).map((l) => l.id)).toEqual(['zz', 'aa', 'mm']);
  });
});
