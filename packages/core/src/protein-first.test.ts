import { describe, expect, it } from 'vitest';
import { homePlanOf, nutritionWindowToday } from './home-plan';
import { calorieRangeState, proteinFirstForDay, proteinFirstView, proteinState } from './protein-first';

// 2026-11-20: protein-first mode. Two triggers (a dated plan window, the
// profile's setting), one view; presentation only.

const base = { window: null, enabled: false, calorieTarget: 1850, proteinTarget: 140, calorieFloor: 1500, proteinMin: 110 };

describe('proteinFirstView', () => {
  it('is off without the setting and without a window', () => {
    expect(proteinFirstView(base)).toBeNull();
  });

  it('with the setting: calories run from the safety minimum to the target, protein floor is the 1.6 g/kg minimum', () => {
    expect(proteinFirstView({ ...base, enabled: true })).toEqual({
      source: 'setting', proteinTarget: 140, proteinFloor: 110, kcalMin: 1500, kcalMax: 1850,
    });
  });

  it('collapses the range to one number when the minimum has reached the target', () => {
    const v = proteinFirstView({ ...base, enabled: true, calorieFloor: 1850 })!;
    expect([v.kcalMin, v.kcalMax]).toEqual([1850, 1850]);
    expect(proteinFirstView({ ...base, enabled: true, calorieFloor: 2000 })!.kcalMin).toBe(1850);
  });

  it('shows no protein floor that is not below the target', () => {
    expect(proteinFirstView({ ...base, enabled: true, proteinMin: 140 })!.proteinFloor).toBeNull();
    expect(proteinFirstView({ ...base, enabled: true, proteinMin: null })!.proteinFloor).toBeNull();
  });

  it('is null until the targets are known', () => {
    expect(proteinFirstView({ ...base, enabled: true, proteinTarget: 0 })).toBeNull();
    expect(proteinFirstView({ ...base, enabled: true, calorieTarget: 0 })).toBeNull();
  });

  it('a plan window wins over the setting and brings its own numbers', () => {
    const window = { from: '2026-11-28', to: '2026-12-06', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'away' };
    expect(proteinFirstView({ ...base, enabled: true, window })).toEqual({
      source: 'plan', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'away',
    });
  });

  it('a window with no protein target takes the profile one', () => {
    const v = proteinFirstView({ ...base, window: { from: '2026-11-28', to: '2026-11-28', kcalMin: 1800, kcalMax: 2000 } })!;
    expect(v.proteinTarget).toBe(140);
    expect(v.proteinFloor).toBeNull();
  });
});

describe('calorieRangeState and proteinState', () => {
  const view = { kcalMin: 1850, kcalMax: 2150, proteinTarget: 140, proteinFloor: 120 };

  it('places calories below, inside (both ends included) or above the range', () => {
    expect(calorieRangeState(1849, view)).toBe('below');
    expect(calorieRangeState(1850, view)).toBe('in');
    expect(calorieRangeState(2150, view)).toBe('in');
    expect(calorieRangeState(2151, view)).toBe('above');
  });

  it('places protein under the floor, past it, or at the target', () => {
    expect(proteinState(119, view)).toBe('under-floor');
    expect(proteinState(120, view)).toBe('floor');
    expect(proteinState(140, view)).toBe('target');
    expect(proteinState(100, { proteinTarget: 140, proteinFloor: null })).toBe('under-floor');
  });
});

describe('homePlan.nutrition', () => {
  const plan = homePlanOf({
    homePlan: {
      nutrition: [
        { from: '2026-11-28', to: '2026-12-06', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'Protein first while away.' },
        { from: '2026-12-10', to: '2026-12-09', kcalMin: 1800, kcalMax: 2000 }, // ends before it starts
        { from: '2026-12-20', to: '2026-12-21', kcalMin: 2200, kcalMax: 2000 }, // range upside down
        { from: '2026-12-22', to: '2026-12-23', kcalMin: 1800, kcalMax: 2000, proteinTarget: 100, proteinFloor: 130 }, // floor over target
      ],
    },
  });

  it('keeps well-formed windows and drops malformed ones', () => {
    expect(plan?.nutrition).toHaveLength(2);
    expect(plan!.nutrition![0]).toEqual({ from: '2026-11-28', to: '2026-12-06', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'Protein first while away.' });
    // A floor above the target is dropped, the window kept.
    expect(plan!.nutrition![1]).toEqual({ from: '2026-12-22', to: '2026-12-23', kcalMin: 1800, kcalMax: 2000, proteinTarget: 100 });
  });

  it('finds the window covering a day, both ends included', () => {
    expect(nutritionWindowToday(plan, '2026-11-27')).toBeNull();
    expect(nutritionWindowToday(plan, '2026-11-28')?.kcalMax).toBe(2150);
    expect(nutritionWindowToday(plan, '2026-12-06')?.kcalMin).toBe(1850);
    expect(nutritionWindowToday(plan, '2026-12-07')).toBeNull();
    expect(nutritionWindowToday(null, '2026-11-28')).toBeNull();
  });
});

describe('proteinFirstForDay', () => {
  const targets = { calorieTarget: 1850, proteinTarget: 140, proteinMin: 110 };
  const plan = { homePlan: { nutrition: [{ from: '2026-11-28', to: '2026-12-06', proteinTarget: 150, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150 }] } };

  it('is off for a profile with neither trigger, and for no profile at all', () => {
    expect(proteinFirstForDay({}, '2026-11-20', targets)).toBeNull();
    expect(proteinFirstForDay(null, '2026-11-20', targets)).toBeNull();
    expect(proteinFirstForDay(undefined, '2026-11-20', targets)).toBeNull();
  });

  it('reads the Settings switch: the range runs from the safety minimum to the target', () => {
    expect(proteinFirstForDay({ proteinFirst: true, calorieFloor: 1500 }, '2026-11-20', targets)).toEqual({
      source: 'setting',
      proteinTarget: 140,
      proteinFloor: 110,
      kcalMin: 1500,
      kcalMax: 1850,
    });
  });

  it('reads a dated plan window on its days only, and it wins over the switch', () => {
    expect(proteinFirstForDay(plan, '2026-11-27', targets)).toBeNull();
    expect(proteinFirstForDay({ ...plan, proteinFirst: true }, '2026-11-28', targets)).toMatchObject({
      source: 'plan',
      proteinTarget: 150,
      proteinFloor: 120,
      kcalMin: 1850,
      kcalMax: 2150,
    });
    expect(proteinFirstForDay({ ...plan, proteinFirst: true }, '2026-12-07', targets)?.source).toBe('setting');
  });

  it('needs targets to say anything', () => {
    expect(proteinFirstForDay({ proteinFirst: true }, '2026-11-20', { calorieTarget: 0, proteinTarget: 0 })).toBeNull();
  });
});
