import { describe, expect, it } from 'vitest';
import { type DayBoundary, MIDNIGHT } from './day-boundary';
import {
  LOG_WINDOW_ROWS,
  RECENT_LOGS_ROWS,
  isoWeek,
  trailingDateKeys,
  weightPointsForDays,
  weightSeriesForDays,
} from './log-window';

// Wednesday 2026-08-12, so Monday is the 10th and Sunday the 16th.
const WED = new Date(2026, 7, 12, 9, 0);

describe('named windows', () => {
  it('keeps the two ROW windows distinct — they are not days', () => {
    expect(LOG_WINDOW_ROWS).toBe(400);
    expect(RECENT_LOGS_ROWS).toBe(14);
    expect(LOG_WINDOW_ROWS).not.toBe(RECENT_LOGS_ROWS);
  });
});

describe('trailingDateKeys', () => {
  it('ends at today and runs oldest-first', () => {
    expect(trailingDateKeys(3, WED)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
  });

  it('handles n = 1 and n = 0', () => {
    expect(trailingDateKeys(1, WED)).toEqual(['2026-08-12']);
    expect(trailingDateKeys(0, WED)).toEqual([]);
  });

  it('crosses a month boundary', () => {
    expect(trailingDateKeys(3, new Date(2026, 7, 1, 9, 0))).toEqual([
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
    ]);
  });
});

describe('weightSeriesForDays', () => {
  const weights = { '2026-08-10': 181, '2026-08-12': 180.4 };

  it('drops days with no weigh-in rather than plotting a zero', () => {
    expect(weightSeriesForDays(weights, 3, WED)).toEqual([181, 180.4]);
  });

  it('is empty when nothing falls in the window', () => {
    expect(weightSeriesForDays(weights, 1, new Date(2026, 7, 11, 9, 0))).toEqual([]);
  });
});

describe('weightPointsForDays', () => {
  it('keeps the day each weight belongs to, oldest first', () => {
    expect(weightPointsForDays({ '2026-08-11': 180.8, '2026-08-12': 180.4 }, 2, WED)).toEqual([
      { dateKey: '2026-08-11', weightLb: 180.8 },
      { dateKey: '2026-08-12', weightLb: 180.4 },
    ]);
  });
});

/**
 * ADR-0030 step 3. These two windows took `boundary` late: the Trends screen
 * had a boundary-aware sleep card sitting beside a midnight-only weight trend
 * and calorie insight, so one screen keyed two cards to two different
 * calendars. The ratchet in `scripts/check-day-boundary.mjs` cannot catch that
 * class — it greps for `calendarDateKey`, and none of these call it.
 */
describe('the weight windows respect the day boundary', () => {
  /** Days start at 03:00 from 2026-01-01 on. */
  const THREE_AM: DayBoundary = [{ from: '2026-01-01' as never, hour: 3 }];
  /** 01:00 Wednesday — under a 3am start this is still TUESDAY. */
  const WED_1AM = new Date(2026, 7, 12, 1, 0);
  const weights = { '2026-08-10': 181, '2026-08-11': 180.8, '2026-08-12': 180.4 };

  it('defaults to midnight, so no existing account moves', () => {
    expect(weightSeriesForDays(weights, 2, WED_1AM)).toEqual([180.8, 180.4]);
    expect(weightSeriesForDays(weights, 2, WED_1AM, MIDNIGHT)).toEqual([180.8, 180.4]);
  });

  it('anchors the series on the user day, not the calendar date', () => {
    // 01:00 Wed under a 3am start is Tuesday, so the trailing 2 days are
    // Mon+Tue — Wednesday's weigh-in has not happened in her day yet.
    expect(weightSeriesForDays(weights, 2, WED_1AM, THREE_AM)).toEqual([181, 180.8]);
  });

  it('anchors the points the same way, keys included', () => {
    expect(weightPointsForDays(weights, 2, WED_1AM, THREE_AM)).toEqual([
      { dateKey: '2026-08-10', weightLb: 181 },
      { dateKey: '2026-08-11', weightLb: 180.8 },
    ]);
  });

  it('agrees with trailingDateKeys, which is the window everything else uses', () => {
    expect(weightPointsForDays(weights, 2, WED_1AM, THREE_AM).map((p) => p.dateKey))
      .toEqual(trailingDateKeys(2, WED_1AM, THREE_AM).filter((k) => k in weights));
  });
});

describe('isoWeek', () => {
  it('starts on Monday and runs to Sunday', () => {
    const w = isoWeek(WED);
    expect(w.keys[0]).toBe('2026-08-10');
    expect(w.keys[6]).toBe('2026-08-16');
    expect(w.keys.length).toBe(7);
  });

  it('places today 1-based within the week', () => {
    expect(isoWeek(WED).daysElapsed).toBe(3); // Wednesday
  });

  it('treats Sunday as the LAST day, not the first — the budget is Mon→Sun', () => {
    const sunday = new Date(2026, 7, 16, 9, 0);
    const w = isoWeek(sunday);
    expect(w.daysElapsed).toBe(7);
    expect(w.keys[0]).toBe('2026-08-10');
    expect(w.keys[6]).toBe('2026-08-16');
  });

  it('puts Monday at position 1 with the week starting on itself', () => {
    const monday = new Date(2026, 7, 10, 9, 0);
    expect(isoWeek(monday)).toMatchObject({ daysElapsed: 1 });
    expect(isoWeek(monday).keys[0]).toBe('2026-08-10');
  });
});
