import { describe, expect, it } from 'vitest';
import {
  bodyWeightUnit,
  formatBodyWeight,
  parseWeightToLb,
  toDisplayWeight,
  weightBoundsFor,
} from './body-weight-units';
import { checkWeightEntry } from './weight-bounds';

/**
 * UX_AUDIT F3. The rule under all of it: **the store is pounds and only the
 * seam knows otherwise.** These pin the round trip and the two failures that
 * would be invisible — a metric entry silently stored as pounds, and a bounds
 * message quoted in a unit the user does not use.
 */

describe('bodyWeightUnit', () => {
  it('defaults to pounds for a profile that never set one', () => {
    // `undefined` is every account predating the field; it must not become kg.
    expect(bodyWeightUnit(undefined)).toBe('lb');
    expect(bodyWeightUnit('us')).toBe('lb');
    expect(bodyWeightUnit('metric')).toBe('kg');
  });
});

describe('toDisplayWeight', () => {
  it('leaves pounds alone', () => {
    expect(toDisplayWeight(178.5, 'us')).toBe(178.5);
    expect(toDisplayWeight(178.5, undefined)).toBe(178.5);
  });

  it('converts to kilograms at one decimal', () => {
    expect(toDisplayWeight(180, 'metric')).toBe(81.6);
    expect(toDisplayWeight(150, 'metric')).toBe(68);
  });
});

describe('parseWeightToLb', () => {
  it('reads pounds as pounds', () => {
    expect(parseWeightToLb('180', 'us')).toBe(180);
  });

  it('reads kilograms as pounds', () => {
    // The whole defect in one line: typing 68 on a metric profile used to
    // build a plan for a 68 lb person.
    expect(parseWeightToLb('68', 'metric')).toBeCloseTo(149.9, 1);
  });

  it('accepts a comma decimal separator', () => {
    // es-PR keyboards produce `70,5`, and `Number('70,5')` is NaN — which
    // would have read as "invalid weight" for an ordinary number.
    expect(parseWeightToLb('70,5', 'metric')).toBeCloseTo(155.4, 1);
    expect(parseWeightToLb('180,4', 'us')).toBeCloseTo(180.4, 1);
  });

  it.each(['', '   ', 'abc', '0', '-5'])('returns null for %o', (input) => {
    expect(parseWeightToLb(input, 'us')).toBeNull();
  });

  it('round-trips through the display value', () => {
    for (const lb of [95, 150, 178.5, 240, 315]) {
      const shown = toDisplayWeight(lb, 'metric');
      expect(parseWeightToLb(String(shown), 'metric')).toBeCloseTo(lb, 0);
    }
  });
});

describe('weightBoundsFor', () => {
  it('quotes the US band unchanged', () => {
    expect(weightBoundsFor('us')).toEqual({ min: 50, max: 500 });
  });

  it('quotes a metric band a metric user can act on', () => {
    // 50–500 lb is 22.7–226.8 kg. Rounded INWARD so every number the message
    // names is genuinely accepted — quoting 22 would name a weight that is
    // then rejected.
    const { min, max } = weightBoundsFor('metric');
    expect(min).toBe(23);
    expect(max).toBe(226);
    expect(checkWeightEntry(parseWeightToLb(String(min), 'metric') as number).ok).toBe(true);
    expect(checkWeightEntry(parseWeightToLb(String(max), 'metric') as number).ok).toBe(true);
  });
});

describe('formatBodyWeight', () => {
  it('joins the number and its unit in one place', () => {
    expect(formatBodyWeight(178.5, 'us')).toBe('178.5 lb');
    expect(formatBodyWeight(180, 'metric')).toBe('81.6 kg');
  });
});
