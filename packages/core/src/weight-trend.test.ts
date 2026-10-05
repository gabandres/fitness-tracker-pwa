import { describe, expect, it } from 'vitest';
import {
  extremeSince,
  goalProgressAt,
  pointsInRange,
  previousWeighIn,
  sortedWeighIns,
  trailingAverageLb,
  trendMilestoneCrossed,
  trendShift,
  trendStepLb,
  trendWeight,
  weighInConsistency,
  weighInDeltas,
  trendWeightSeries,
} from './weight-trend';
import { sameDisplayedWeight, toDisplayWeight, parseWeightToLb } from './body-weight-units';
import { dropOverriddenSamples, type HealthSample } from './health-mapping';
import { setDayStartHour } from './day-boundary';
import type { DateKey } from './date';
import { weightTrendSeries } from './tdee-series';

const pts = (rows: [string, number][]) => rows.map(([dateKey, weightLb]) => ({ dateKey, weightLb }));

describe('trendWeightSeries — the damped level + slope trend (S20)', () => {
  /** Daily readings losing `perDay` lb from 184.6, with a ±0.6 lb wobble. */
  function steadyLoss(days: number, perDay: number) {
    const rows: [string, number][] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(2026, 6, 12 + i)).toISOString().slice(0, 10);
      rows.push([d, 184.6 - perDay * i + (i % 2 ? 0.6 : -0.6)]);
    }
    return pts(rows);
  }

  it('tracks a steady loss instead of lagging ~9 readings behind it', () => {
    const points = steadyLoss(42, 0.18);
    const last = trendWeightSeries(points).at(-1)!.weightLb;
    const truth = 184.6 - 0.18 * 41;
    // The old 0.1 average sat ~1.6 lb above the line here — above every dot.
    expect(Math.abs(last - truth)).toBeLessThan(0.5);
  });

  it('a flat scale gives a flat trend', () => {
    const s = trendWeightSeries(pts([['2026-09-01', 180], ['2026-09-02', 180], ['2026-09-05', 180], ['2026-09-20', 180]]));
    for (const p of s) expect(p.weightLb).toBeCloseTo(180, 9);
  });

  it('a reading after a long gap is taken seriously, not damped to a tenth', () => {
    const s = trendWeightSeries(pts([['2026-08-01', 180], ['2026-08-22', 176]]));
    // 21 days of news: 1 − 0.9^21 ≈ 0.89 of the difference.
    expect(s[1].weightLb).toBeLessThan(176.6);
  });

  it('starts at the first reading and moves a tenth of the way per daily reading', () => {
    const s = trendWeightSeries(pts([['2026-09-01', 180], ['2026-09-02', 170]]));
    expect(s[0].weightLb).toBe(180);
    expect(s[1].weightLb).toBeCloseTo(179, 6); // 180 + 0.1 × (170 − 180)
  });

  it('a one-day water spike barely moves the trend', () => {
    const s = trendWeightSeries(pts([['2026-09-01', 180], ['2026-09-02', 180], ['2026-09-03', 183]]));
    expect(s[2].weightLb - 180).toBeCloseTo(0.3, 6);
  });

  it('is the Trends smoother — the same number the Trends chart draws', () => {
    const weights = { '2026-09-01': 180, '2026-09-03': 179, '2026-09-04': 182, '2026-09-08': 178 };
    const keys = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05', '2026-09-06', '2026-09-07', '2026-09-08'] as DateKey[];
    const trends = weightTrendSeries(weights, keys);
    expect(trendWeight(sortedWeighIns(weights))).toBeCloseTo(trends[trends.length - 1].trend as number, 9);
  });

  it('sorts its input — a trend fed out of order would be a different number', () => {
    const forward = trendWeightSeries(pts([['2026-09-01', 180], ['2026-09-02', 179], ['2026-09-03', 178]]));
    const shuffled = trendWeightSeries(pts([['2026-09-03', 178], ['2026-09-01', 180], ['2026-09-02', 179]]));
    expect(shuffled).toEqual(forward);
  });

  it('trendWeight is the last trend value, null with no data', () => {
    expect(trendWeight([])).toBeNull();
    expect(trendWeight(pts([['2026-09-01', 180]]))).toBe(180);
  });
});

