import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import {
  HUNGER_WINDOW_DAYS,
  hungerRaiseTarget,
  hungerWeek,
  isStorableHunger,
  readEveningHunger,
} from './evening-hunger';
import { trailingDateKeys } from './log-window';

const WEEK = ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19', '2026-10-20'];

describe('evening hunger — storage', () => {
  it('accepts whole numbers 0–10 only', () => {
    for (const n of [0, 5, 10]) expect(isStorableHunger(n)).toBe(true);
    for (const n of [-1, 11, 6.5, Number.NaN, '7', null, undefined]) expect(isStorableHunger(n)).toBe(false);
  });

  it('reads { level } and nothing else', () => {
    expect(readEveningHunger({ level: 7 })).toBe(7);
    expect(readEveningHunger({ level: 0 })).toBe(0);
    expect(readEveningHunger({ level: 12 })).toBeNull();
    expect(readEveningHunger({})).toBeNull();
    expect(readEveningHunger(undefined)).toBeNull();
  });
});

describe('evening hunger — 7-day average', () => {
  it('averages the rated days of the trailing week', () => {
    const w = hungerWeek({ '2026-10-14': 6, '2026-10-16': 8, '2026-10-20': 7, '2026-10-01': 10 }, WEEK);
    expect(w).toEqual({ average: 7, ratedDays: 3, windowDays: 7, raise: true });
  });

  it('leaves unrated days out rather than counting them as 0 (0 means full)', () => {
    const w = hungerWeek({ '2026-10-20': 8 }, WEEK);
    expect(w.average).toBe(8);
    expect(w.ratedDays).toBe(1);
  });

  it('a 0 IS a rating: it pulls the average down', () => {
    expect(hungerWeek({ '2026-10-19': 0, '2026-10-20': 8 }, WEEK).average).toBe(4);
  });

  it('crosses the rule at exactly 7, not below', () => {
    expect(hungerWeek({ '2026-10-19': 7, '2026-10-20': 7 }, WEEK).raise).toBe(true);
    expect(hungerWeek({ '2026-10-19': 7, '2026-10-20': 6 }, WEEK).raise).toBe(false);
  });

  it('no ratings → no average and no rule', () => {
    expect(hungerWeek({}, WEEK)).toEqual({ average: null, ratedDays: 0, windowDays: 7, raise: false });
  });

  it('an edited day counts once, at its new value', () => {
    const byDay: Record<string, number> = { '2026-10-19': 9, '2026-10-20': 9 };
    expect(hungerWeek(byDay, WEEK).average).toBe(9);
    byDay['2026-10-20'] = 3; // the edit replaces the day's value; it does not add one
    expect(hungerWeek(byDay, WEEK)).toMatchObject({ average: 6, ratedDays: 2, raise: false });
  });

  it('the window is the trailing seven days, today included', () => {
    const keys = trailingDateKeys(HUNGER_WINDOW_DAYS, new Date(2026, 9, 20, 21, 0));
    expect(keys).toEqual(WEEK);
  });

  it('suggests the target + 100, to the nearest 50 (the owner\'s 1,850 → 1,950)', () => {
    expect(hungerRaiseTarget(1850)).toBe(1950);
    expect(hungerRaiseTarget(2010)).toBe(2100);
    expect(hungerRaiseTarget(null)).toBeNull();
    expect(hungerRaiseTarget(0)).toBeNull();
  });
});

describe('evening hunger — CSV', () => {
  it('exports one hunger row per rated day, in its own column', () => {
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
      dailyHunger: { '2026-10-20': 7, '2026-10-19': 0 },
    });
    const [header, ...rows] = csv.split('\r\n');
    const cols = header.split(',');
    expect(cols[cols.length - 1]).toBe('eveningHunger'); // appended: no column moved
    const hunger = rows.filter((r) => r.startsWith('hunger,')).map((r) => r.split(','));
    expect(hunger.map((r) => [r[cols.indexOf('date')], r[cols.indexOf('eveningHunger')]])).toEqual([
      ['2026-10-19', '0'],
      ['2026-10-20', '7'],
    ]);
  });

  it('a caller without hunger data exports no hunger rows', () => {
    const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {} });
    expect(csv.split('\r\n').some((r) => r.startsWith('hunger,'))).toBe(false);
  });
});
