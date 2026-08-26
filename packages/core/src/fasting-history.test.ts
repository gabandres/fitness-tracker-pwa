import { describe, expect, it } from 'vitest';
import {
  FASTING_STRIP_CEILING_HOURS,
  FASTING_WINDOW_DAYS,
  MAX_FAST_MS,
  fastHoursParts,
  fastingBarFraction,
  fastingWindow,
  fastsInWindow,
  completedFastHours,
  fastLengthHours,
  fastingOverlapHours,
  fastsEndingOn,
  isStorableFast,
  sortFastsByEndDesc,
  type Fast,
} from './fasting-history';
import { MIDNIGHT, setDayStartHour, type DayBoundary } from './day-boundary';
import type { DateKey } from './date';

/**
 * The property under test throughout is that the two attribution rules are
 * DIFFERENT and both correct. Most of these cases assert both functions against
 * the same fixture, because the failure this file exists to catch is someone
 * reading one as a bug and "fixing" it into the other.
 *
 * Local-time constructors are used deliberately. Both functions route through
 * `dayKeyAt` / `dayRange`, which are local-time by design (a person's day is
 * where they are standing), so a UTC fixture would test a different function
 * than the one that ships.
 */

/** Local-time instant, so the fixtures mean the same thing in any TZ the suite
 *  runs in. */
const at = (y: number, m: number, d: number, h: number, min = 0): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

const fast = (startedAt: Date, endedAt: Date, source?: Fast['source']): Fast =>
  source ? { startedAt, endedAt, source } : { startedAt, endedAt };

/** 8pm Monday → 12pm Tuesday. Sixteen hours, and it crosses midnight — which
 *  ADR-0032 stresses is the NORMAL case for a fast, not the edge one. */
const overnight = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 12));

/** `DateKey` is branded so a bare string cannot be passed where a key is
 *  expected. These fixtures are hand-written keys, which is the one place the
 *  cast is honest. */
const key = (s: string): DateKey => s as DateKey;

const THREE_AM: DayBoundary = setDayStartHour(MIDNIGHT, key('2026-01-01'), 3);

describe('fastLengthHours', () => {
  it('measures the interval, unrounded', () => {
    expect(fastLengthHours(overnight)).toBe(16);
    expect(fastLengthHours(fast(at(2026, 8, 25, 12), at(2026, 8, 25, 12, 30)))).toBe(0.5);
  });

  it('reads a corrupt interval as zero rather than negative', () => {
    // A negative length would SUBTRACT from a total — a single bad row could
    // make a week of fasting read as less than a day of it.
    expect(fastLengthHours(fast(at(2026, 8, 25, 12), at(2026, 8, 25, 8)))).toBe(0);
    expect(fastLengthHours({ startedAt: new Date(NaN), endedAt: at(2026, 8, 25, 12) })).toBe(0);
  });
});

describe('completedFastHours — the headline, attributed to the END day', () => {
  it('puts an overnight fast on the day it ended, and nothing on the day it started', () => {
    expect(completedFastHours([overnight], key('2026-08-25'))).toBe(16);
    expect(completedFastHours([overnight], key('2026-08-24'))).toBe(0);
  });

  it('sums two fasts that ended on the same day', () => {
    const morning = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 12));
    const evening = fast(at(2026, 8, 25, 14), at(2026, 8, 25, 20));
    expect(completedFastHours([morning, evening], key('2026-08-25'))).toBe(22);
  });

  it('never double-counts — one fast lands on exactly one day', () => {
    // This is the property that makes averages and weekly figures correct by
    // construction, and the reason the headline is not the overlap rule.
    const days = [key('2026-08-23'), key('2026-08-24'), key('2026-08-25'), key('2026-08-26')];
    const total = days.reduce((sum, d) => sum + completedFastHours([overnight], d), 0);
    expect(total).toBe(16);
  });

  it('counts an in-progress fast not at all — it has no document to count', () => {
    expect(completedFastHours([], key('2026-08-25'))).toBe(0);
  });

  it('does not discard a short fast', () => {
    // ADR-0032 refuses to do what Zero and Simple do. A 40-minute fast is a
    // fast the user ended, so it is counted.
    const short = fast(at(2026, 8, 25, 12), at(2026, 8, 25, 12, 40));
    expect(completedFastHours([short], key('2026-08-25'))).toBeCloseTo(40 / 60, 10);
  });

  it('does not discard a long one either', () => {
    const long = fast(at(2026, 8, 22, 8), at(2026, 8, 25, 8));
    expect(completedFastHours([long], key('2026-08-25'))).toBe(72);
  });

  it('follows the day boundary — a 2am end belongs to the previous day on a 3am start', () => {
    // The whole point of ADR-0030 reaching this module: on a 3 AM boundary the
    // user's "day" runs 03:00 → 03:00, so a fast broken at 2am is still
    // yesterday to the person who broke it.
    const brokenAt2am = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 2));
    expect(completedFastHours([brokenAt2am], key('2026-08-25'), MIDNIGHT)).toBe(6);
    expect(completedFastHours([brokenAt2am], key('2026-08-25'), THREE_AM)).toBe(0);
    expect(completedFastHours([brokenAt2am], key('2026-08-24'), THREE_AM)).toBe(6);
  });

  it('ignores a row with an unreadable end instant', () => {
    const corrupt: Fast = { startedAt: at(2026, 8, 24, 20), endedAt: new Date(NaN) };
    expect(completedFastHours([corrupt, overnight], key('2026-08-25'))).toBe(16);
  });
});

