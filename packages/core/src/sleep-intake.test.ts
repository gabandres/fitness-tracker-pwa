import { describe, expect, it } from 'vitest';
import {
  SLEEP_MIN_GROUP,
  SLEEP_MIN_KCAL_GAP,
  SLEEP_MIN_NIGHTS,
  SLEEP_STRIP_CEILING_HOURS,
  SLEEP_WINDOW_DAYS,
  sleepBarFraction,
  sleepHoursParts,
  sleepIntakeContrast,
  sleepWindow,
  type SleepEntry,
} from './sleep-intake';
import type { DaySummary } from './day-summary';

/**
 * ADR-0033 / issue #81 — the gates, the split, and the two things the card is
 * forbidden from doing.
 *
 * The bar is the interesting part of this module: `sleepIntakeContrast`
 * returning `null` is not a failure mode, it is the common case, and every
 * reason it can return null is a decision someone made on purpose.
 */

const key = (i: number) => `2026-03-${String(i + 1).padStart(2, '0')}`;
const windowKeys = Array.from({ length: SLEEP_WINDOW_DAYS }, (_, i) => key(i));

const night = (hours: number, source: 'manual' | 'import' = 'import'): SleepEntry => ({
  hours,
  source,
});

function day(dateKey: string, over: Partial<DaySummary> = {}): DaySummary {
  return {
    dateKey,
    totalCalories: 2000,
    totalProtein: 150,
    totalCarbs: 200,
    totalFat: 70,
    mealCount: 3,
    exercised: false,
    weightLb: null,
    ...over,
  };
}

/**
 * A window where the first `shortCount` nights are short and the rest long,
 * with `kcal` per group. The default is comfortably over every gate, so each
 * test below can break exactly one thing.
 */
function fixture(opts: {
  shortCount?: number;
  nights?: number;
  shortKcal?: number;
  longKcal?: number;
} = {}) {
  const nights = opts.nights ?? SLEEP_WINDOW_DAYS;
  const shortCount = opts.shortCount ?? 7;
  const sleepByDay: Record<string, SleepEntry> = {};
  const days: DaySummary[] = [];
  for (let i = 0; i < nights; i++) {
    const short = i < shortCount;
    sleepByDay[key(i)] = night(short ? 5.5 : 8);
    days.push(day(key(i), { totalCalories: short ? (opts.shortKcal ?? 2400) : (opts.longKcal ?? 2000) }));
  }
  return { sleepByDay, days };
}

describe('sleepWindow — the strip and the headline', () => {
  it('draws one column per day, oldest first, with gaps preserved as null', () => {
    const { nights } = sleepWindow({ [key(1)]: night(7), [key(3)]: night(8) }, windowKeys);

    expect(nights).toHaveLength(SLEEP_WINDOW_DAYS);
    expect(nights[0]).toEqual({ dateKey: key(0), hours: null });
    expect(nights[1]).toEqual({ dateKey: key(1), hours: 7 });
    // A missing night is NEVER a zero and is never interpolated: a zero says
    // "did not sleep", which is a claim about the user rather than about the
    // data, and the footer says the coverage out loud instead.
    expect(nights.filter((n) => n.hours === 0)).toEqual([]);
  });

  it('counts, averages and splits over the readings only', () => {
    const w = sleepWindow(
      { [key(0)]: night(6), [key(1)]: night(7), [key(2)]: night(8) },
      windowKeys,
    );

    expect(w.nightsWithReading).toBe(3);
    expect(w.meanHours).toBe(7);
    expect(w.medianHours).toBe(7);
  });

  it('reports provenance at window level, never per provider', () => {
    // `dailySleep` has no `provider` field, so "via Oura" is a claim the schema
    // cannot support (ADR-0033 §1). This is the whole vocabulary.
    expect(sleepWindow({ [key(0)]: night(7, 'import') }, windowKeys).provenance).toBe('imported');
    expect(sleepWindow({ [key(0)]: night(7, 'manual') }, windowKeys).provenance).toBe('typed');
    expect(
      sleepWindow({ [key(0)]: night(7, 'import'), [key(1)]: night(7, 'manual') }, windowKeys)
        .provenance,
    ).toBe('both');
    expect(sleepWindow({}, windowKeys).provenance).toBeNull();
  });

  it('treats a zero or a nonsense reading as no reading', () => {
    const w = sleepWindow(
      {
        [key(0)]: night(0),
        [key(1)]: { hours: Number.NaN, source: 'import' },
        [key(2)]: night(7),
      },
      windowKeys,
    );
    expect(w.nightsWithReading).toBe(1);
  });
});

