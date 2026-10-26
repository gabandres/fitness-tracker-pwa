import { describe, expect, it } from 'vitest';
import { keyAt, PROFILE, row } from './complete-day.fixtures';
import { MIDNIGHT } from './day-boundary';
import { maintenanceView } from './maintenance-view';
import { calculateTdee, MEASURED_MIN_DAYS } from './tdee';
import {
  activeTravel,
  altitudeNote,
  DEFAULT_USUAL_STEPS,
  isTravelDay,
  lastEndedTravel,
  stepsVsUsual,
  TRAVEL_REBUILD_DAYS,
  travelPeriodsOf,
  withoutTravelWeights,
  type TravelPeriod,
} from './travel';
import type { DailyLog, ProfileFields } from './types';

/**
 * Travel mode (owner, 2026-10-26: Bolivia 2026-10-31 → 2026-11-18). The trip's
 * days never reach the maintenance fit; inside the trip the estimate is frozen
 * at its value as of the trip's first day; after it the frozen value holds
 * until 14 complete post-travel days exist.
 */

const BOLIVIA: TravelPeriod = {
  start: '2026-10-31',
  end: '2026-11-18',
  label: 'Bolivia',
  usualSteps: 6200,
  altitude: { place: 'Cochabamba', meters: 2577, arrival: '2026-11-01' },
};
const withTrip = (periods: TravelPeriod[] = [BOLIVIA]): ProfileFields => ({ ...PROFILE, travelPeriods: periods });

/**
 * A fully logged user from 2026-08-01 to 2026-12-31 on a slow cut. Inside the
 * trip the numbers are deliberately absurd — 700 kcal days and a gym scale
 * reading 10 lb heavy — so any leak into the fit moves the answer.
 */
function cutWithTrip(): { logs: DailyLog[]; weights: Record<string, number> } {
  const logs: DailyLog[] = [];
  const weights: Record<string, number> = {};
  for (let i = 0; i < 153; i++) {
    const key = keyAt('2026-08-01', i);
    const travel = key >= BOLIVIA.start && key <= BOLIVIA.end;
    const kcal = travel ? 700 : 1800 + ((i * 137) % 400);
    const weight = travel ? 165 : Math.round((160 - i * 0.07 + (((i * 7) % 5) - 2) * 0.3) * 10) / 10;
    logs.push(row(key, kcal, weight));
    weights[key] = weight;
  }
  return { logs, weights };
}

const at = (iso: string) => new Date(iso);
const tdeeAt = (now: Date, periods?: TravelPeriod[]) => {
  const { logs, weights } = cutWithTrip();
  return calculateTdee(logs, periods ? withTrip(periods) : PROFILE, MIDNIGHT, now, weights);
};

describe('travel periods on the profile', () => {
  it('cleans what the rules cannot: malformed entries are dropped, the rest sorted', () => {
    const periods = travelPeriodsOf({
      travelPeriods: [
        { start: '2026-12-20', end: '2026-12-27', label: '  Xmas  ' },
        { start: '2026-11-18', end: '2026-10-31' }, // reversed
        { start: '2026-02-30', end: '2026-03-02' }, // no such day
        { start: 20261031, end: '2026-11-18' }, // not a key
        BOLIVIA,
        null,
      ],
    });
    expect(periods.map((p) => p.start)).toEqual(['2026-10-31', '2026-12-20']);
    expect(periods[1].label).toBe('Xmas');
    expect(periods[0].altitude).toEqual(BOLIVIA.altitude);
    expect(travelPeriodsOf({})).toEqual([]);
    expect(travelPeriodsOf(null)).toEqual([]);
  });

  it('knows which days are travel days, inclusive at both ends', () => {
    expect(isTravelDay('2026-10-30', [BOLIVIA])).toBe(false);
    expect(isTravelDay('2026-10-31', [BOLIVIA])).toBe(true);
    expect(isTravelDay('2026-11-18', [BOLIVIA])).toBe(true);
    expect(isTravelDay('2026-11-19', [BOLIVIA])).toBe(false);
    expect(activeTravel('2026-11-05', [BOLIVIA])).toBe(BOLIVIA);
    // Auto-exit is a property of the dates.
    expect(activeTravel('2026-11-19', [BOLIVIA])).toBeNull();
    expect(lastEndedTravel('2026-11-19', [BOLIVIA])).toBe(BOLIVIA);
  });

  it('shows the altitude note on the arrival day and the two after it, nowhere else', () => {
    expect(altitudeNote('2026-10-31', BOLIVIA)).toBeNull(); // Santa Cruz
    expect(altitudeNote('2026-11-01', BOLIVIA)).toEqual({ place: 'Cochabamba', meters: 2577, day: 1 });
    expect(altitudeNote('2026-11-03', BOLIVIA)?.day).toBe(3);
    expect(altitudeNote('2026-11-04', BOLIVIA)).toBeNull();
    expect(altitudeNote('2026-11-02', { ...BOLIVIA, altitude: undefined })).toBeNull();
  });

  it('compares steps with the usual count, 6,000 when the trip names none', () => {
    expect(stepsVsUsual(12_400, BOLIVIA)).toEqual({ steps: 12_400, usual: 6200, ratio: 2 });
    expect(stepsVsUsual(null, { start: '2026-10-31', end: '2026-11-18' }).usual).toBe(DEFAULT_USUAL_STEPS);
  });

  it('keeps travel-day weigh-ins out of what the trend and the 7-day average read', () => {
    const w = { '2026-10-30': 152, '2026-11-05': 160, '2026-11-19': 151.4 };
    expect(withoutTravelWeights(w, [BOLIVIA])).toEqual({ '2026-10-30': 152, '2026-11-19': 151.4 });
    expect(withoutTravelWeights(w, [])).toBe(w);
  });

  it('rebuilds over the estimator\'s own minimum', () => {
    expect(TRAVEL_REBUILD_DAYS).toBe(MEASURED_MIN_DAYS);
  });
});