describe('fastingOverlapHours — the calendar, and NOT the headline', () => {
  it('splits an overnight fast across both days', () => {
    // 8pm→midnight is 4h on Monday; midnight→noon is 12h on Tuesday.
    expect(fastingOverlapHours([overnight], key('2026-08-24'))).toBe(4);
    expect(fastingOverlapHours([overnight], key('2026-08-25'))).toBe(12);
  });

  it('disagrees with completedFastHours on the same fixture, deliberately', () => {
    // The one assertion this file exists for. If someone "fixes" either
    // function into the other, this is what fails.
    expect(completedFastHours([overnight], key('2026-08-24'))).toBe(0);
    expect(fastingOverlapHours([overnight], key('2026-08-24'))).toBe(4);
    expect(completedFastHours([overnight], key('2026-08-25'))).toBe(16);
    expect(fastingOverlapHours([overnight], key('2026-08-25'))).toBe(12);
  });

  it('is bounded to 24 by construction — a multi-day fast fills a whole day', () => {
    const threeDay = fast(at(2026, 8, 22, 8), at(2026, 8, 25, 8));
    expect(fastingOverlapHours([threeDay], key('2026-08-23'))).toBe(24);
    expect(fastingOverlapHours([threeDay], key('2026-08-24'))).toBe(24);
    expect(fastingOverlapHours([threeDay], key('2026-08-22'))).toBe(16);
    expect(fastingOverlapHours([threeDay], key('2026-08-25'))).toBe(8);
  });

  it('returns 0 for a day the fast does not touch', () => {
    expect(fastingOverlapHours([overnight], key('2026-08-26'))).toBe(0);
    expect(fastingOverlapHours([overnight], key('2026-08-23'))).toBe(0);
  });

  it('treats a fast that ends exactly at the boundary as belonging to the day before', () => {
    // Half-open interval: the day owns [start, end). A fast ending at exactly
    // midnight contributes to Monday and nothing to Tuesday, so the two days
    // cannot both claim the same second.
    const toMidnight = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 0));
    expect(fastingOverlapHours([toMidnight], key('2026-08-24'))).toBe(4);
    expect(fastingOverlapHours([toMidnight], key('2026-08-25'))).toBe(0);
  });

  it('follows the day boundary', () => {
    // On a 3 AM boundary Monday runs 03:00 Mon → 03:00 Tue, so the same
    // 8pm→noon fast splits 7h / 9h instead of 4h / 12h.
    expect(fastingOverlapHours([overnight], key('2026-08-24'), THREE_AM)).toBe(7);
    expect(fastingOverlapHours([overnight], key('2026-08-25'), THREE_AM)).toBe(9);
  });

  it('adds up to the fast length across the days it spans', () => {
    const days = [key('2026-08-23'), key('2026-08-24'), key('2026-08-25'), key('2026-08-26')];
    const total = days.reduce((sum, d) => sum + fastingOverlapHours([overnight], d), 0);
    expect(total).toBe(16);
  });

  it('ignores a corrupt interval instead of subtracting it', () => {
    const inverted = fast(at(2026, 8, 25, 12), at(2026, 8, 25, 8));
    expect(fastingOverlapHours([inverted, overnight], key('2026-08-25'))).toBe(12);
  });
});

