import { describe, expect, it } from 'vitest';
import { macroEnergyMismatch } from './macro-energy-check';

describe('macroEnergyMismatch', () => {
  it('flags the measured case: 240 kcal against P16/C40/F20', () => {
    const m = macroEnergyMismatch({ kcal: 240, protein: 16, carbs: 40, fat: 20 });
    expect(m).toEqual({ estimateKcal: 404, ratio: 240 / 404 });
  });

  it('passes an entry whose numbers agree within the band', () => {
    expect(macroEnergyMismatch({ kcal: 240, protein: 3, carbs: 25, fat: 15 })).toBeNull();
  });

  it('never flags a partial log — protein alone has nothing to reconcile', () => {
    expect(macroEnergyMismatch({ kcal: 500, protein: 45 })).toBeNull();
    expect(macroEnergyMismatch({ kcal: 500, protein: 45, carbs: 10 })).toBeNull();
  });

  it('stays quiet with no calories yet, or all-zero macros', () => {
    expect(macroEnergyMismatch({ kcal: undefined, protein: 1, carbs: 1, fat: 1 })).toBeNull();
    expect(macroEnergyMismatch({ kcal: 0, protein: 1, carbs: 1, fat: 1 })).toBeNull();
    expect(macroEnergyMismatch({ kcal: 120, protein: 0, carbs: 0, fat: 0 })).toBeNull();
  });

  it('flags energy far above the macros too', () => {
    expect(macroEnergyMismatch({ kcal: 900, protein: 10, carbs: 10, fat: 10 })).not.toBeNull();
  });
});
