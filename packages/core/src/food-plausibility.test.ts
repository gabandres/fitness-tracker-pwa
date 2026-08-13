import { describe, expect, it } from 'vitest';
import {
  KCAL_PER_100G_MAX,
  assessMacros,
  atwaterKcal,
  isLoggableFood,
  trustForDataType,
  trustRank,
} from './food-plausibility';

/**
 * Every case below is a real food or a real Open Food Facts failure, not a
 * synthetic edge. The thresholds are only defensible if they keep actual
 * groceries and drop actual junk, so the tests are written as that claim.
 */

describe('atwaterKcal', () => {
  it('is null when no macro is known — there is nothing to reconcile against', () => {
    expect(atwaterKcal({ kcal: 100 })).toBeNull();
    expect(atwaterKcal({ kcal: 100, protein: null, carb: null, fat: null })).toBeNull();
  });

  it('computes from whatever macros exist, treating the rest as zero', () => {
    // One known macro is enough to bound the energy: 100 g of fat cannot be
    // 50 kcal, whatever the missing fields say.
    expect(atwaterKcal({ kcal: 884, fat: 100 })).toBe(900);
    expect(atwaterKcal({ kcal: 400, protein: 25, carb: 50, fat: 5 })).toBe(345);
  });
});

describe('assessMacros — real foods must survive', () => {
  it.each([
    ['olive oil', { kcal: 884, protein: 0, carb: 0, fat: 100 }],
    ['table sugar', { kcal: 400, protein: 0, carb: 100, fat: 0 }],
    ['chicken breast, raw', { kcal: 120, protein: 22.5, carb: 0, fat: 2.6 }],
    ['whole milk', { kcal: 61, protein: 3.2, carb: 4.8, fat: 3.3 }],
    ['almonds', { kcal: 579, protein: 21, carb: 22, fat: 50 }],
    ['white rice, cooked', { kcal: 130, protein: 2.7, carb: 28, fat: 0.3 }],
    ['diet soda', { kcal: 0, protein: 0, carb: 0, fat: 0 }],
    ['egg white', { kcal: 52, protein: 11, carb: 0.7, fat: 0.2 }],
  ])('accepts %s', (_label, macros) => {
    expect(assessMacros(macros).verdict).toBe('ok');
  });

  it('accepts a high-fibre cereal, which reads light against Atwater', () => {
    // Fibre sits inside carbohydrate but yields ~2 kcal/g, not 4. Estimate 372,
    // label 250 — a ratio of 0.67, and entirely correct.
    const verdict = assessMacros({ kcal: 250, protein: 13, carb: 80, fat: 4 });
    expect(verdict.verdict).toBe('ok');
  });
});

describe('assessMacros — the errors that actually appear in crowd data', () => {
  it('rejects kilojoules typed into the kcal field', () => {
    // The dominant OFF defect: 1 kcal = 4.184 kJ, so a 100 kcal yogurt arrives
    // claiming 418 and would blow a day's budget in one tap.
    const yogurt = { kcal: 418, protein: 5, carb: 12, fat: 3 };
    const v = assessMacros(yogurt);
    expect(v.verdict).toBe('reject');
    expect(v.reason).toBe('energy-far-above-macros');
    expect(v.atwaterRatio).toBeGreaterThan(4);
  });

  it('rejects energy no food can carry', () => {
    expect(assessMacros({ kcal: 2400, protein: 8, carb: 60, fat: 10 })).toMatchObject({
      verdict: 'reject',
      reason: 'kcal-impossible',
    });
    expect(assessMacros({ kcal: KCAL_PER_100G_MAX + 1 }).verdict).toBe('reject');
  });

  it('rejects macros that outweigh the food', () => {
    expect(assessMacros({ kcal: 400, protein: 60, carb: 60, fat: 30 })).toMatchObject({
      verdict: 'reject',
      reason: 'macros-exceed-mass',
    });
    // A single impossible macro, even when the sum would pass.
    expect(assessMacros({ kcal: 400, protein: 200, carb: 0, fat: 0 }).reason).toBe(
      'macros-exceed-mass',
    );
  });

  it('rejects negative and non-finite energy', () => {
    expect(assessMacros({ kcal: -10 }).reason).toBe('kcal-negative');
    expect(assessMacros({ kcal: Number.NaN }).reason).toBe('kcal-not-finite');
  });
});

describe('the asymmetry — too light is suspect, too heavy is rejected', () => {
  it('keeps a sugar-alcohol product, which reads far too light', () => {
    // Erythritol is ~0.2 kcal/g and is reported inside carbohydrate, so keto
    // bars and diet chocolate legitimately look impossible-light. Rejecting
    // them would delete a whole category of real food from search.
    const ketoBar = { kcal: 90, protein: 10, carb: 40, fat: 8 };
    const v = assessMacros(ketoBar);
    expect(v.verdict).toBe('suspect');
    expect(v.reason).toBe('energy-below-macros');
    expect(isLoggableFood(ketoBar)).toBe(true);
  });

  it('rejects the mirror-image error at the same distance', () => {
    // Same ratio, other direction — and this one has no honest explanation.
    expect(assessMacros({ kcal: 900, protein: 10, carb: 40, fat: 8 }).verdict).toBe('reject');
  });

  it('demotes a mild overstatement without hiding it', () => {
    const v = assessMacros({ kcal: 200, protein: 5, carb: 20, fat: 2 }); // ratio ~1.6
    expect(v.verdict).toBe('suspect');
    expect(v.reason).toBe('energy-above-macros');
  });

  it('demotes a food with no macros at all, but keeps it loggable', () => {
    const v = assessMacros({ kcal: 150 });
    expect(v.verdict).toBe('suspect');
    expect(v.reason).toBe('macros-missing');
    expect(isLoggableFood({ kcal: 150 })).toBe(true);
  });

  it('treats energy with all-zero macros as suspect, not impossible', () => {
    // Spirits are the honest version of this (alcohol carries 7 kcal/g and is
    // not a macro), so it must not be a hard reject.
    expect(assessMacros({ kcal: 231, protein: 0, carb: 0, fat: 0 })).toMatchObject({
      verdict: 'suspect',
      reason: 'energy-above-macros',
    });
  });

  it('accepts a genuinely empty food', () => {
    expect(assessMacros({ kcal: 0, protein: 0, carb: 0, fat: 0 }).verdict).toBe('ok');
  });
});

describe('trust buckets', () => {
  it('separates a lab assay from curated data from a stranger typing', () => {
    expect(trustForDataType('foundation_food')).toBe('lab');
    expect(trustForDataType('sr_legacy_food')).toBe('reference');
    expect(trustForDataType('survey_fndds_food')).toBe('reference');
    expect(trustForDataType('OFF')).toBe('community');
  });

  it('treats anything unrecognised as community — down is the safe direction', () => {
    expect(trustForDataType(undefined)).toBe('community');
    expect(trustForDataType('something_new')).toBe('community');
  });

  it('ranks lab above reference above community', () => {
    expect(trustRank('lab')).toBeGreaterThan(trustRank('reference'));
    expect(trustRank('reference')).toBeGreaterThan(trustRank('community'));
  });
});
