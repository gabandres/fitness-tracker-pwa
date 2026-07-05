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

  it('honors a configured calorieFloor above the 1500 default (formula mode)', () => {
    // Small person + aggressive pace would land the target below 1850.
    const tiny: ProfileFields = {
      ...baseProfile, heightIn: 60, age: 60, sex: 'female',
      activityLevel: 'sedentary', targetPaceLbsPerWeek: 2, calorieFloor: 1850,
    };
    const r = calculateTdee([log(0, 1400, 120)], tiny);
    expect(r.newDailyTarget).toBe(1850);
  });

  it('ignores an unset / non-positive calorieFloor (falls back to 1500)', () => {
    const tiny: ProfileFields = {
      ...baseProfile, heightIn: 48, age: 90, targetPaceLbsPerWeek: 2, calorieFloor: 0,
    };
    const r = calculateTdee([log(0, 1200, 100)], tiny);
    expect(r.newDailyTarget).toBeGreaterThanOrEqual(1500);
  });

  it('applies calorieFloor in measured mode', () => {
    // 16 days losing fast on low intake → raw target below the floor.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 16; i++) logs.push(log(16 - i, 1500, 150 - i * 0.3));
    const withFloor = calculateTdee(logs, { ...baseProfile, targetPaceLbsPerWeek: 2, calorieFloor: 1850 });
    const without = calculateTdee(logs, { ...baseProfile, targetPaceLbsPerWeek: 2 });
    expect(withFloor.source).toBe('measured');
    expect(withFloor.newDailyTarget).toBeGreaterThanOrEqual(1850);
    // The floor only ever raises (never lowers) the target vs the 1500 default.
    expect(withFloor.newDailyTarget).toBeGreaterThanOrEqual(without.newDailyTarget);
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

  it('excludes logged-but-zero-kcal (weigh-in-only) days from the intake average', () => {
    // 15 flat-weight days: 2 weigh-in-only (0 kcal) + 13 at 2000 kcal. If the
    // zeros were averaged in, intake would crater toward ~1733; excluded, the
    // measured TDEE stays near 2000 (flat weight ⇒ ~0 deficit).
    const logs: DailyLog[] = [];
    for (let i = 0; i < 15; i++) logs.push(log(15 - i, i < 2 ? 0 : 2000, 180));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    expect(r.trueTdee).toBeGreaterThan(1950);
  });

  it('falls back to seed when every intake day is zero', () => {
    const logs: DailyLog[] = [];
    for (let i = 0; i < 15; i++) logs.push(log(15 - i, 0, 180));
    expect(calculateTdee(logs, baseProfile).source).toBe('seed');
  });

  it('flags low completeness (and not reliable) for a gappy window', () => {
    // 14 weigh-ins every OTHER day → spans ~27 calendar days → ~50% complete.
    const logs: DailyLog[] = [];
    for (let i = 0; i < 14; i++) logs.push(log(27 - i * 2, 2000, 185 - i * 0.1));
    const r = calculateTdee(logs, baseProfile);
    expect(r.source).toBe('measured');
    expect(r.loggingCompletenessPct).toBeGreaterThanOrEqual(45);
    expect(r.loggingCompletenessPct).toBeLessThanOrEqual(55);
    expect(r.reliable).toBe(false);
  });
});