describe('fastsEndingOn', () => {
  it('returns the intervals behind the headline number, in the order given', () => {
    const morning = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 12), 'timer');
    const evening = fast(at(2026, 8, 25, 14), at(2026, 8, 25, 20), 'manual');
    expect(fastsEndingOn([morning, evening, overnight], key('2026-08-25'))).toEqual([
      morning,
      evening,
      overnight,
    ]);
    expect(fastsEndingOn([morning, evening], key('2026-08-24'))).toEqual([]);
  });
});

describe('isStorableFast — the writer-side agreement with firestore.rules', () => {
  const start = at(2026, 8, 24, 20);

  it('accepts an ordinary fast', () => {
    expect(isStorableFast(start, at(2026, 8, 25, 12))).toBe(true);
  });

  it('accepts a very short one — there is no minimum', () => {
    expect(isStorableFast(start, new Date(start.getTime() + 60_000))).toBe(true);
  });

  it('rejects a zero-length or inverted interval', () => {
    expect(isStorableFast(start, start)).toBe(false);
    expect(isStorableFast(start, new Date(start.getTime() - 1))).toBe(false);
  });

  it('rejects a non-date', () => {
    expect(isStorableFast(new Date(NaN), at(2026, 8, 25, 12))).toBe(false);
    expect(isStorableFast(start, new Date(NaN))).toBe(false);
  });

  it('agrees with the rules ceiling exactly, on both sides of it', () => {
    // The writer has to make this call ITSELF. `breakFast` is a batch, so a
    // document the rules reject fails the whole commit and leaves
    // `fastStartedAt` set — the user's timer would run forever with no way to
    // stop it. Off-by-one here is that bug.
    expect(isStorableFast(start, new Date(start.getTime() + MAX_FAST_MS))).toBe(true);
    expect(isStorableFast(start, new Date(start.getTime() + MAX_FAST_MS + 1))).toBe(false);
  });

  it('puts the ceiling at 14 days', () => {
    expect(MAX_FAST_MS).toBe(14 * 24 * 60 * 60 * 1000);
  });
});

describe('sortFastsByEndDesc', () => {
  it('orders newest-ended first and does not mutate the input', () => {
    const older = fast(at(2026, 8, 20, 20), at(2026, 8, 21, 12));
    const input = [older, overnight];
    expect(sortFastsByEndDesc(input)).toEqual([overnight, older]);
    expect(input).toEqual([older, overnight]);
  });
});