describe('the maintenance estimate around a trip', () => {
  // What Today showed the morning the trip started, with no trip on file.
  const before = tdeeAt(at('2026-10-31T00:00:00'));

  it('is a measured number to freeze in the first place', () => {
    expect(before.source).toBe('measured');
  });

  it('is unchanged by a trip that has not started', () => {
    const now = at('2026-10-20T09:00:00');
    expect(tdeeAt(now, [BOLIVIA]).trueTdee).toBe(tdeeAt(now).trueTdee);
    expect(tdeeAt(now, [BOLIVIA]).travelHold).toBeUndefined();
  });

  it('is FROZEN during the trip at its value as of the first travel day', () => {
    for (const iso of ['2026-10-31T09:00:00', '2026-11-05T20:00:00', '2026-11-18T23:00:00']) {
      const r = tdeeAt(at(iso), [BOLIVIA]);
      expect(r.trueTdee).toBe(before.trueTdee);
      expect(r.travelHold).toEqual({
        state: 'frozen', start: '2026-10-31', end: '2026-11-18', frozenAsOf: '2026-10-30', label: 'Bolivia',
      });
    }
  });

  it('would have been dragged by the trip\'s numbers without travel mode', () => {
    expect(tdeeAt(at('2026-11-18T23:00:00')).trueTdee).not.toBe(before.trueTdee);
  });

  it('stays frozen after the trip — "rebuilding" — and counts complete days home', () => {
    const r = tdeeAt(at('2026-11-25T09:00:00'), [BOLIVIA]);
    expect(r.trueTdee).toBe(before.trueTdee);
    // 11/19 … 11/24 finished; 11/25 is in progress and not judged.
    expect(r.travelHold).toMatchObject({ state: 'rebuilding', valid: 6, needed: 14 });
    const view = maintenanceView(r, 0);
    expect(view?.travelHold?.state).toBe('rebuilding');
  });

  it('returns to the live fit — over non-travel days only — after 14 complete days home', () => {
    const now = at('2026-12-03T09:00:00'); // 11/19 … 12/02 = 14 finished days
    const r = tdeeAt(now, [BOLIVIA]);
    expect(r.travelHold).toBeUndefined();
    // The same answer as a record that never had the trip's days in it.
    const { logs, weights } = cutWithTrip();
    const home = logs.filter((l) => !isTravelDay(keyAt('2026-08-01', Math.round((l.date.getTime() - at('2026-08-01T12:00:00').getTime()) / 86_400_000)), [BOLIVIA]));
    const homeWeights = withoutTravelWeights(weights, [BOLIVIA]);
    expect(r.trueTdee).toBe(calculateTdee(home, PROFILE, MIDNIGHT, now, homeWeights).trueTdee);
  });

  it('a day home that is not complete does not count toward the rebuild', () => {
    const { logs, weights } = cutWithTrip();
    const thin = logs.map((l) => (l.date >= at('2026-11-19T00:00:00') && l.date < at('2026-11-22T00:00:00') ? { ...l, calories: 400 } : l));
    const r = calculateTdee(thin, withTrip(), MIDNIGHT, at('2026-11-25T09:00:00'), weights);
    expect(r.travelHold).toMatchObject({ state: 'rebuilding', valid: 3 });
  });

  it('an older trip only removes its days; the latest started trip governs', () => {
    const summer: TravelPeriod = { start: '2026-08-20', end: '2026-08-27' };
    const r = tdeeAt(at('2026-11-05T09:00:00'), [summer, BOLIVIA]);
    expect(r.travelHold?.state).toBe('frozen');
    // Frozen over the record with the summer trip removed.
    const { logs, weights } = cutWithTrip();
    const frozenWithoutSummer = calculateTdee(logs, withTrip([summer]), MIDNIGHT, at('2026-10-31T00:00:00'), weights);
    expect(r.trueTdee).toBe(frozenWithoutSummer.trueTdee);
  });
});