describe('trendShift — the "Trend −0.2" receipt', () => {
  it('reports the trend before and after one write', () => {
    const weights = { '2026-09-01': 180, '2026-09-02': 180 };
    const { beforeLb, afterLb } = trendShift(weights, '2026-09-03', 178);
    expect(beforeLb).toBe(180);
    expect(afterLb).toBeCloseTo(179.8, 6);
  });

  it('a first-ever weigh-in has no before', () => {
    expect(trendShift({}, '2026-09-01', 180)).toEqual({ beforeLb: null, afterLb: 180 });
  });
});

describe('pointsInRange', () => {
  const all = pts([
    ['2025-09-01', 190],
    ['2026-06-01', 185],
    ['2026-08-10', 182],
    ['2026-09-05', 181],
    ['2026-10-04', 180],
  ]);

  it('1M is today plus the 29 days before it', () => {
    expect(pointsInRange(all, '1M', '2026-10-04').map((p) => p.dateKey)).toEqual(['2026-09-05', '2026-10-04']);
    expect(pointsInRange(all, '1M', '2026-10-03').map((p) => p.dateKey)).toEqual(['2026-09-05']);
  });

  it('All keeps everything, oldest first', () => {
    expect(pointsInRange([...all].reverse(), 'All', '2026-10-04')).toEqual(all);
  });

  it('1Y drops the reading from 13 months ago', () => {
    expect(pointsInRange(all, '1Y', '2026-10-04')[0].dateKey).toBe('2026-06-01');
  });
});

describe('per-row facts', () => {
  const weights = { '2026-09-20': 181.5, '2026-09-28': 180, '2026-09-25': 182 };

  it('previousWeighIn is the reading immediately before the day', () => {
    expect(previousWeighIn(weights, '2026-09-28')).toEqual({ dateKey: '2026-09-25', weightLb: 182 });
    expect(previousWeighIn(weights, '2026-09-26')).toEqual({ dateKey: '2026-09-25', weightLb: 182 });
    expect(previousWeighIn(weights, '2026-09-20')).toBeNull();
  });

  it('weighInDeltas is newest first, with no delta on the oldest row', () => {
    const rows = weighInDeltas(weights);
    expect(rows.map((r) => r.dateKey)).toEqual(['2026-09-28', '2026-09-25', '2026-09-20']);
    expect(rows[0].deltaLb).toBeCloseTo(-2, 6);
    expect(rows[1].deltaLb).toBeCloseTo(0.5, 6);
    expect(rows[2].deltaLb).toBeNull();
  });

  it('sortedWeighIns ignores junk values', () => {
    expect(sortedWeighIns({ '2026-09-02': 180, '2026-09-01': Number.NaN })).toEqual(pts([['2026-09-02', 180]]));
  });
});

describe('weighInConsistency — a count, not a streak', () => {
  it('counts weighed days in the trailing window', () => {
    const weights = { '2026-10-04': 180, '2026-10-03': 180, '2026-09-30': 180, '2026-09-01': 185 };
    expect(weighInConsistency(weights, 14, new Date(2026, 9, 4, 9))).toEqual({ logged: 3, days: 14 });
  });

  it('is boundary-aware: at 01:00 under a 03:00 start, "today" is still yesterday', () => {
    const boundary = setDayStartHour([], '2026-01-01' as DateKey, 3);
    const weights = { '2026-10-03': 180 };
    expect(weighInConsistency(weights, 1, new Date(2026, 9, 4, 1), boundary).logged).toBe(1);
  });
});

