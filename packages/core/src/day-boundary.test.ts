import { describe, expect, it } from 'vitest';
import { calendarDateKey, type DateKey } from './date';
import {
  MAX_DAY_START_HOUR,
  MIDNIGHT,
  boundaryHourOn,
  dayKeyAt,
  dayRange,
  isValidDayStartHour,
  setDayStartHour,
} from './day-boundary';

const key = (s: string) => s as DateKey;
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe('MIDNIGHT is exactly today’s behaviour', () => {
  // The adoption guarantee. Every one of the ~155 existing `calendarDateKey` call
  // sites can move to `dayKeyAt(d, boundary)` without changing a single answer
  // for an account that has never set a boundary — which is every account.
  it('agrees with calendarDateKey at every hour of a day', () => {
    for (let h = 0; h < 24; h++) {
      const d = at(2026, 8, 25, h, 30);
      expect(dayKeyAt(d, MIDNIGHT)).toBe(calendarDateKey(d));
    }
  });

  it('agrees with calendarDateKey across a month end and a leap day', () => {
    for (const d of [at(2026, 8, 31, 23, 59), at(2028, 2, 29, 0, 0), at(2026, 12, 31, 23, 59)]) {
      expect(dayKeyAt(d, MIDNIGHT)).toBe(calendarDateKey(d));
    }
  });
});

describe('dayKeyAt with a boundary', () => {
  // A 3am boundary set long before the days under test, so nothing here is a
  // transition case.
  const b = setDayStartHour(MIDNIGHT, key('2026-01-01'), 3);

  it('puts a 00:30 meal on the day it belonged to', () => {
    // The reported symptom, and the one the estimator cares about: this meal
    // was eaten on the 24th by any human account of the evening.
    expect(dayKeyAt(at(2026, 8, 25, 0, 30), b)).toBe('2026-08-24');
  });

  it('is half-open at the boundary itself', () => {
    expect(dayKeyAt(at(2026, 8, 25, 2, 59), b)).toBe('2026-08-24');
    expect(dayKeyAt(at(2026, 8, 25, 3, 0), b)).toBe('2026-08-25');
  });

  it('leaves the rest of the day alone', () => {
    expect(dayKeyAt(at(2026, 8, 25, 12, 0), b)).toBe('2026-08-25');
    expect(dayKeyAt(at(2026, 8, 25, 23, 59), b)).toBe('2026-08-25');
  });

  it('carries a late meal back across a month end', () => {
    expect(dayKeyAt(at(2026, 9, 1, 1, 0), b)).toBe('2026-08-31');
  });
});

