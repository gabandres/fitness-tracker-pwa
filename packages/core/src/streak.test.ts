import { describe, it, expect } from 'vitest';
import { computeStreak } from './streak';
import type { DailyLog } from './types';

const TODAY = new Date(2026, 5, 30, 12); // 2026-06-30 local noon
function logOn(daysAgo: number): DailyLog {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - daysAgo);
  return { calories: 500, date: d };
}

describe('computeStreak', () => {
  it('counts consecutive days ending today', () => {
    const logs = [logOn(0), logOn(1), logOn(2)];
    expect(computeStreak(logs, { today: TODAY }).streak).toBe(3);
  });

  it('still counts when today is missing but yesterday logged', () => {
    const logs = [logOn(1), logOn(2)];
    expect(computeStreak(logs, { today: TODAY }).streak).toBe(2);
  });

  it('is 0 when both today and yesterday are missing', () => {
    expect(computeStreak([logOn(3), logOn(4)], { today: TODAY }).streak).toBe(0);
  });

  it('breaks on a gap when freezeMaxGap is 0', () => {
    // today, yesterday, then a gap, then day-3 → streak 2.
    const logs = [logOn(0), logOn(1), logOn(3)];
    expect(computeStreak(logs, { today: TODAY }).streak).toBe(2);
  });

  it('forgives a gap within freezeMaxGap and flags freezeUsed', () => {
    const logs = [logOn(0), logOn(1), logOn(3)];
    const r = computeStreak(logs, { today: TODAY, freezeMaxGap: 1 });
    expect(r.streak).toBe(3);
    expect(r.freezeUsed).toBe(true);
  });

  it('returns 0 for no logs', () => {
    expect(computeStreak([], { today: TODAY }).streak).toBe(0);
  });
});
