import { describe, expect, it } from 'vitest';
import { calculateTdee } from './tdee';
import type { DailyLog, ProfileFields } from './types';

const baseProfile: ProfileFields = {
  heightIn: 70,
  age: 30,
  sex: 'male',
  activityLevel: 'moderate',
  targetPaceLbsPerWeek: 1.0,
};

function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return { calories, date: d, weight };
}

describe('calculateTdee', () => {
  it('returns the seed when there is no profile and no data', () => {
    const r = calculateTdee([], null);
    expect(r.source).toBe('seed');
    expect(r.newDailyTarget).toBe(1800);
  });

  it('uses Mifflin-St Jeor formula mode with a profile and <14 days', () => {
    const r = calculateTdee([log(0, 2000, 180)], baseProfile);
    expect(r.source).toBe('formula');
    // BMR = 10*81.65 + 6.25*177.8 - 5*30 + 5 = 1782; ×1.55 ≈ 2762
    expect(r.trueTdee).toBeGreaterThan(2600);
    expect(r.trueTdee).toBeLessThan(2900);
    // target = trueTdee - (1.0 * 3500/7=500)
    expect(r.newDailyTarget).toBe(r.trueTdee - 500);
  });

  it('clamps the daily target at the 1500 floor', () => {
    const tiny: ProfileFields = { ...baseProfile, heightIn: 48, age: 90, targetPaceLbsPerWeek: 2 };
    const r = calculateTdee([log(0, 1200, 100)], tiny);
    expect(r.newDailyTarget).toBeGreaterThanOrEqual(1500);
  });

  it('switches to measured mode with >=14 logged days and a weight trend', () => {
    // 20 days, intake ~2000, losing 0.1 lb/day (real deficit).
    const logs: DailyLog[] = [];
    for (let i = 19; i >= 0; i--) {
      logs.push(log(i, 2000, 185 - (19 - i) * 0.1));
    }
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    // TDEE ≈ intake + deficit(0.1 lb/day * 3500) = 2000 + 350 = ~2350
    expect(r.trueTdee).toBeGreaterThan(2250);
    expect(r.trueTdee).toBeLessThan(2450);
    expect(r.reliable).toBe(true);
  });
});
