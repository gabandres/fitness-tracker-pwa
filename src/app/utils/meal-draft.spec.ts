import {
  MEAL_DRAFT_ERROR_MESSAGE_KEYS,
  defaultMealTypeForHour,
  parseMealDraft,
  parseNumericInput,
} from './meal-draft';

describe('parseNumericInput', () => {
  it('coerces blank / whitespace / non-numeric to null', () => {
    expect(parseNumericInput('')).toBeNull();
    expect(parseNumericInput('   ')).toBeNull();
    expect(parseNumericInput('abc')).toBeNull();
    expect(parseNumericInput(null)).toBeNull();
    expect(parseNumericInput(undefined)).toBeNull();
  });

  it('coerces non-finite values to null', () => {
    expect(parseNumericInput(NaN)).toBeNull();
    expect(parseNumericInput(Infinity)).toBeNull();
    expect(parseNumericInput('1e999')).toBeNull(); // Number("1e999") === Infinity
  });

  it('parses numeric strings and numbers, including zero and negatives', () => {
    expect(parseNumericInput('12')).toBe(12);
    expect(parseNumericInput('12.5')).toBe(12.5);
    expect(parseNumericInput(' 40 ')).toBe(40);
    expect(parseNumericInput(0)).toBe(0);
    expect(parseNumericInput('0')).toBe(0);
    expect(parseNumericInput(180)).toBe(180);
    expect(parseNumericInput('-5')).toBe(-5);
  });
});

describe('parseMealDraft', () => {
  const ok = (raw: Parameters<typeof parseMealDraft>[0]) => {
    const r = parseMealDraft(raw);
    if (!r.ok) throw new Error(`expected ok draft, got error ${r.error}`);
    return r.draft;
  };

  describe('calories rule', () => {
    it('errors when calories are missing or unparseable', () => {
      for (const bad of [null, undefined, '', '   ', 'abc', NaN, Infinity] as const) {
        const r = parseMealDraft({ calories: bad });
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toBe('calories-required');
      }
    });

    it('accepts calories as a string or a number', () => {
      expect(ok({ calories: '500' }).entry.calories).toBe(500);
      expect(ok({ calories: 500 }).entry.calories).toBe(500);
      expect(ok({ calories: 0 }).entry.calories).toBe(0);
    });

    it('maps the error to an i18n key', () => {
      expect(MEAL_DRAFT_ERROR_MESSAGE_KEYS['calories-required']).toBe(
        'entry.errorCaloriesRequired',
      );
    });
  });

  describe('protein', () => {
    it('includes protein when valid', () => {
      const d = ok({ calories: 500, protein: '30' });
      expect(d.entry.protein).toBe(30);
      expect(d.protein).toBe(30);
    });

    it('drops protein when blank or invalid (never blocks the save)', () => {
      for (const p of ['', '  ', 'abc', null, undefined, NaN] as const) {
        const d = ok({ calories: 500, protein: p });
        expect('protein' in d.entry).toBe(false);
        expect(d.protein).toBeUndefined();
      }
    });
  });

  describe('carbs + fat', () => {
    it('includes carbs/fat when valid', () => {
      const d = ok({ calories: 500, carbs: '45', fat: 18 });
      expect(d.entry.carbs).toBe(45);
      expect(d.entry.fat).toBe(18);
      expect(d.carbs).toBe(45);
      expect(d.fat).toBe(18);
    });

    it('drops carbs/fat when blank or invalid (never blocks the save)', () => {
      for (const v of ['', '  ', 'abc', null, undefined, NaN] as const) {
        const d = ok({ calories: 500, carbs: v, fat: v });
        expect('carbs' in d.entry).toBe(false);
        expect('fat' in d.entry).toBe(false);
        expect(d.carbs).toBeUndefined();
        expect(d.fat).toBeUndefined();
      }
    });
  });

  describe('exercise', () => {
    it('reflects the exercise flag as a strict boolean', () => {
      expect(ok({ calories: 500, exerciseCompleted: true }).entry.exerciseCompleted).toBe(true);
      expect(ok({ calories: 500, exerciseCompleted: false }).entry.exerciseCompleted).toBe(false);
      expect(ok({ calories: 500 }).entry.exerciseCompleted).toBe(false);
    });
  });

  describe('label resolution', () => {
    it('prefers the typed label, trimmed', () => {
      const d = ok({ calories: 500, mealLabel: '  Oatmeal  ', activePresetName: 'Preset' });
      expect(d.entry.mealLabel).toBe('Oatmeal');
      expect(d.label).toBe('Oatmeal');
    });

    it('falls back to the active preset name when nothing is typed', () => {
      expect(ok({ calories: 500, mealLabel: '   ', activePresetName: 'Eggs' }).entry.mealLabel).toBe('Eggs');
      expect(ok({ calories: 500, activePresetName: 'Eggs' }).entry.mealLabel).toBe('Eggs');
    });

    it('omits the label when neither is present', () => {
      const d = ok({ calories: 500 });
      expect('mealLabel' in d.entry).toBe(false);
      expect(d.label).toBeUndefined();
    });
  });

  describe('meal type', () => {
    it('carries a known slot onto the entry', () => {
      expect(ok({ calories: 500, mealType: 'breakfast' }).entry.mealType).toBe('breakfast');
      expect(ok({ calories: 500, mealType: 'snack' }).entry.mealType).toBe('snack');
    });

    it('drops unknown / null slots (entry lands in the "other" bucket)', () => {
      expect('mealType' in ok({ calories: 500, mealType: 'brunch' }).entry).toBe(false);
      expect('mealType' in ok({ calories: 500, mealType: null }).entry).toBe(false);
      expect('mealType' in ok({ calories: 500 }).entry).toBe(false);
    });
  });

  describe('timestamp from date key', () => {
    it('stamps local noon for a YYYY-MM-DD key', () => {
      const ts = ok({ calories: 500, dateKey: '2026-04-22' }).entry.timestamp!;
      expect(ts).toBeInstanceOf(Date);
      expect(ts.getFullYear()).toBe(2026);
      expect(ts.getMonth()).toBe(3); // April, 0-indexed
      expect(ts.getDate()).toBe(22);
      expect(ts.getHours()).toBe(12);
    });

    it('omits the timestamp when no date key is given (ledger stamps now)', () => {
      expect('timestamp' in ok({ calories: 500 }).entry).toBe(false);
      expect('timestamp' in ok({ calories: 500, dateKey: null }).entry).toBe(false);
    });

    it('omits the timestamp for a malformed date key rather than an Invalid Date', () => {
      expect('timestamp' in ok({ calories: 500, dateKey: 'garbage' }).entry).toBe(false);
      expect('timestamp' in ok({ calories: 500, dateKey: '2026-00-01' }).entry).toBe(false);
    });
  });
});

describe('defaultMealTypeForHour', () => {
  it('maps wall-clock hours to slots with snack in the gaps', () => {
    expect(defaultMealTypeForHour(7)).toBe('breakfast');
    expect(defaultMealTypeForHour(10)).toBe('breakfast');
    expect(defaultMealTypeForHour(11)).toBe('lunch');
    expect(defaultMealTypeForHour(14)).toBe('lunch');
    expect(defaultMealTypeForHour(15)).toBe('snack'); // afternoon gap
    expect(defaultMealTypeForHour(17)).toBe('dinner');
    expect(defaultMealTypeForHour(21)).toBe('dinner');
    expect(defaultMealTypeForHour(23)).toBe('snack'); // late night
    expect(defaultMealTypeForHour(2)).toBe('snack');  // pre-dawn
  });
});