describe('trailingAverageLb — the 7-day average beside the trend', () => {
  it('averages only the readings inside the window', () => {
    const weights = { '2026-10-04': 180, '2026-10-02': 181, '2026-09-28': 182, '2026-09-27': 190 };
    expect(trailingAverageLb(weights, 7, new Date(2026, 9, 4, 9))).toEqual({ avgLb: 181, count: 3 });
  });

  it('is null under two readings — one reading is not an average', () => {
    expect(trailingAverageLb({ '2026-10-04': 180 }, 7, new Date(2026, 9, 4, 9))).toBeNull();
    expect(trailingAverageLb({}, 7, new Date(2026, 9, 4, 9))).toBeNull();
  });

  it('is boundary-aware like the count', () => {
    const boundary = setDayStartHour([], '2026-01-01' as DateKey, 3);
    // At 01:00 under a 03:00 start "today" is Oct 3, so Sep 27 is inside.
    const weights = { '2026-10-03': 180, '2026-09-27': 182, '2026-09-26': 200 };
    expect(trailingAverageLb(weights, 7, new Date(2026, 9, 4, 1), boundary)).toEqual({ avgLb: 181, count: 2 });
  });
});

describe('trendMilestoneCrossed — every 5 lb / 2 kg of trend', () => {
  it('fires once on crossing a step, in the goal direction', () => {
    expect(trendMilestoneCrossed(200, 195.2, 194.9, 5, 'lose')).toBe(1);
    expect(trendMilestoneCrossed(200, 194.9, 194.5, 5, 'lose')).toBeNull();
    expect(trendMilestoneCrossed(200, 190.1, 189.9, 5, 'lose')).toBe(2);
  });

  it('does not celebrate moving AWAY from the goal', () => {
    expect(trendMilestoneCrossed(200, 204.9, 205.1, 5, 'lose')).toBeNull();
    expect(trendMilestoneCrossed(200, 204.9, 205.1, 5, 'gain')).toBe(1);
  });

  it('without a goal, counts magnitude either way', () => {
    expect(trendMilestoneCrossed(200, 204.9, 205.1, 5, null)).toBe(1);
  });

  it('a metric step is 2 kg, not 5 lb', () => {
    expect(trendStepLb('metric')).toBeCloseTo(4.40924, 4);
    expect(trendStepLb('us')).toBe(5);
  });

  it('rejects garbage rather than firing', () => {
    expect(trendMilestoneCrossed(Number.NaN, 1, 2, 5)).toBeNull();
    expect(trendMilestoneCrossed(200, 195, 190, 0)).toBeNull();
  });
});

describe('sameDisplayedWeight — bug 3, the fake preview', () => {
  it('an untouched kg prefill is not a change', () => {
    const shown = toDisplayWeight(180, 'metric'); // 81.6
    const reparsed = parseWeightToLb(String(shown), 'metric')!; // 179.897…
    expect(reparsed).not.toBe(180);
    expect(sameDisplayedWeight(reparsed, 180, 'metric')).toBe(true);
  });

  it('a real 0.1 change is a change', () => {
    expect(sameDisplayedWeight(180, 180.1, 'us')).toBe(false);
  });
});

describe('dropOverriddenSamples — a deleted weigh-in stays deleted', () => {
  const s = (over: Partial<HealthSample>): HealthSample => ({
    dateKey: '2026-09-28',
    kind: 'weight',
    value: 180,
    endMs: 1_000,
    fromUs: false,
    ...over,
  });

  it('drops a scale sample taken BEFORE the delete', () => {
    expect(dropOverriddenSamples([s({ endMs: 1_000 })], { '2026-09-28': 2_000 })).toEqual([]);
  });

  it('keeps a reading taken AFTER it — newer information than the correction', () => {
    const later = s({ endMs: 3_000, value: 179 });
    expect(dropOverriddenSamples([later], { '2026-09-28': 2_000 })).toEqual([later]);
  });

  it('leaves other days alone', () => {
    const other = s({ dateKey: '2026-09-27' });
    expect(dropOverriddenSamples([other], { '2026-09-28': 2_000 })).toEqual([other]);
  });

  it('no overrides is a copy of the input', () => {
    const list = [s({})];
    expect(dropOverriddenSamples(list, {})).toEqual(list);
    expect(dropOverriddenSamples(list, null)).toEqual(list);
  });
});

