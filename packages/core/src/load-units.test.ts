import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BAR_KG,
  DEFAULT_INCREMENT_KG,
  DEFAULT_INCREMENT_LB,
  barFor,
  defaultIncrement,
  formatLoad,
  loadUnit,
  parseLoadToLb,
  platesFor,
  toDisplayLoad,
} from './load-units';
import { computePlateLoad } from './plate-math';
import { generateWarmup } from './warmup';

/**
 * UX_AUDIT F3, second half: lifted loads. The rule is the same as body
 * weight — store pounds, convert at the seam — but the *reason* it needs its
 * own module is here in the plate tests: a metric gym has a different bar and
 * different plates, so solving in pounds and converting afterwards produces
 * numbers nobody can load.
 */

describe('loadUnit / defaults', () => {
  it('defaults to pounds for a profile that never chose', () => {
    expect(loadUnit(undefined)).toBe('lb');
    expect(loadUnit('us')).toBe('lb');
    expect(loadUnit('metric')).toBe('kg');
  });

  it('gives each unit its own bar', () => {
    expect(barFor('us')).toBe(45);
    expect(barFor('metric')).toBe(DEFAULT_BAR_KG);
    // 20 kg is 44.09 lb — a genuinely different bar, not 45 converted.
    expect(barFor('metric')).not.toBeCloseTo(toDisplayLoad(45, 'metric'), 1);
  });

  it('gives each unit its own step', () => {
    expect(defaultIncrement('us')).toBe(DEFAULT_INCREMENT_LB);
    expect(defaultIncrement('metric')).toBe(DEFAULT_INCREMENT_KG);
  });

  it('gives each unit its own plates', () => {
    expect(platesFor('us')).toContain(45);
    expect(platesFor('metric')).toContain(25);
    // The 1.25 kg plate has no pound equivalent on the rack.
    expect(platesFor('metric')).toContain(1.25);
    expect(platesFor('us')).not.toContain(1.25);
  });
});

describe('toDisplayLoad / parseLoadToLb', () => {
  it('round-trips a metric lifter their own number', () => {
    const stored = parseLoadToLb('100', 'metric') as number;
    expect(stored).toBeCloseTo(220.5, 1);
    expect(toDisplayLoad(stored, 'metric')).toBe(100);
  });

  it('leaves pounds alone', () => {
    expect(parseLoadToLb('225', 'us')).toBe(225);
    expect(toDisplayLoad(225, 'us')).toBe(225);
  });

  it('accepts a comma decimal separator', () => {
    expect(parseLoadToLb('2,5', 'metric')).toBeCloseTo(5.5, 1);
  });

  it('accepts zero — a bodyweight set logs a real 0 load', () => {
    // `parseWeightToLb` rejects 0 because nobody weighs nothing; a load of 0
    // is an ordinary pull-up. The two parsers differ here on purpose.
    expect(parseLoadToLb('0', 'us')).toBe(0);
  });

  it.each(['', '  ', 'abc', '-5'])('returns null for %o', (input) => {
    expect(parseLoadToLb(input, 'us')).toBeNull();
  });

  it('rounds aggregates to whole units', () => {
    // A weekly volume is a sum of estimates; "5,669.9 kg" is false precision.
    expect(toDisplayLoad(12500, 'metric', 0)).toBe(5670);
  });
});

describe('plate math is solved in the DISPLAY unit', () => {
  it('loads a 100 kg squat out of kg plates', () => {
    const load = computePlateLoad(100, barFor('metric'), platesFor('metric'))!;
    expect(load.bar).toBe(20);
    // 40 kg a side: 25 + 15.
    expect(load.perSide).toEqual([
      { plate: 25, count: 1 },
      { plate: 15, count: 1 },
    ]);
    expect(load.achievable).toBe(100);
    expect(load.remainder).toBe(0);
  });

  it('still loads 225 lb out of lb plates', () => {
    const load = computePlateLoad(225, barFor('us'), platesFor('us'))!;
    expect(load.bar).toBe(45);
    expect(load.perSide).toEqual([{ plate: 45, count: 2 }]);
    expect(load.achievable).toBe(225);
  });

  it('is why converting AFTER the solve would be wrong', () => {
    // Solve 225 lb in pounds and convert: 45 lb plates become 20.4 kg each —
    // a plate no gym owns. Solved natively, the same lifter's 102.1 kg is a
    // stack they can actually build.
    const inPounds = computePlateLoad(225, barFor('us'), platesFor('us'))!;
    const naivelyConverted = toDisplayLoad(inPounds.perSide[0].plate, 'metric');
    expect(naivelyConverted).toBe(20.4);
    expect(platesFor('metric')).not.toContain(naivelyConverted);

    const native = computePlateLoad(toDisplayLoad(225, 'metric'), barFor('metric'), platesFor('metric'))!;
    for (const stack of native.perSide) {
      expect(platesFor('metric')).toContain(stack.plate);
    }
  });
});

describe('formatLoad', () => {
  it('joins the number and its unit in one place', () => {
    expect(formatLoad(225, 'us', 0)).toBe('225 lb');
    expect(formatLoad(100, 'metric')).toBe('45.4 kg');
  });
});

describe('the warm-up ladder is built in the display unit too', () => {
  it('ramps a 100 kg squat off a 20 kg bar', () => {
    const warm = generateWarmup(100, barFor('metric'), platesFor('metric'));
    // First rung is always the empty bar — and it is the METRIC bar.
    expect(warm[0].weight).toBe(20);
    // Every rung has to be a weight this rack can actually build.
    for (const w of warm) {
      const solved = computePlateLoad(w.weight, barFor('metric'), platesFor('metric'))!;
      expect(solved.achievable).toBe(w.weight);
    }
    expect(warm[warm.length - 1].weight).toBeLessThan(100);
  });

  it('is why the ladder cannot be generated in pounds and shown in kg', () => {
    // The defect the device caught: the panel read `45 x 10` (a pound bar)
    // directly under `WORKING SET · 100 KG`.
    const inPounds = generateWarmup(220, barFor('us'), platesFor('us'));
    expect(inPounds[0].weight).toBe(45);
    expect(generateWarmup(100, barFor('metric'), platesFor('metric'))[0].weight).toBe(20);
  });
});
