import { describe, expect, it } from 'vitest';
import { MIDNIGHT, dayBoundaryOf, dayKeyAt, sanitizeDayBoundary, setDayStartHour } from './day-boundary';
import type { DateKey } from './date';
import { aggregateByDay } from './tdee';
import { summarizeDay, summarizeDays } from './day-summary';
import { computeStreak } from './streak';
import { mergeDailyWeights } from './targets';
import { isoWeek, trailingDateKeys } from './log-window';
import { activityWindowRange } from './activity-level';
import type { DailyLog } from './types';

/**
 * The consumer half of ADR-0030 step 1.
 *
 * `day-boundary.test.ts` proves the DERIVATION: `dayKeyAt(d, MIDNIGHT)` is
 * byte-for-byte `calendarDateKey(d)`. That is necessary and it is not
 * sufficient — it says nothing about whether the ~155 call sites that used to
 * reach the bare `localDateKey` are now actually routed through it.
 *
 * These tests close that gap from both sides, and BOTH sides are load-bearing:
 *
 * - **At `MIDNIGHT`, every threaded consumer answers exactly what it answered
 *   before.** This is the adoption guarantee that let the threading land with
 *   nothing wired and no user affected.
 * - **At a real boundary, every threaded consumer MOVES.** Without this half a
 *   consumer that quietly kept calling `calendarDateKey` would pass the first
 *   half forever — it would look adopted and behave exactly as it did before
 *   ADR-0030, which is the "looks fixed" failure the ADR names as the worst
 *   available outcome.
 */

const AT_3AM = setDayStartHour(MIDNIGHT, '2000-01-01' as DateKey, 3);

/** A log at a wall-clock time on a date. */
function log(iso: string, calories: number, protein = 0): DailyLog {
  return { date: new Date(iso), calories, protein } as DailyLog;
}

// 00:30 on the 12th. Under midnight that is the 12th; under a 3am boundary it
// belongs to the night of the 11th — the late meal the whole ADR is about.
const LATE_MEAL = log('2026-08-12T00:30:00', 700, 40);
const SAME_DAY_LUNCH = log('2026-08-12T13:00:00', 500, 30);

