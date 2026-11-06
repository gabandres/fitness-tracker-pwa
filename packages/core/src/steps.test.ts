import { describe, expect, it } from 'vitest';
import { buildCsv } from './csv-export';
import { readActivity } from './daily-scalars';
import { activitySourceLabel, isStepDayFinal, stepDaysToWrite, stepsAverage, tripStepDays, usualSteps } from './steps';

const day = (steps: number) => ({ steps });

describe('usualSteps', () => {
  it('is the median of the 28 days before today, rounded to 100, travel days out', () => {
    const a: Record<string, { steps: number }> = {};
    // 10/03–10/30: 6,000 … plus one 25k day that a mean would chase.
    for (let d = 3; d <= 30; d++) a[`2026-10-${String(d).padStart(2, '0')}`] = day(6000 + (d % 3) * 100);
    a['2026-10-20'] = day(25_000);
    // Travel days at 10k are out.
    a['2026-10-31'] = day(10_000);
    expect(usualSteps(a, '2026-10-31', [])).toBe(6100);
    const trip = [{ start: '2026-10-25', end: '2026-11-18' }];
    expect(usualSteps({ ...a, '2026-11-05': day(10_000) }, '2026-11-06', trip)).toBe(6100);
  });

  it('is null with fewer than 7 counted days', () => {
    expect(usualSteps({ '2026-11-01': day(5000) }, '2026-11-06')).toBeNull();
  });
});

describe('stepsAverage', () => {
  it('averages the last 7 complete days that have a count, not today', () => {
    const a = {
      '2026-11-06': day(1000), // today, partial — out
      '2026-11-05': day(6671), '2026-11-04': day(10641), '2026-11-03': day(9957), '2026-11-02': day(9080),
      '2026-11-01': day(5853), '2026-10-31': day(7089), '2026-10-30': day(7082),
      '2026-10-29': day(9712), // 8 days back — out
    };
    expect(stepsAverage(a, '2026-11-06')).toEqual({ mean: Math.round((6671 + 10641 + 9957 + 9080 + 5853 + 7089 + 7082) / 7), days: 7, window: 7 });
    expect(stepsAverage({}, '2026-11-06')).toBeNull();
  });
});

describe('isStepDayFinal', () => {
  it('turns final at 03:00 local the next morning', () => {
    expect(isStepDayFinal('2026-11-05', new Date(2026, 10, 6, 2, 59))).toBe(false);
    expect(isStepDayFinal('2026-11-05', new Date(2026, 10, 6, 3, 0))).toBe(true);
  });
});

describe('stepDaysToWrite', () => {
  const now = new Date(2026, 10, 6, 9, 0);
  it('keeps a final day stored in another zone; writes the rest', () => {
    const apply = { '2026-11-03': 9000, '2026-11-05': 7000, '2026-11-06': 1200, '2026-11-04': 10641 };
    const stored = {
      '2026-11-03': { tz: 'America/Puerto_Rico' }, // final, other zone → kept
      '2026-11-04': { tz: 'America/La_Paz' }, // final, same zone → written
      '2026-11-05': { tz: 'America/Puerto_Rico' }, // final (past 03:00 11/6) → kept
      '2026-11-06': { tz: 'America/Puerto_Rico' }, // today, not final → written
    };
    expect(stepDaysToWrite(apply, stored, 'America/La_Paz', now)).toEqual({ '2026-11-04': 10641, '2026-11-06': 1200 });
  });
  it('writes everything when the zone is unknown or nothing is stored', () => {
    const apply = { '2026-11-01': 5853 };
    expect(stepDaysToWrite(apply, { '2026-11-01': { tz: 'Europe/Madrid' } }, undefined, now)).toEqual(apply);
    expect(stepDaysToWrite(apply, {}, 'America/La_Paz', now)).toEqual(apply);
  });
});

describe('tripStepDays', () => {
  it('lists the trip from its start to today; no future days', () => {
    const days = tripStepDays({ start: '2026-10-31', end: '2026-11-18' }, { '2026-10-31': day(7089), '2026-11-06': day(1031) }, '2026-11-06');
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ dateKey: '2026-10-31', steps: 7089, today: false });
    expect(days[1].steps).toBeNull();
    expect(days[6]).toEqual({ dateKey: '2026-11-06', steps: 1031, today: true });
  });
});

describe('readActivity — 2026-11-06 fields', () => {
  it('reads distance, source, zone and a Firestore timestamp; an old doc reads as before', () => {
    const at = new Date('2026-11-06T13:00:00Z');
    expect(readActivity({ steps: 10641, distanceM: 7400.4, source: 'healthkit', tz: 'America/La_Paz', updatedAt: { toDate: () => at } }))
      .toEqual({ steps: 10641, activeKcal: undefined, distanceM: 7400.4, source: 'healthkit', tz: 'America/La_Paz', updatedAt: at });
    expect(readActivity({ steps: 4656, activeKcal: 290 })).toEqual({ steps: 4656, activeKcal: 290 });
    expect(readActivity({ steps: 1, source: 'fitbit' }).source).toBeUndefined();
  });
});

describe('export — steps rows', () => {
  it('writes one steps row per counted day with distance, source and lastUpdated', () => {
    const csv = buildCsv({
      logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {},
      dailyActivity: {
        '2026-11-04': { steps: 10641, activeKcal: 542, distanceM: 7612.6, source: 'healthkit', updatedAt: new Date('2026-11-05T07:10:00Z') },
        '2026-11-05': { activeKcal: 379 }, // no steps → no row
        '2026-10-08': { steps: 4656, activeKcal: 290 }, // stored before sources
      },
    });
    const [head, ...lines] = csv.split(/\r?\n/);
    const cols = head.split(',');
    const at = (l: string, c: string) => l.split(',')[cols.indexOf(c)];
    const steps = lines.filter((l) => l.startsWith('steps,'));
    expect(steps).toHaveLength(2);
    expect(steps.map((l) => at(l, 'date'))).toEqual(['2026-10-08', '2026-11-04']);
    expect([at(steps[1], 'steps'), at(steps[1], 'distanceM'), at(steps[1], 'source'), at(steps[1], 'lastUpdated')])
      .toEqual(['10641', '7613', 'HealthKit', '2026-11-05T07:10:00.000Z']);
    expect(at(steps[0], 'source')).toBe('');
    expect(activitySourceLabel('oura')).toBe('Oura');
  });
});
