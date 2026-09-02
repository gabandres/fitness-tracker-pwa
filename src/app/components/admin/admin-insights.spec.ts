import { describe, expect, it } from 'vitest';
import { buildInsights, deltaPct, fmtSecs, methodRows, pct, pooledRetention, sumEvent, type InsightInputs, type RetentionSummary, type UsageSeries } from './admin-insights';

function retention(over: Partial<RetentionSummary> = {}): RetentionSummary {
  return {
    windowDays: 120, activationThreshold: 3, usersExamined: 10, excludedSynthetic: 0, truncated: false,
    activatedTotal: 4, logsPerActivatedUserPerDay: 1.5, insufficientSample: true, cohorts: [],
    ...over,
  };
}

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

  // ── Retention lever 3

  it('fmtSecs reads like a stopwatch', () => {
    expect(fmtSecs(null)).toBe('—');
    expect(fmtSecs(45)).toBe('45 s');
    expect(fmtSecs(104)).toBe('1 m 44 s');
    expect(fmtSecs(8280)).toBe('2.3 h');
    expect(fmtSecs(172800)).toBe('2.0 d');
  });

  it('seconds-per-log is graded at 30 s / 2 min and needs 20 timed logs', () => {
    const at = (secsPerLog: number, logsTimed = 25) => buildInsights({ ...empty, retention: retention({ secsPerLog, logsTimed }) }).find((i) => i.title.startsWith('A log takes'));
    expect(at(22)).toMatchObject({ level: 'good' });
    expect(at(75)).toMatchObject({ level: 'watch' });
    expect(at(150)).toMatchObject({ level: 'bad', title: 'A log takes 2 m 30 s on average' });
    expect(at(150, 5)).toBeUndefined();
  });

  it('time to first log reads the inside-five-minutes share, from five users up', () => {
    const at = (under5MinShare: number, n = 12) => buildInsights({
      ...empty,
      retention: retention({ timeToFirstLog: { n, medianSec: 104, p75Sec: 900, under5MinShare } }),
    }).find((i) => /first meal within 5 minutes/.test(i.title));
    expect(at(0.6)).toMatchObject({ level: 'good', title: '60% log their first meal within 5 minutes of signing up' });
    expect(at(0.25)?.level).toBe('watch');
    expect(at(0.25)?.detail).toContain('Median 1 m 44 s');
    expect(at(0.6, 3)).toBeUndefined();
  });

  it('the method split compares the best and worst D7 once two methods have n≥3', () => {
    const r = retention({
      byMethod: {
        photo: { users: 5, retainedActivated: { d7: { retained: 4, eligible: 5 } }, secsPerLog: 20, logsTimed: 30 },
        search: { users: 8, retainedActivated: { d7: { retained: 2, eligible: 8 } }, secsPerLog: 70, logsTimed: 40 },
        voice: { users: 1, retainedActivated: { d7: { retained: 1, eligible: 1 } }, secsPerLog: null, logsTimed: 0 },
        unknown: { users: 0, retainedActivated: { d7: { retained: 0, eligible: 0 } }, secsPerLog: null, logsTimed: 0 },
      },
    });
    // Rows: sorted by users, the empty bucket dropped.
    expect(methodRows(r).map((x) => x.method)).toEqual(['search', 'photo', 'voice']);
    const split = buildInsights({ ...empty, retention: r }).find((i) => i.level === 'info');
    expect(split?.title).toBe('Photo scan loggers retain 80% at D7 vs 25% for search / manual');
    // Voice (n=1) is in the rows but not in the comparison.
    expect(split?.detail).not.toContain('Voice');
  });

  it('a retention doc from before lever 3 produces no lever-3 insight', () => {
    expect(buildInsights({ ...empty, retention: retention() })).toEqual([]);
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
