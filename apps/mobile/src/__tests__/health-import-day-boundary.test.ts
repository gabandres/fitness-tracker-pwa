import { MIDNIGHT, type DayBoundary, dayKeyAt } from '@macrolog/core';

/**
 * ADR-0030 Q5 — which imported records move with the user's day boundary, and
 * which keep their source's day.
 *
 * The rule is one sentence and the consequences are not obvious, so they are
 * pinned here rather than left to the comments at each call site:
 *
 *   **We derive the day only when the source did not.**
 *
 * A raw sample carries an instant and no day, so the day is ours and the
 * boundary applies. An OS-bucketed daily TOTAL already has a day — the OS made
 * it, at calendar midnight, over a full 00:00–24:00 window — so re-keying it
 * would file a whole calendar day's steps as the previous user-day. Sleep is a
 * third case: it keeps the wake-day rule ADR-0033 owns.
 *
 * `scripts/check-day-boundary.mjs` enforces the same split mechanically, by
 * argument, in `CALENDAR_OK`. These tests state WHY.
 */

/** Days start at 03:00 from 2026-01-01 on. */
const THREE_AM: DayBoundary = [{ from: '2026-01-01' as never, hour: 3 }];

/** 01:30 on Wednesday the 12th — before a 3 AM day starts, so still TUESDAY. */
const LATE_NIGHT = new Date(2026, 7, 12, 1, 30);

describe('a raw sample takes the USER day', () => {
  it('files a 01:30 weigh-in on the previous day under a 3 AM boundary', () => {
    // `health.ts` calls exactly this for the raw weight/water/quantity paths.
    expect(dayKeyAt(LATE_NIGHT, THREE_AM)).toBe('2026-08-11');
  });

  it('is unchanged for everyone on the default boundary', () => {
    // MIDNIGHT is what every account has until they open the setting, and
    // under it `dayKeyAt` IS the calendar date — so nothing moved for anyone.
    expect(dayKeyAt(LATE_NIGHT, MIDNIGHT)).toBe('2026-08-12');
  });
});

describe('an OS-bucketed daily total keeps its SOURCE day', () => {
  it('would be mis-filed by a whole day if it took the user day', () => {
    // The bucket starts at calendar midnight and holds 00:00-24:00 of steps.
    const bucketStart = new Date(2026, 7, 12, 0, 0);
    // What the importer stores (calendar), versus what converting would give.
    expect(dayKeyAt(bucketStart, MIDNIGHT)).toBe('2026-08-12');
    expect(dayKeyAt(bucketStart, THREE_AM)).toBe('2026-08-11');
    // The second is the bug: a full Wednesday of steps filed under Tuesday.
    // That is why `start` is exempted rather than converted.
  });
});

describe('the cardio merge keys must move TOGETHER', () => {
  /**
   * `writeImportedBlocks` matches an imported block's day against the day of a
   * session the user already logged, to decide whether to fold or to write a
   * new one. Converting one side and not the other is worse than converting
   * neither — it stops a late-night run finding its own session.
   */
  it('a 01:30 run and a 01:30 session agree under either boundary', () => {
    const sessionDate = new Date(2026, 7, 12, 1, 30);
    const blockStart = new Date(2026, 7, 12, 1, 45);
    for (const b of [MIDNIGHT, THREE_AM]) {
      expect(dayKeyAt(sessionDate, b)).toBe(dayKeyAt(blockStart, b));
    }
  });

  it('and they would DISAGREE if only one had been converted', () => {
    // The failure the coupling prevents, stated as a fact rather than a warning.
    const sessionDate = new Date(2026, 7, 12, 1, 30);
    expect(dayKeyAt(sessionDate, THREE_AM)).not.toBe(dayKeyAt(sessionDate, MIDNIGHT));
  });
});