describe('extremeSince — "lowest since" on the weigh-in receipt', () => {
  const w = { '2026-09-01': 182, '2026-09-10': 180.5, '2026-09-20': 181.2, '2026-09-28': 181.0 };

  it('names the most recent earlier reading at least as low', () => {
    // 180.4 beats everything since Sep 10 (180.5 is higher) — and nothing is as low → a new low.
    expect(extremeSince(w, '2026-10-05', 180.4, 'lose')).toEqual({ sinceKey: null });
    // 180.7 is lower than Sep 20 and Sep 28, not lower than Sep 10's 180.5.
    expect(extremeSince(w, '2026-10-05', 180.7, 'lose')).toEqual({ sinceKey: '2026-09-10' });
  });

  it('stays quiet when the reading it beats is under two weeks old', () => {
    // 181.1 is lower than Sep 20 only; Sep 28 (181.0) is lower and 7 days back.
    expect(extremeSince(w, '2026-10-05', 181.1, 'lose')).toBeNull();
  });

  it('ties go against the claim', () => {
    expect(extremeSince({ '2026-09-01': 180 }, '2026-10-05', 180, 'lose')).toEqual({ sinceKey: '2026-09-01' });
    expect(extremeSince({ '2026-09-30': 180 }, '2026-10-05', 180, 'lose')).toBeNull();
  });

  it('mirrors for gain', () => {
    expect(extremeSince(w, '2026-10-05', 182.5, 'gain')).toEqual({ sinceKey: null });
    expect(extremeSince(w, '2026-10-05', 181.5, 'gain')).toEqual({ sinceKey: '2026-09-01' });
  });

  it('never fires without a direction, on a past-day correction, or on thin history', () => {
    expect(extremeSince(w, '2026-10-05', 170, null)).toBeNull();
    expect(extremeSince(w, '2026-10-05', 170, undefined)).toBeNull();
    expect(extremeSince(w, '2026-09-15', 170, 'lose')).toBeNull();
    expect(extremeSince({}, '2026-10-05', 170, 'lose')).toBeNull();
    expect(extremeSince({ '2026-10-01': 181 }, '2026-10-05', 170, 'lose')).toBeNull();
  });

  it('ignores the day being written (an edit of today is judged against the rest)', () => {
    expect(extremeSince({ ...w, '2026-10-05': 185 }, '2026-10-05', 180.4, 'lose')).toEqual({ sinceKey: null });
  });
});

describe('goalProgressAt — goal progress on the trend (Body re-score, bug 3)', () => {
  const scale = { startWeight: 200, currentWeight: 179.6, goalWeight: 180, pct: 100, remaining: 0 };

  it('re-states pct and remaining at the trend weight', () => {
    // One light morning put the SCALE past the goal; the trend is still 0.6 above it.
    const p = goalProgressAt(scale, 180.6);
    expect(p).toEqual({ startWeight: 200, currentWeight: 180.6, goalWeight: 180, pct: 97, remaining: 0.6 });
  });

  it('is directional for a gain and clamps past the goal', () => {
    const gain = { startWeight: 150, currentWeight: 160, goalWeight: 165, pct: 67, remaining: 5 };
    expect(goalProgressAt(gain, 166)).toEqual({ ...gain, currentWeight: 166, pct: 100, remaining: 0 });
    expect(goalProgressAt(gain, 148).pct).toBe(0);
  });

  it('passes the progress through when there is no trend', () => {
    expect(goalProgressAt(scale, null)).toBe(scale);
    expect(goalProgressAt(scale, Number.NaN)).toBe(scale);
  });
});