describe('day boundary — threaded consumers', () => {
  describe('aggregateByDay (the estimator input)', () => {
    it('buckets a 00:30 meal onto the previous day at a 3am boundary', () => {
      const midnight = aggregateByDay([LATE_MEAL, SAME_DAY_LUNCH], MIDNIGHT);
      expect(midnight).toHaveLength(1);
      expect(midnight[0].calories).toBe(1200);

      const shifted = aggregateByDay([LATE_MEAL, SAME_DAY_LUNCH], AT_3AM);
      expect(shifted).toHaveLength(2);
      // The sawtooth ADR-0030 exists to remove: 700 kcal moves off the 12th
      // and onto the 11th instead of making the 12th read 1200.
      expect(shifted.map((l) => l.calories)).toEqual([700, 500]);
    });

    it('defaults to calendar days when no boundary is passed', () => {
      expect(aggregateByDay([LATE_MEAL, SAME_DAY_LUNCH])).toEqual(
        aggregateByDay([LATE_MEAL, SAME_DAY_LUNCH], MIDNIGHT),
      );
    });
  });

  describe('summarizeDay / summarizeDays (the day rollup)', () => {
    it('moves the late meal off the day the calendar would put it on', () => {
      const logs = [LATE_MEAL, SAME_DAY_LUNCH];
      expect(summarizeDay('2026-08-12', logs, undefined, MIDNIGHT).totalCalories).toBe(1200);
      expect(summarizeDay('2026-08-12', logs, undefined, AT_3AM).totalCalories).toBe(500);
      expect(summarizeDay('2026-08-11', logs, undefined, AT_3AM).totalCalories).toBe(700);
    });

    it('summarizeDays agrees with summarizeDay under the same boundary', () => {
      const logs = [LATE_MEAL, SAME_DAY_LUNCH];
      const keys = ['2026-08-11', '2026-08-12'];
      for (const boundary of [MIDNIGHT, AT_3AM]) {
        expect(summarizeDays(keys, logs, undefined, boundary)).toEqual(
          keys.map((k) => summarizeDay(k, logs, undefined, boundary)),
        );
      }
    });

    it('defaults to calendar days when no boundary is passed', () => {
      const logs = [LATE_MEAL, SAME_DAY_LUNCH];
      expect(summarizeDay('2026-08-12', logs)).toEqual(
        summarizeDay('2026-08-12', logs, undefined, MIDNIGHT),
      );
    });
  });

  describe('computeStreak', () => {
    it('counts the late meal as the previous day, not a second day', () => {
      const logs = [log('2026-08-11T20:00:00', 600), LATE_MEAL];
      const today = new Date('2026-08-12T13:00:00');

      // Midnight: the 11th and the 12th — two days.
      expect(computeStreak(logs, { today }).streak).toBe(2);
      // 3am: both meals belong to the 11th, and the 12th has nothing logged
      // yet, so the streak is the 11th alone and has not broken.
      expect(computeStreak(logs, { today, boundary: AT_3AM }).streak).toBe(1);
    });

    it('defaults to calendar days when no boundary is passed', () => {
      const logs = [log('2026-08-11T20:00:00', 600), LATE_MEAL];
      const today = new Date('2026-08-12T13:00:00');
      expect(computeStreak(logs, { today })).toEqual(
        computeStreak(logs, { today, boundary: MIDNIGHT }),
      );
    });
  });

  describe('mergeDailyWeights', () => {
    it('looks a weight up under the day the log belongs to', () => {
      const weights = { '2026-08-11': 180, '2026-08-12': 181 };
      expect(mergeDailyWeights([LATE_MEAL], weights, MIDNIGHT)[0].weight).toBe(181);
      expect(mergeDailyWeights([LATE_MEAL], weights, AT_3AM)[0].weight).toBe(180);
    });
  });

  describe('window anchors', () => {
    // 01:00 on the 12th: the calendar says the 12th, a 3am boundary says the
    // 11th. A window anchored on the calendar date would run a day ahead of
    // the day the user is actually living.
    const at1am = new Date('2026-08-12T01:00:00');

    it('trailingDateKeys ends on the user’s day', () => {
      expect(trailingDateKeys(3, at1am, MIDNIGHT)).toEqual([
        '2026-08-10',
        '2026-08-11',
        '2026-08-12',
      ]);
      expect(trailingDateKeys(3, at1am, AT_3AM)).toEqual([
        '2026-08-09',
        '2026-08-10',
        '2026-08-11',
      ]);
      expect(trailingDateKeys(3, at1am)).toEqual(trailingDateKeys(3, at1am, MIDNIGHT));
    });

    it('isoWeek resolves the week from the user’s day', () => {
      // 2026-08-12 is a Wednesday, 2026-08-11 a Tuesday — same ISO week, so
      // the KEYS match and only the elapsed-day count moves.
      expect(isoWeek(at1am, MIDNIGHT).daysElapsed).toBe(3);
      expect(isoWeek(at1am, AT_3AM).daysElapsed).toBe(2);
      expect(isoWeek(at1am)).toEqual(isoWeek(at1am, MIDNIGHT));
    });

    it('activityWindowRange excludes the user’s today, not the calendar’s', () => {
      expect(activityWindowRange(at1am, MIDNIGHT).to).toBe('2026-08-11');
      expect(activityWindowRange(at1am, AT_3AM).to).toBe('2026-08-10');
      expect(activityWindowRange(at1am)).toEqual(activityWindowRange(at1am, MIDNIGHT));
    });
  });
});

