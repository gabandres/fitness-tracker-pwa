import { describe, expect, it } from 'vitest';
import { canSwap, overTimeCap, swapToAlternative, timeCapOf, carryoverOf } from './row-options';
import type { SessionExercise } from './workout';

const pulldown: SessionExercise = {
  exerciseId: 'pd', name: 'Lat Pulldown', cues: ['wide'], targetLoad: 81.57, loadUnit: 'kg', awayGym: 'Haven Gym',
  supersetGroup: 'B', pairPosition: 1, recommendation: { action: 'hold' },
  sets: [{ kind: 'activation', weight: 81.57, unit: 'kg' }, { kind: 'mini', weight: 81.57, unit: 'kg' }],
  alternatives: [{
    exerciseId: 'row', name: 'One-arm DB Row', targetLoad: 35.27,
    plannedSets: [{ kind: 'activation', group: 1, label: 'L' }, { kind: 'mini', group: 1 }, { kind: 'activation', group: 2, label: 'R' }, { kind: 'mini', group: 2 }],
  }],
};

describe('swapToAlternative', () => {
  it('takes the alternative\'s id and sets, keeps place and unit, drops the old call', () => {
    const out = swapToAlternative(pulldown, pulldown.alternatives![0], true);
    expect(out).toMatchObject({ exerciseId: 'row', name: 'One-arm DB Row', supersetGroup: 'B', pairPosition: 1, awayGym: 'Haven Gym', loadUnit: 'kg', calibration: true });
    expect(out.recommendation).toBeUndefined();
    expect(out.sets.map((s) => [s.kind, s.label, s.weight, s.unit])).toEqual([
      ['activation', 'L', 35.27, 'kg'], ['mini', undefined, 35.27, 'kg'], ['activation', 'R', 35.27, 'kg'], ['mini', undefined, 35.27, 'kg'],
    ]);
    expect(out.alternatives?.[0]).toMatchObject({ exerciseId: 'pd', name: 'Lat Pulldown' });
  });
  it('swaps back', () => {
    const there = swapToAlternative(pulldown, pulldown.alternatives![0], true);
    const back = swapToAlternative(there, there.alternatives![0], false);
    expect(back.exerciseId).toBe('pd');
    expect(back.sets).toHaveLength(2);
    expect(back.alternatives?.[0].exerciseId).toBe('row');
  });
  it('only while nothing is ticked', () => {
    expect(canSwap(pulldown)).toBe(true);
    expect(canSwap({ ...pulldown, sets: [{ kind: 'activation', done: true }] })).toBe(false);
  });
});

describe('timeCap / carryover', () => {
  it('parses and trips past the minutes', () => {
    const cap = timeCapOf({ minutes: 65, drop: ['3rd lateral', '2nd rear delt', 'leg curl'] });
    expect(overTimeCap(cap, 65)).toBe(false);
    expect(overTimeCap(cap, 66)).toBe(true);
    expect(timeCapOf({ minutes: 65, drop: [] })).toBeNull();
  });
  it('carryover needs a date and a count', () => {
    expect(carryoverOf({ from: '2026-11-04', clusters: 1 })).toEqual({ from: '2026-11-04', clusters: 1 });
    expect(carryoverOf({ from: '11/4', clusters: 1 })).toBeNull();
  });
});
