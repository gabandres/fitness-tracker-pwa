import { describe, expect, it } from 'vitest';
import { currentWeight, dailyTargets } from './targets';
import { computeProtein } from './macro-heuristic';
import type { DailyLog, Profile } from './types';

function profile(p: Partial<Profile> = {}): Profile {
  return {
    email: 't@t.com',
    createdAt: new Date(0),
    lastSeenAt: new Date(0),
    profileCompleted: true,
    ...p,
  };
}

function log(daysAgo: number, calories: number, weight?: number): DailyLog {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - daysAgo);
  return { calories, date: d, weight };
}

describe('currentWeight', () => {
  it('prefers the latest daily weight over log weights', () => {
    expect(currentWeight([log(0, 500, 200)], { '2026-06-29': 180 })).toBe(180);
  });
  it('falls back to the latest log weight when no daily weights', () => {
    expect(currentWeight([log(2, 500, 190), log(0, 500, 188)], {})).toBe(188);
  });
  it('returns null with no weight anywhere', () => {
    expect(currentWeight([log(0, 500)], {})).toBeNull();
  });
});

describe('dailyTargets', () => {
  it('uses the manual calorie target when present (pre-data)', () => {
    const t = dailyTargets(profile({ manualCaloriesTarget: 2100 }), [log(0, 500)], {});
    expect(t.calorieTarget).toBe(2100);
  });

  it('falls back to the TDEE seed target with no profile', () => {
    const t = dailyTargets(null, [], {});
    expect(t.calorieTarget).toBe(1800);
    expect(t.tdee.source).toBe('seed');
  });

  it('derives protein live from proteinPerKg + current weight', () => {
    const t = dailyTargets(profile({ proteinPerKg: 2.0 }), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(computeProtein(180, 2.0));
  });

  it('uses the manual protein snapshot when no perKg basis', () => {
    const t = dailyTargets(profile({ manualProteinTarget: 150 }), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(150);
  });

  it('defaults protein to the 1.6 g/kg floor off current weight', () => {
    const t = dailyTargets(profile(), [], { '2026-06-29': 180 });
    expect(t.proteinTarget).toBe(computeProtein(180));
  });
});
