import { describe, expect, it } from 'vitest';
import { manualNightKeys } from './sleep-night';
import { MIDNIGHT, setDayStartHour, type DayBoundary } from './day-boundary';
import type { DateKey } from './date';

/**
 * Issue #80 — the sleep guard cannot see what it is guarding.
 *
 * The case the issue asks to be pinned is the first `describe` below: **a
 * manual night and an import land on different keys for the same real night.**
 * Everything after it exists to stop the fix over-reaching, which is the way
 * this particular bug is easy to "fix" into a worse one — see the module's own
 * note on why a blanket neighbour check was rejected.
 */

const THREE_AM: DayBoundary = setDayStartHour(MIDNIGHT, '2026-01-01' as DateKey, 3);

/** A local wall-clock instant. Local, deliberately: `dayKeyAt` buckets by the
 *  user's clock, and a UTC literal would make this suite pass or fail by the
 *  machine's timezone. */
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m - 1, d, h, min);

describe('the night a boundary splits in two', () => {
  it('checks the key the user would have typed under, not just the one it writes', () => {
    // Woke at 01:00 on the 20th, on a 3am boundary. The sleep sheet writes
    // `dayKeyAt(now)` = the 19th; every importer files the calendar wake day =
    // the 20th. One night, two candidate documents.
    const keys = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 1, 0), THREE_AM);

    expect(keys).toEqual(['2026-03-20', '2026-03-19']);
  });

  it('still writes under the source day — Q5 is not renegotiated here', () => {
    // The storage key is always first and always unchanged. A caller that
    // writes `keys[0]` keeps ADR-0030 Q5 exactly as decided.
    const keys = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 2, 30), THREE_AM);

    expect(keys[0]).toBe('2026-03-20');
  });

  it('stops at the boundary hour, not some fuzzy window around it', () => {
    const before = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 2, 59), THREE_AM);
    const after = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 3, 0), THREE_AM);

    expect(before).toHaveLength(2);
    // 03:00 IS the user's new day, so both writers agree and there is nothing
    // to reconcile. This is ADR-0033 decision 5's "good consequence" asserted:
    // waking after your own day start collapses the two keys into one.
    expect(after).toEqual(['2026-03-20']);
  });

  it('admits the day after too, because Oura decides its own `day`', () => {
    // Not reachable through the health importers — they derive the key from the
    // same instant. It is reachable if Oura's `day` names the day the night
    // BEGAN, which no record from a real ring has ever confirmed either way.
    const keys = manualNightKeys('2026-03-19' as DateKey, at(2026, 3, 20, 6, 0), THREE_AM);

    expect(keys).toEqual(['2026-03-19', '2026-03-20']);
  });
});

describe('inert everywhere it has no business acting', () => {
  it('is a no-op at midnight — every account that never touched the setting', () => {
    expect(manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 1, 0), MIDNIGHT)).toEqual([
      '2026-03-20',
    ]);
  });

  it('is a no-op when the boundary argument is omitted entirely', () => {
    expect(manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, 1, 0))).toEqual(['2026-03-20']);
  });

  it('is a no-op when the transport cannot say when the night ended', () => {
    // Oura's `daily_activity` carries no `bedtime_end`, and a health sample
    // could in principle arrive without one. A guess is worse than the status
    // quo, so there is no guess.
    for (const unknown of [undefined, null, Number.NaN, new Date(Number.NaN)]) {
      expect(manualNightKeys('2026-03-20' as DateKey, unknown, THREE_AM)).toEqual(['2026-03-20']);
    }
  });

  it('is a no-op on days governed by an older, midnight rule', () => {
    // The boundary is a history of changes (ADR-0030). A night before the user
    // ever set one was written under midnight by both writers.
    const keys = manualNightKeys('2025-12-31' as DateKey, at(2025, 12, 31, 1, 0), THREE_AM);

    expect(keys).toEqual(['2025-12-31']);
  });

  it('refuses a wake instant that is not adjacent to the day it is filing', () => {
    // A disagreeing timezone, a malformed record, a caller pairing the wrong
    // row: reading a document three days away would be guessing, and the thing
    // it guesses about is whether to DECLINE a write.
    const keys = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 17, 1, 0), THREE_AM);

    expect(keys).toEqual(['2026-03-20']);
  });

  it('refuses a storage key that is not a date', () => {
    expect(manualNightKeys('' as DateKey, at(2026, 3, 20, 1, 0), THREE_AM)).toEqual(['']);
  });
});

describe('the over-reach the fix must not commit', () => {
  it('does not flag the previous day for a night that ended after the boundary', () => {
    // THE regression case. A user on a 3am boundary who types some nights has a
    // manual row at D−1 for a DIFFERENT night. If this returned D−1 here, the
    // importer would decline every day that follows a typed night, silently and
    // for ever — a worse bug than the one being fixed, and indistinguishable
    // from a broken integration.
    for (const hour of [3, 6, 7, 8, 9, 11]) {
      expect(manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, hour), THREE_AM)).toEqual([
        '2026-03-20',
      ]);
    }
  });

  it('never returns more than two keys, so the guard costs at most one extra read', () => {
    for (let hour = 0; hour < 24; hour++) {
      const keys = manualNightKeys('2026-03-20' as DateKey, at(2026, 3, 20, hour), THREE_AM);
      expect(keys.length).toBeLessThanOrEqual(2);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });
});