describe('sleepIntakeContrast — the comparison', () => {
  it('splits at the user’s own median and reports both means', () => {
    const { sleepByDay, days } = fixture({ shortCount: 7, shortKcal: 2400, longKcal: 2000 });

    const c = sleepIntakeContrast(sleepByDay, days)!;

    expect(c.shortCount).toBe(7);
    expect(c.longCount).toBe(7);
    expect(c.shortMeanKcal).toBe(2400);
    expect(c.longMeanKcal).toBe(2000);
    expect(c.differenceKcal).toBe(400);
    expect(c.medianHours).toBe(6.75); // (5.5 + 8) / 2 — nobody's actual night
  });

  it('names the short nights, so the strip can tint exactly the claim', () => {
    const { sleepByDay, days } = fixture({ shortCount: 7 });

    const c = sleepIntakeContrast(sleepByDay, days)!;

    expect([...c.shortKeys].sort()).toEqual([
      key(0), key(1), key(2), key(3), key(4), key(5), key(6),
    ]);
  });

  it('drops nights equal to the median from BOTH groups', () => {
    // 13 nights: 6 at 5.5, one at 7, 6 at 8. The median IS 7, and that night
    // joins neither group — so "shorter" can never mean "the same as usual".
    const sleepByDay: Record<string, SleepEntry> = {};
    const days: DaySummary[] = [];
    for (let i = 0; i < 13; i++) {
      const hours = i < 6 ? 5.5 : i === 6 ? 7 : 8;
      sleepByDay[key(i)] = night(hours);
      days.push(day(key(i), { totalCalories: hours < 7 ? 2400 : 2000 }));
    }

    const c = sleepIntakeContrast(sleepByDay, days)!;

    expect(c.shortCount).toBe(6);
    expect(c.longCount).toBe(6);
    expect(c.shortKeys).not.toContain(key(6));
  });

  it('reports "ate LESS on short nights" with a negative difference', () => {
    // The claim is signed, not a magnitude. A card that only knew |diff| would
    // print "more" for a user who eats less when tired.
    const { sleepByDay, days } = fixture({ shortKcal: 1800, longKcal: 2300 });

    expect(sleepIntakeContrast(sleepByDay, days)!.differenceKcal).toBe(-500);
  });
});

describe('the evidence bar — every reason there is no sentence', () => {
  it('needs SLEEP_MIN_NIGHTS paired nights', () => {
    const below = fixture({ nights: SLEEP_MIN_NIGHTS - 1, shortCount: 5 });
    const at = fixture({ nights: SLEEP_MIN_NIGHTS, shortCount: 6 });

    expect(sleepIntakeContrast(below.sleepByDay, below.days)).toBeNull();
    expect(sleepIntakeContrast(at.sleepByDay, at.days)).not.toBeNull();
  });

  it('ignores a night whose own day was not fully logged', () => {
    // Half a pair is not evidence: an unlogged day contributes a zero that is
    // not a measurement of anything. Same predicate `loggedThisWeek` uses.
    const { sleepByDay, days } = fixture();
    const unlogged = days.map((d, i) =>
      i < 3 ? day(d.dateKey, { mealCount: 0, totalCalories: 0 }) : d,
    );

    expect(sleepIntakeContrast(sleepByDay, unlogged)).toBeNull();
  });

  it('needs SLEEP_MIN_GROUP nights on each side', () => {
    // A median split over DISTINCT values is always ~half and half, so this
    // gate only ever bites on ties — which are the common case here, because
    // `clampSleepHours` snaps every night to the half hour. A very regular
    // sleeper with two outlying nights either way has 14 nights of evidence
    // and four nights of contrast, and four is a coin flip.
    const sleepByDay: Record<string, SleepEntry> = {};
    const days: DaySummary[] = [];
    for (let i = 0; i < SLEEP_WINDOW_DAYS; i++) {
      const hours = i < 2 ? 5.5 : i < 4 ? 8.5 : 7;
      sleepByDay[key(i)] = night(hours);
      days.push(day(key(i), { totalCalories: hours < 7 ? 2600 : 2000 }));
    }

    const spread = sleepIntakeContrast(sleepByDay, days);

    expect(SLEEP_MIN_GROUP).toBeGreaterThan(2);
    expect(spread).toBeNull();
  });

  it('needs the two means at least SLEEP_MIN_KCAL_GAP apart', () => {
    const under = fixture({ shortKcal: 2000 + SLEEP_MIN_KCAL_GAP - 1, longKcal: 2000 });
    const at = fixture({ shortKcal: 2000 + SLEEP_MIN_KCAL_GAP, longKcal: 2000 });

    expect(sleepIntakeContrast(under.sleepByDay, under.days)).toBeNull();
    expect(sleepIntakeContrast(at.sleepByDay, at.days)).not.toBeNull();
  });

  it('says nothing for a user who sleeps consistently', () => {
    // Correctly: there is nothing to report. ADR-0033's consequences section
    // says so out loud, and the progress line has to carry that without
    // sounding like a countdown to a promise.
    const sleepByDay: Record<string, SleepEntry> = {};
    const days: DaySummary[] = [];
    for (let i = 0; i < SLEEP_WINDOW_DAYS; i++) {
      sleepByDay[key(i)] = night(7.5);
      days.push(day(key(i)));
    }

    expect(sleepIntakeContrast(sleepByDay, days)).toBeNull();
  });

  it('says nothing at all for an empty account', () => {
    expect(sleepIntakeContrast({}, [])).toBeNull();
  });
});

describe('presentation helpers', () => {
  it('splits hours into hours and minutes, carrying 60 up', () => {
    expect(sleepHoursParts(6.65)).toEqual({ hours: 6, minutes: 39 });
    expect(sleepHoursParts(8)).toEqual({ hours: 8, minutes: 0 });
    // 6.999 h is 419.94 min → 420 → 7h 0m, never 6h 60m.
    expect(sleepHoursParts(6.999)).toEqual({ hours: 7, minutes: 0 });
    expect(sleepHoursParts(0)).toEqual({ hours: 0, minutes: 0 });
    expect(sleepHoursParts(Number.NaN)).toEqual({ hours: 0, minutes: 0 });
  });

  it('scales bars against a FIXED ceiling, not the window’s own maximum', () => {
    // A self-scaling axis redraws a four-hour week to look exactly like an
    // eight-hour one.
    expect(sleepBarFraction(SLEEP_STRIP_CEILING_HOURS / 2)).toBe(0.5);
    expect(sleepBarFraction(SLEEP_STRIP_CEILING_HOURS)).toBe(1);
    expect(sleepBarFraction(SLEEP_STRIP_CEILING_HOURS + 4)).toBe(1);
    expect(sleepBarFraction(null)).toBe(0);
  });
});
