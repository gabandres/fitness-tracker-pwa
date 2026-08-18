import { describe, it, expect } from 'vitest';
import { buildMealPreset, PRESET_LIMITS } from './meal-preset';

describe('buildMealPreset', () => {
  it('keeps an ordinary preset intact', () => {
    expect(buildMealPreset({ name: '  Overnight oats ', calories: 420, protein: 18.44 })).toEqual({
      name: 'Overnight oats',
      calories: 420,
      protein: 18.4,
    });
  });

  it('omits absent macros rather than writing fake zeros', () => {
    const out = buildMealPreset({ name: 'Black coffee', calories: 5 });
    expect('protein' in out).toBe(false);
    expect('carbs' in out).toBe(false);
    expect('fat' in out).toBe(false);
  });

  it('keeps a real zero macro', () => {
    expect(buildMealPreset({ name: 'Egg white', calories: 25, fat: 0 }).fat).toBe(0);
  });

  // The production bug (Sentry IGNIA-MOBILE-9): the entry sheet hand-built this
  // payload, Firestore rejected it with permission-denied, and the row vanished.
  it('clamps into the isValidPreset bounds so the write cannot be rejected', () => {
    const out = buildMealPreset({
      name: 'x'.repeat(240),
      calories: 999_999,
      protein: 5_000,
      carbs: -12,
      fat: 4_321,
    });
    expect(out.name.length).toBe(PRESET_LIMITS.nameChars);
    expect(out.calories).toBe(PRESET_LIMITS.maxCalories);
    expect(out.protein).toBe(PRESET_LIMITS.maxMacro);
    expect(out.carbs).toBe(0); // clamped up from negative
    expect(out.fat).toBe(PRESET_LIMITS.maxMacro);
  });

  it('drops a non-finite macro instead of coercing it', () => {
    const out = buildMealPreset({ name: 'n', calories: 100, protein: NaN, carbs: Infinity });
    expect('protein' in out).toBe(false);
    expect('carbs' in out).toBe(false);
  });

  it('falls back to 0 calories when calories are non-finite', () => {
    expect(buildMealPreset({ name: 'n', calories: NaN }).calories).toBe(0);
  });
});