/**
 * `sanitizeDayBoundary` is the ONLY thing standing between a stored value and
 * the estimator. `firestore.rules` can check that `dayBoundary` is a list of at
 * most 24 things and — because rules cannot iterate a list — nothing at all
 * about what those things are. Every case below is therefore a shape the
 * server would happily have stored.
 */
describe('sanitizeDayBoundary', () => {
  it('passes a well-formed history through unchanged', () => {
    const good = [
      { from: '2026-08-25', hour: 3 },
      { from: '2026-09-01', hour: 5 },
    ];
    expect(sanitizeDayBoundary(good)).toEqual(good);
  });

  it('treats absent, empty and non-list values as midnight', () => {
    for (const raw of [undefined, null, [], 3, 'x', {}, { from: '2026-08-25', hour: 3 }]) {
      expect(sanitizeDayBoundary(raw)).toEqual(MIDNIGHT);
    }
  });

  it('drops entries that are not a {from, hour}', () => {
    expect(
      sanitizeDayBoundary([
        null,
        'nope',
        42,
        { hour: 3 }, // no `from`
        { from: '2026-08-25' }, // no `hour`
        { from: '2026-08-25', hour: 3 },
      ]),
    ).toEqual([{ from: '2026-08-25', hour: 3 }]);
  });

  it('drops a `from` that is not a YYYY-MM-DD key', () => {
    // `boundaryHourOn` compares `from` to a date key as a STRING. Anything
    // else makes that comparison meaningless rather than merely wrong.
    expect(
      sanitizeDayBoundary([
        { from: '2026-8-5', hour: 3 },
        { from: '08/25/2026', hour: 3 },
        { from: 20260825, hour: 3 },
        { from: '2026-08-25', hour: 3 },
      ]),
    ).toEqual([{ from: '2026-08-25', hour: 3 }]);
  });

  it('drops an hour outside 0..MAX_DAY_START_HOUR', () => {
    expect(
      sanitizeDayBoundary([
        { from: '2026-01-01', hour: -1 },
        { from: '2026-01-02', hour: 7 },
        { from: '2026-01-03', hour: 2.5 },
        { from: '2026-01-04', hour: NaN },
        { from: '2026-01-05', hour: 6 },
      ]),
    ).toEqual([{ from: '2026-01-05', hour: 6 }]);
  });

  it('re-sorts an out-of-order list', () => {
    // `boundaryHourOn` walks in order and STOPS at the first entry past the key
    // it is asked about, so an unsorted list would hand back an older rule for
    // a later day — a wrong answer that looks entirely plausible.
    expect(
      sanitizeDayBoundary([
        { from: '2026-09-01', hour: 5 },
        { from: '2026-08-25', hour: 3 },
      ]),
    ).toEqual([
      { from: '2026-08-25', hour: 3 },
      { from: '2026-09-01', hour: 5 },
    ]);
  });

  it('keeps the last of duplicate `from` keys', () => {
    expect(
      sanitizeDayBoundary([
        { from: '2026-08-25', hour: 3 },
        { from: '2026-08-25', hour: 5 },
      ]),
    ).toEqual([{ from: '2026-08-25', hour: 5 }]);
  });

  it('survives a sanitized boundary being fed straight to dayKeyAt', () => {
    const boundary = sanitizeDayBoundary([
      { from: '2026-09-01', hour: 3 },
      { from: 'garbage', hour: 99 },
      { from: '2000-01-01', hour: 3 },
    ]);
    expect(dayKeyAt(new Date('2026-08-12T00:30:00'), boundary)).toBe('2026-08-11');
  });

  it('is what dayBoundaryOf reads off a profile', () => {
    expect(dayBoundaryOf({ dayBoundary: [{ from: 'bad', hour: 3 }] as never })).toEqual(MIDNIGHT);
    expect(dayBoundaryOf(null)).toEqual(MIDNIGHT);
    expect(dayBoundaryOf({})).toEqual(MIDNIGHT);
    expect(dayBoundaryOf({ dayBoundary: AT_3AM })).toEqual(AT_3AM);
  });
});
