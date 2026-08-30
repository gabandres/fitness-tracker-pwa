import { describe, expect, it } from 'vitest';
import { buildInsights, deltaPct, pct, pooledRetention, sumEvent, type InsightInputs, type UsageSeries } from './admin-insights';

function usage(over: Partial<UsageSeries> = {}): UsageSeries {
  return {
    from: '2026-08-01', to: '2026-08-30', days: 30, computedAt: '', daily: [],
    dau: 10, wau: 30, mau: 40, wauPrior: 20, usersInWindow: 40,
    eventTotals: {}, platformTotals: { ios: 50, android: 51 },
    ...over,
  };
}

const empty: InsightInputs = { stats: null, usage: null, retention: null, ceilings: [], heartbeatAgeMin: null, unreadFeedback: 0 };

describe('admin insights', () => {
  it('pct and deltaPct refuse to divide by zero', () => {
    expect(pct(1, 0)).toBeNull();
    expect(deltaPct(5, 0)).toBeNull();
    expect(deltaPct(30, 20)).toBe(50);
  });

  it('a kill-switch is the first thing on the list', () => {
    const out = buildInsights({
      ...empty,
      usage: usage(),
      ceilings: [{ kind: 'photo', date: '', used: 1, limit: 100, killed: true, killedReason: 'key leaked', ratio: 0.01 }],
    });
    expect(out[0].level).toBe('bad');
    expect(out[0].title).toContain('photo');
    expect(out[0].detail).toContain('key leaked');
  });

  it('stickiness is graded against the 20% / 10% bars', () => {
    expect(buildInsights({ ...empty, usage: usage({ dau: 10, mau: 40 }) })[0]).toMatchObject({ level: 'good' });
    expect(buildInsights({ ...empty, usage: usage({ dau: 5, mau: 40, wauPrior: null }) })[0]).toMatchObject({ level: 'watch' });
    expect(buildInsights({ ...empty, usage: usage({ dau: 2, mau: 40, wauPrior: null }) })[0]).toMatchObject({ level: 'bad' });
  });

  it('stickiness is not judged on a tiny MAU', () => {
    const out = buildInsights({ ...empty, usage: usage({ dau: 1, mau: 5, wauPrior: null, platformTotals: {} }) });
    expect(out.find((i) => i.title.startsWith('Stickiness'))).toBeUndefined();
  });

  it('pooled retention sums across cohorts and reads the activated table', () => {
    const r = pooledRetention({
      windowDays: 120, activationThreshold: 3, usersExamined: 10, excludedSynthetic: 0, truncated: false,
      activatedTotal: 4, logsPerActivatedUserPerDay: 1.5, insufficientSample: true,
      cohorts: [
        { week: '2026-W30', size: 5, activated: 2, retained: {}, retainedActivated: { d7: { retained: 1, eligible: 2 } } },
        { week: '2026-W31', size: 5, activated: 2, retained: {}, retainedActivated: { d7: { retained: 2, eligible: 2 } } },
      ],
    }, 'd7');
    expect(r).toEqual({ rate: 75, retained: 3, eligible: 4 });
  });

  it('a stale heartbeat is bad, a fresh one says nothing', () => {
    expect(buildInsights({ ...empty, heartbeatAgeMin: 60 })[0].level).toBe('bad');
    expect(buildInsights({ ...empty, heartbeatAgeMin: 10 })).toEqual([]);
  });

  it('sumEvent windows the tail of the series', () => {
    const u = usage({ daily: [
      { day: 'a', activeUsers: 1, platforms: {}, events: { photo_scan: 2 } },
      { day: 'b', activeUsers: 1, platforms: {}, events: { photo_scan: 3 } },
    ] });
    expect(sumEvent(u, 'photo_scan')).toBe(5);
    expect(sumEvent(u, 'photo_scan', 1)).toBe(3);
    expect(sumEvent(null, 'photo_scan')).toBe(0);
  });
});
