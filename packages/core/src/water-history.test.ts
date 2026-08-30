import { describe, expect, it } from 'vitest';
import {
  WATER_CARD_MIN_DAYS,
  WATER_STRIP_CEILING_FLOZ,
  WATER_WINDOW_DAYS,
  waterBarFraction,
  waterWindow,
} from './water-history';
import type { DateKey } from './date';

/**
 * The property under test throughout is that **a missing day and a zero day are
 * not the same thing**, and that nothing here invents a target.
 *
 * That first one is the whole reason `flOz` is nullable. Every other statistic
 * in this module is computed over the days that carry a record, so a gap
 * treated as a zero would drag the median down, widen the range toward zero and
 * draw a full-width bar of nothing — three wrong claims from one coercion. The
 * sibling modules learned it the same way (`SleepNight.hours`, `FastingDay.hours`).
 */

/** Fourteen consecutive keys ending on the given day, oldest first — the shape
 *  `trailingDateKeys` hands the hook. */
function keys(endingOn = '2026-08-30', n = WATER_WINDOW_DAYS): DateKey[] {
  const end = new Date(`${endingOn}T12:00:00Z`);
  const out: DateKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10) as DateKey);
  }
  return out;
}

describe('waterWindow', () => {
  it('returns one column per key, oldest first, with gaps preserved', () => {
    const k = keys();
    const w = waterWindow({ [k[0]]: 48, [k[13]]: 64 }, k);

    expect(w.days).toHaveLength(WATER_WINDOW_DAYS);
    expect(w.days.map((d) => d.dateKey)).toEqual(k);
    expect(w.days[0].flOz).toBe(48);
    expect(w.days[13].flOz).toBe(64);
    // Every other day carries no record, and that is null — not 0.
    expect(w.days.slice(1, 13).every((d) => d.flOz === null)).toBe(true);
  });

  it('counts, averages and ranks only the days that carry a record', () => {
    const k = keys();
    const w = waterWindow({ [k[2]]: 32, [k[5]]: 48, [k[9]]: 96 }, k);

    expect(w.daysLogged).toBe(3);
    expect(w.meanFlOz).toBeCloseTo((32 + 48 + 96) / 3, 6);
    expect(w.medianFlOz).toBe(48);
    expect(w.lowestFlOz).toBe(32);
    expect(w.highestFlOz).toBe(96);
  });

  it('does NOT let an unlogged day pull the statistics toward zero', () => {
    // The regression this module exists to avoid: eleven gaps must not read as
    // eleven zero-ounce days. If they did, the median would be 0, the range
    // would run from 0, and the strip would be a wall of full-width bars at the
    // baseline.
    const k = keys();
    const w = waterWindow({ [k[0]]: 60, [k[1]]: 64, [k[2]]: 68 }, k);

    expect(w.medianFlOz).toBe(64);
    expect(w.lowestFlOz).toBe(60);
    expect(w.meanFlOz).toBeCloseTo(64, 6);
  });

  it('treats a zero, a negative and a non-finite stored value as a gap', () => {
    const k = keys();
    const w = waterWindow(
      { [k[0]]: 0, [k[1]]: -5, [k[2]]: Number.NaN, [k[3]]: 40 } as Record<string, number>,
      k,
    );

    expect(w.daysLogged).toBe(1);
    expect(w.days[0].flOz).toBeNull();
    expect(w.days[1].flOz).toBeNull();
    expect(w.days[2].flOz).toBeNull();
    expect(w.days[3].flOz).toBe(40);
  });

  it('answers zeroes rather than NaN when nothing is logged', () => {
    const w = waterWindow({}, keys());

    expect(w.daysLogged).toBe(0);
    expect(w.meanFlOz).toBe(0);
    expect(w.medianFlOz).toBe(0);
    expect(w.lowestFlOz).toBe(0);
    expect(w.highestFlOz).toBe(0);
    expect(Number.isNaN(w.meanFlOz)).toBe(false);
  });

  it('takes the median between the two middle days on an even count', () => {
    const k = keys();
    const w = waterWindow({ [k[0]]: 20, [k[1]]: 40, [k[2]]: 60, [k[3]]: 100 }, k);

    expect(w.medianFlOz).toBe(50);
  });

  it('ignores stored keys that fall outside the window', () => {
    const k = keys();
    const w = waterWindow({ '2020-01-01': 999, [k[0]]: 48 }, k);

    expect(w.daysLogged).toBe(1);
    expect(w.highestFlOz).toBe(48);
  });
});

describe('waterBarFraction', () => {
  it('scales against the fixed ceiling', () => {
    expect(waterBarFraction(WATER_STRIP_CEILING_FLOZ / 2)).toBeCloseTo(0.5, 6);
    expect(waterBarFraction(WATER_STRIP_CEILING_FLOZ)).toBe(1);
  });

  it('clamps rather than rescaling when a day runs past the ceiling', () => {
    // The point of a fixed ceiling: one heavy day must not shrink every other
    // bar on the strip. It clamps, and the rest keep their heights.
    expect(waterBarFraction(WATER_STRIP_CEILING_FLOZ * 3)).toBe(1);
  });

  it('is zero for a gap, a zero and a non-finite value', () => {
    expect(waterBarFraction(null)).toBe(0);
    expect(waterBarFraction(0)).toBe(0);
    expect(waterBarFraction(-10)).toBe(0);
    expect(waterBarFraction(Number.NaN)).toBe(0);
  });
});

describe('the ceiling is a scale bound, not a goal', () => {
  it('is not one US gallon', () => {
    // 128 fl oz is the obvious round number and the wrong one: "a gallon a day"
    // is a fitness-culture target, and an axis topping out there turns every
    // honest bar into a shortfall against a goal this product does not hold.
    // A change to 128 should have to argue with this test first.
    expect(WATER_STRIP_CEILING_FLOZ).not.toBe(128);
  });

  it('clears the heaviest day ever measured on this project', () => {
    // 96 fl oz was the population maximum on 2026-08-30
    // (`scripts/trends-water-states.mjs`). The ceiling must sit above it, or the
    // strip clips a real day and the axis stops being true.
    expect(WATER_STRIP_CEILING_FLOZ).toBeGreaterThan(96);
  });

  it('keeps a typical day off the floor of the strip', () => {
    // p50 was 48 fl oz. A ceiling that renders a typical day below a fifth of
    // the strip is a chart of shortfall, whatever its labels say.
    expect(waterBarFraction(48)).toBeGreaterThan(0.2);
  });
});

describe('the card threshold', () => {
  it('matches its siblings, so Trends does not hold three different bars', () => {
    expect(WATER_CARD_MIN_DAYS).toBe(3);
  });
});
