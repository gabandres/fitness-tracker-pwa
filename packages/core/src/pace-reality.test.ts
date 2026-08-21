import { describe, expect, it } from 'vitest';
import type { DailyLog, ProfileFields } from './types';
import { calculateTdee, type TdeeResult } from './tdee';
import { paceReality } from './pace-reality';
import { measuredTdeeFixture as measured } from './tdee.test-utils';


describe('paceReality', () => {
  it('reports the pace a binding floor actually leaves — the measured owner case', () => {
    // maintenance 1,870 · pace 0.9 lb/wk wants 1,420 · floor 1,850 wins.
    // The surviving deficit is 20 kcal/day = 0.04 lb/wk.
    expect(paceReality(measured(), 0.9, { calorieFloor: 1850 })).toEqual({
      requestedPace: 0.9,
      effectivePace: 0.04,
      target: 1850,
      floor: 1850,
      maintenance: 1870,
      floorBinding: true,
    });
  });

  it('leaves an unobstructed pace alone', () => {
    const r = paceReality(measured({ trueTdee: 2400 }), 0.5, { calorieFloor: 1500 });
    expect(r).toMatchObject({ requestedPace: 0.5, effectivePace: 0.5, target: 2150 });
    expect(r?.floorBinding).toBe(false);
  });

  it('agrees with calculateTdee: the target it derives IS newDailyTarget', () => {
    // The whole module is only trustworthy if it re-derives the same number the
    // app holds the user to. Run it against a real measured result rather than
    // a hand-built one.
    const profile: ProfileFields = {
      heightIn: 70,
      age: 34,
      sex: 'male',
      activityLevel: 'moderate',
      targetPaceLbsPerWeek: 0.9,
      calorieFloor: 1850,
    } as ProfileFields;
    const logs: DailyLog[] = Array.from({ length: 21 }, (_, i) => ({
      date: new Date(2026, 6, 1 + i),
      calories: 1900,
      protein: 150,
      weight: 182 - i * 0.05,
    }));
    const tdee = calculateTdee(logs, profile);
    expect(tdee.source).toBe('measured');

    const r = paceReality(tdee, profile.targetPaceLbsPerWeek, profile);
    expect(r?.target).toBe(tdee.newDailyTarget);
  });

  it('does not flag a floor that costs less than the displayed precision', () => {
    // 2,000 − 250 = 1,750 unclamped, floor 1,751. Technically binding, worth
    // 0.002 lb/wk, and both numbers render as "0.5". Saying "your floor holds
    // this to 0.50 lb/wk" when 0.5 was asked for reads as a bug, not a warning.
    const r = paceReality(measured({ trueTdee: 2000 }), 0.5, { calorieFloor: 1751 });
    expect(r?.effectivePace).toBe(0.5);
    expect(r?.floorBinding).toBe(false);
  });

  it('reports a floor at or above maintenance as a non-deficit, not as zero', () => {
    // A floor above the burn is a surplus. Clamping this to 0 would hide the
    // more alarming half of the same misconfiguration.
    const r = paceReality(measured({ trueTdee: 1700 }), 0, { calorieFloor: 1850 });
    expect(r).toMatchObject({ requestedPace: 0, target: 1850, floorBinding: true });
    expect(r?.effectivePace).toBeLessThan(0);
  });

  it('falls back to the built-in floor when the profile sets none', () => {
    // MIN_DAILY_TARGET is 1,500 and comes from calorieFloor(), not from a
    // second copy of the rule here.
    expect(paceReality(measured({ trueTdee: 1870 }), 2, null)).toMatchObject({
      floor: 1500,
      target: 1500,
      floorBinding: true,
    });
  });

  it('reports formula mode — the clamp is identical there', () => {
    // A real formula literal, not a measured fixture with `source` overridden:
    // the union rejects that now, correctly — a formula estimate observed
    // nothing and cannot carry window/reliability evidence.
    const formula: TdeeResult = {
      trueTdee: 2100,
      newDailyTarget: 1350,
      weightChangeTrend: 0,
      source: 'formula',
    };
    const r = paceReality(formula, 1.5, { calorieFloor: 1800 });
    expect(r).toMatchObject({ target: 1800, floorBinding: true });
    expect(r?.effectivePace).toBe(0.6);
  });

  it('is null for the seed fallback — its target is not derived from pace at all', () => {
    expect(
      paceReality(
        { trueTdee: 2450, newDailyTarget: 1800, weightChangeTrend: 0, source: 'seed' },
        0.9,
        { calorieFloor: 1850 },
      ),
    ).toBeNull();
  });

  it('is null for a nonsense maintenance figure or a nonsense pace', () => {
    expect(paceReality(measured({ trueTdee: 0 }), 0.9, null)).toBeNull();
    expect(paceReality(measured(), Number.NaN, null)).toBeNull();
    expect(paceReality(measured(), -1, null)).toBeNull();
  });
});
