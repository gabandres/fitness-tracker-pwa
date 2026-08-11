import { describe, expect, it } from 'vitest';
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