describe('fastingWindow — what the Trends card draws (ADR-0034)', () => {
  const keys = (n: number, endYmd: [number, number, number]): DateKey[] => {
    const out: DateKey[] = [];
    const [y, m, d] = endYmd;
    for (let i = n - 1; i >= 0; i--) {
      const day = new Date(y, m - 1, d - i);
      out.push(
        `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(
          day.getDate(),
        ).padStart(2, '0')}` as DateKey,
      );
    }
    return out;
  };

  const WINDOW = keys(FASTING_WINDOW_DAYS, [2026, 8, 26]);

  it('draws one column per day and nothing where no fast ended', () => {
    const w = fastingWindow([overnight], WINDOW);
    expect(w.days).toHaveLength(FASTING_WINDOW_DAYS);
    expect(w.daysWithFast).toBe(1);
    // null, not 0 — a day with no fast is not a fast of zero hours, and drawing
    // it as a zero-height bar would say the user fasted and failed.
    expect(w.days.find((d) => d.dateKey === key('2026-08-25'))?.hours).toBe(16);
    expect(w.days.find((d) => d.dateKey === key('2026-08-24'))?.hours).toBeNull();
  });

  it('never draws one fast in two columns — the whole reason it uses the end-day rule', () => {
    // The mistake this guards is using `fastingOverlapHours` here instead, which
    // would give a denser, prettier chart that silently counts every overnight
    // fast twice.
    const w = fastingWindow([overnight], WINDOW);
    expect(w.days.filter((d) => d.hours != null)).toHaveLength(1);
    expect(w.days.reduce((sum, d) => sum + (d.hours ?? 0), 0)).toBe(16);
  });

  it('sums two fasts that ended on one day into that column, and counts them separately', () => {
    const a = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 12)); // 16h
    const b = fast(at(2026, 8, 25, 14), at(2026, 8, 25, 20)); // 6h
    const w = fastingWindow([a, b], WINDOW);
    expect(w.days.find((d) => d.dateKey === key('2026-08-25'))?.hours).toBe(22);
    // Days and fasts are different counts and the card says which is which.
    expect(w.daysWithFast).toBe(1);
    expect(fastsInWindow([a, b], WINDOW)).toBe(2);
    // The mean is over FASTS, so it is 11 and not 22.
    expect(w.meanHours).toBe(11);
  });

  it('reports mean, median and longest over the fasts in the window', () => {
    const fasts = [
      fast(at(2026, 8, 20, 20), at(2026, 8, 21, 8)), // 12h
      fast(at(2026, 8, 21, 20), at(2026, 8, 22, 12)), // 16h
      fast(at(2026, 8, 22, 18), at(2026, 8, 23, 14)), // 20h
    ];
    const w = fastingWindow(fasts, WINDOW);
    expect(w.meanHours).toBe(16);
    expect(w.medianHours).toBe(16);
    expect(w.longestHours).toBe(20);
    expect(w.daysWithFast).toBe(3);
  });

  it('ignores a fast outside the window entirely', () => {
    const old = fast(at(2026, 7, 1, 20), at(2026, 7, 2, 12));
    const w = fastingWindow([old], WINDOW);
    expect(w.daysWithFast).toBe(0);
    expect(w.meanHours).toBe(0);
    expect(w.medianHours).toBe(0);
    expect(w.longestHours).toBe(0);
    expect(fastsInWindow([old], WINDOW)).toBe(0);
  });

  it('is total on an empty history — the state most accounts are in on day one', () => {
    const w = fastingWindow([], WINDOW);
    expect(w.days).toHaveLength(FASTING_WINDOW_DAYS);
    expect(w.days.every((d) => d.hours === null)).toBe(true);
    expect(w.daysWithFast).toBe(0);
    expect(w.meanHours).toBe(0);
  });

  it('follows the day boundary', () => {
    const brokenAt2am = fast(at(2026, 8, 24, 20), at(2026, 8, 25, 2));
    expect(fastingWindow([brokenAt2am], WINDOW).days.find((d) => d.dateKey === key('2026-08-25'))?.hours).toBe(6);
    expect(
      fastingWindow([brokenAt2am], WINDOW, THREE_AM).days.find((d) => d.dateKey === key('2026-08-24'))?.hours,
    ).toBe(6);
  });
});

describe('fastingBarFraction', () => {
  it('scales against a FIXED ceiling, not the window maximum', () => {
    // A self-scaling axis would redraw a week of 13-hour fasts to look exactly
    // like a week of 20-hour ones.
    expect(fastingBarFraction(12)).toBe(0.5);
    expect(fastingBarFraction(FASTING_STRIP_CEILING_HOURS)).toBe(1);
  });

  it('clamps a longer fast rather than rescaling everything else', () => {
    expect(fastingBarFraction(72)).toBe(1);
  });

  it('draws nothing for an absent or impossible value', () => {
    expect(fastingBarFraction(null)).toBe(0);
    expect(fastingBarFraction(0)).toBe(0);
    expect(fastingBarFraction(-4)).toBe(0);
    expect(fastingBarFraction(NaN)).toBe(0);
  });
});

describe('fastHoursParts', () => {
  it('splits a duration for display', () => {
    expect(fastHoursParts(16.5)).toEqual({ hours: 16, minutes: 30 });
    expect(fastHoursParts(16)).toEqual({ hours: 16, minutes: 0 });
  });

  it('reads a nonsense duration as zero rather than rendering NaN at a user', () => {
    expect(fastHoursParts(0)).toEqual({ hours: 0, minutes: 0 });
    expect(fastHoursParts(-1)).toEqual({ hours: 0, minutes: 0 });
    expect(fastHoursParts(NaN)).toEqual({ hours: 0, minutes: 0 });
  });
});
