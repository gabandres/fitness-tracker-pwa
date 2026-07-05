import { describe, expect, it } from 'vitest';
import {
  parseMealDraft,
  parseNumericInput,
  parseMealType,
  defaultMealTypeForHour,
} from './meal-draft';

describe('parseNumericInput', () => {
  it('coerces strings, numbers, and rejects blank / non-finite', () => {
    expect(parseNumericInput('250')).toBe(250);
    expect(parseNumericInput('  12.5 ')).toBe(12.5);
    expect(parseNumericInput(300)).toBe(300);
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('   ')).toBeNull();
    expect(parseNumericInput('abc')).toBeNull();
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput(Infinity)).toBeNull();
    expect(parseNumericInput(NaN)).toBeNull();
  });
});

describe('parseMealType', () => {
  it('narrows known slots, drops anything else', () => {
    expect(parseMealType('lunch')).toBe('lunch');
    expect(parseMealType('brunch')).toBeUndefined();
    expect(parseMealType(null)).toBeUndefined();
  });
});

describe('defaultMealTypeForHour', () => {
  it('maps wall-clock hour to a slot', () => {
    expect(defaultMealTypeForHour(8)).toBe('breakfast');
    expect(defaultMealTypeForHour(12)).toBe('lunch');
    expect(defaultMealTypeForHour(19)).toBe('dinner');
    expect(defaultMealTypeForHour(2)).toBe('snack');
  });
});

describe('parseMealDraft', () => {
  it('requires a parseable calorie number', () => {
    const r = parseMealDraft({ calories: '' });
    expect(r).toEqual({ ok: false, error: 'calories-required' });
  });

  it('rejects a zero-calorie row with no label and no macros', () => {
    const r = parseMealDraft({ calories: 0 });
    expect(r).toEqual({ ok: false, error: 'empty-entry' });
  });

  it('allows a labelled zero-calorie row (e.g. black coffee)', () => {
    const r = parseMealDraft({ calories: 0, mealLabel: 'black coffee' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.draft.entry).toMatchObject({ calories: 0, mealLabel: 'black coffee' });
  });

  it('builds an entry from mixed string / number fields, dropping blanks', () => {
    const r = parseMealDraft({ calories: '520', protein: '31', carbs: '', fat: 'x', mealLabel: 'chicken' });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.draft.entry).toMatchObject({ calories: 520, protein: 31, mealLabel: 'chicken' });
      expect(r.draft.entry.carbs).toBeUndefined();
      expect(r.draft.entry.fat).toBeUndefined();
    }
  });

  it('falls back to the preset name when no label was typed', () => {
    const r = parseMealDraft({ calories: 200, activePresetName: 'Quest bar' });
    if (r.ok) expect(r.draft.entry.mealLabel).toBe('Quest bar');
  });

  it('stamps local noon from a dateKey', () => {
    const r = parseMealDraft({ calories: 200, mealLabel: 'x', dateKey: '2026-07-05' });
    if (r.ok) {
      const ts = r.draft.entry.timestamp!;
      expect(ts.getHours()).toBe(12);
      expect(ts.getFullYear()).toBe(2026);
      expect(ts.getDate()).toBe(5);
    }
  });

  it('lets an explicit timestamp win over dateKey', () => {
    const explicit = new Date(2026, 0, 2, 9, 30, 0);
    const r = parseMealDraft({ calories: 200, mealLabel: 'x', dateKey: '2026-07-05', timestamp: explicit });
    if (r.ok) expect(r.draft.entry.timestamp).toBe(explicit);
  });
});