describe('changing the boundary is forward-only', () => {
  const b = setDayStartHour(MIDNIGHT, key('2026-08-25'), 3);

  it('does NOT re-bucket a day that is already closed', () => {
    // The whole point. 2026-08-24 was logged, shown and fed to the estimator
    // under midnight; setting a boundary today must not silently move it.
    expect(dayKeyAt(at(2026, 8, 24, 1, 0), b)).toBe('2026-08-24');
    expect(dayKeyAt(at(2026, 8, 24, 23, 0), b)).toBe('2026-08-24');
  });

  it('keeps the changeover window on the OLD rule', () => {
    // 2026-08-25 00:30 would shift onto the 24th, which is closed. It stays.
    expect(dayKeyAt(at(2026, 8, 25, 0, 30), b)).toBe('2026-08-25');
    // From the following day the new rule is fully in force.
    expect(dayKeyAt(at(2026, 8, 26, 0, 30), b)).toBe('2026-08-25');
  });

  it('makes the changeover day 27 hours long, and only that day', () => {
    const changeover = dayRange(key('2026-08-25'), b);
    const after = dayRange(key('2026-08-26'), b);
    const hours = (r: { start: Date; end: Date }) => (r.end.getTime() - r.start.getTime()) / 3_600_000;
    expect(hours(changeover)).toBe(27);
    expect(hours(after)).toBe(24);
  });

  it('maps every hour around the change exactly once — no gap, no overlap', () => {
    // The invariant that makes the 27-hour day defensible rather than a fudge:
    // the mapping is still a partition of the timeline.
    const seen = new Map<string, number>();
    for (let h = 0; h < 24 * 6; h++) {
      const d = at(2026, 8, 23, 0, 0);
      d.setHours(d.getHours() + h);
      const k = dayKeyAt(d, b);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      // Every instant must fall inside its own day's range.
      const { start, end } = dayRange(k as DateKey, b);
      expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(d.getTime()).toBeLessThan(end.getTime());
    }
    expect(seen.get('2026-08-23')).toBe(24);
    expect(seen.get('2026-08-24')).toBe(24);
    expect(seen.get('2026-08-25')).toBe(27);
    expect(seen.get('2026-08-26')).toBe(24);
  });

  it('makes the day BEFORE a lowered boundary shorter, and still loses nothing', () => {
    // Raising the boundary lengthens the changeover day; lowering it shortens
    // the day before. Both are consequences of the same "never re-bucket a
    // closed day" rule, and the second one was reasoned about before it was
    // tested — so it is tested.
    const b = setDayStartHour(setDayStartHour(MIDNIGHT, key('2026-01-01'), 5), key('2026-08-25'), 2);
    const hours = (k: string) => {
      const r = dayRange(key(k), b);
      return (r.end.getTime() - r.start.getTime()) / 3_600_000;
    };
    expect(hours('2026-08-24')).toBe(19); // [24 05:00, 25 00:00)
    expect(hours('2026-08-25')).toBe(26); // [25 00:00, 26 02:00)
    expect(hours('2026-08-26')).toBe(24);

    const seen = new Map<string, number>();
    for (let h = 0; h < 24 * 5; h++) {
      const d = at(2026, 8, 23, 0, 0);
      d.setHours(d.getHours() + h);
      const k = dayKeyAt(d, b);
      seen.set(k, (seen.get(k) ?? 0) + 1);
      const { start, end } = dayRange(k as DateKey, b);
      expect(d.getTime()).toBeGreaterThanOrEqual(start.getTime());
      expect(d.getTime()).toBeLessThan(end.getTime());
    }
    expect(seen.get('2026-08-24')).toBe(19);
    expect(seen.get('2026-08-25')).toBe(26);
  });

  it('keeps each earlier rule for the span it governed', () => {
    const b2 = setDayStartHour(setDayStartHour(MIDNIGHT, key('2026-03-01'), 2), key('2026-08-25'), 5);
    expect(boundaryHourOn(key('2026-02-28'), b2)).toBe(0);
    expect(boundaryHourOn(key('2026-03-01'), b2)).toBe(2);
    expect(boundaryHourOn(key('2026-08-24'), b2)).toBe(2);
    expect(boundaryHourOn(key('2026-08-25'), b2)).toBe(5);
    // A day in the middle era still uses that era's rule, years later.
    expect(dayKeyAt(at(2026, 5, 10, 1, 0), b2)).toBe('2026-05-09');
  });
});

describe('setDayStartHour', () => {
  it('refuses an hour outside 0..MAX', () => {
    expect(() => setDayStartHour(MIDNIGHT, key('2026-08-25'), 7)).toThrow(RangeError);
    expect(() => setDayStartHour(MIDNIGHT, key('2026-08-25'), -1)).toThrow(RangeError);
    expect(() => setDayStartHour(MIDNIGHT, key('2026-08-25'), 2.5)).toThrow(RangeError);
    expect(isValidDayStartHour(MAX_DAY_START_HOUR)).toBe(true);
  });

  it('refuses to insert a change at or before an existing one', () => {
    // Reordering history is the failure this shape exists to prevent, so it is
    // an error rather than a quiet re-sort that would move closed days.
    const b = setDayStartHour(MIDNIGHT, key('2026-08-25'), 3);
    expect(() => setDayStartHour(b, key('2026-08-25'), 4)).toThrow(RangeError);
    expect(() => setDayStartHour(b, key('2026-01-01'), 4)).toThrow(RangeError);
  });

  it('is a no-op when the hour is already in force', () => {
    // So a settings screen can save unconditionally without growing the list.
    const b = setDayStartHour(MIDNIGHT, key('2026-08-25'), 3);
    expect(setDayStartHour(b, key('2026-09-01'), 3)).toBe(b);
    expect(setDayStartHour(MIDNIGHT, key('2026-09-01'), 0)).toBe(MIDNIGHT);
  });
});

describe('dayRange', () => {
  it('is [start, end) at midnight with no boundary', () => {
    const { start, end } = dayRange(key('2026-08-25'), MIDNIGHT);
    expect(calendarDateKey(start)).toBe('2026-08-25');
    expect(start.getHours()).toBe(0);
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(24);
  });

  it('starts and ends at the boundary hour once one is in force', () => {
    const b = setDayStartHour(MIDNIGHT, key('2026-01-01'), 4);
    const { start, end } = dayRange(key('2026-08-25'), b);
    expect(start.getHours()).toBe(4);
    expect(end.getHours()).toBe(4);
    expect(calendarDateKey(end)).toBe('2026-08-26');
  });
});
