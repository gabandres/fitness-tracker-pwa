import { describe, expect, it } from 'vitest';
import { buildWeeklyReportContext } from './weekly-report-prompt';
import { measuredTdeeFixture } from './tdee.test-utils';

// Core carries no Node types (dependency-free); reach TZ through globalThis.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

describe('weekly report window across DST', () => {
  it('lists 14 distinct consecutive days spanning a spring-forward change', () => {
    const prevTz = env.TZ;
    env.TZ = 'America/New_York';
    try {
      const ctx = buildWeeklyReportContext({
        now: new Date(2027, 2, 20, 12),
        logs: [],
        tdee: measuredTdeeFixture({ trueTdee: 2400, newDailyTarget: 1900, weightChangeTrend: 0 }),
        profile: null as never,
      } as never);
      const dates = ctx.days.map((d) => d.date);
      expect(new Set(dates).size).toBe(14);
      expect(dates[0]).toBe('2027-03-07');
      expect(dates[13]).toBe('2027-03-20');
    } finally {
      env.TZ = prevTz;
    }
  });
});
