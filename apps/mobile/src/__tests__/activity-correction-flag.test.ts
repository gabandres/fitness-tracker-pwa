import { FEATURES } from '@/lib/features';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor } from '@macrolog/core/tdee';
import {
  deriveActivityLevel,
  impliedMultiplier,
  reduceActivityWindow,
  suggestActivityLevel,
} from '@macrolog/core/activity-level';

/**
 * Step 2 is built and DARK on purpose.
 *
 * The activity-correction card is shipped and correct for pre-measured users.
 * What this flag opens is (a) the same card in MEASURED mode, now that the
 * Mifflin x activity anchor feeds measured-mode targets via
 * `measuredConfidence`, and (b) the evidence line under the suggestion.
 *
 * It is off because on the account this was measured against the suggestion is
 * currently WORSE than the bucket already stored. These tests pin both halves:
 * that it is off, and WHY — so the day someone flips it, the reason it was off
 * either still reproduces or has genuinely been fixed.
 */
describe('activityTdeeInMeasured is dark, and the numbers say why', () => {
  it('is OFF', () => {
    // Flipping this is the LAST step of the continuous-multiplier work, not a
    // tidy-up. Read the flag comment in src/lib/features.ts first.
    expect(FEATURES.activityTdeeInMeasured).toBe(false);
  });

  it('the pre-measured card is untouched — the shipped cohort still has it', () => {
    expect(FEATURES.activityTdee).toBe(true);
  });

  // The owner's real trailing window, read from Firestore 2026-08-19:
  // 28 of 28 usable days, mean activeKcal 246, mean steps 5,213.
  const BASAL = basalMifflinStJeor({ heightIn: 68, age: 33, sex: 'male' }, 157);
  const MEAN_ACTIVE_KCAL = 246;
  const STORED = 'moderate' as const;
  /** Plain energy balance over the account's 97-day gap-free run. */
  const BENCHMARK = 2385;

  it('reproduces the suggestion that makes this unsafe to show', () => {
    const m = impliedMultiplier(MEAN_ACTIVE_KCAL, BASAL);
    expect(m).toBeCloseTo(1.278, 2);

    // The ladder cannot express 1.278. Its rungs are 0.175 apart and the value
    // sits 0.0095 below the sedentary/light midpoint (1.2875), so it snaps
    // DOWN on a near-tie.
    expect(deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)).toBe('sedentary');
  });

  it('the suggestion would be WORSE than the stored bucket', () => {
    const suggested = deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL);
    const errSuggested = Math.abs(BASAL * ACTIVITY_MULTIPLIERS[suggested] / BENCHMARK - 1);
    const errStored = Math.abs(BASAL * ACTIVITY_MULTIPLIERS[STORED] / BENCHMARK - 1);

    expect(errSuggested).toBeGreaterThan(errStored);   // ~17.9% vs ~6.0%
    expect(errSuggested).toBeGreaterThan(0.15);
    expect(errStored).toBeLessThan(0.07);
  });

  it('the mechanism itself works — it is the ladder that is wrong, not the wiring', () => {
    // Worth pinning separately: if this ever returns null the card would be
    // dark for a second, unrelated reason and the flag test above would go
    // quietly vacuous.
    const window = Array.from({ length: 28 }, () => MEAN_ACTIVE_KCAL);
    expect(reduceActivityWindow(window)).toEqual({ mean: MEAN_ACTIVE_KCAL, usableDays: 28 });
    expect(
      suggestActivityLevel({
        activeKcals: window,
        basalKcal: BASAL,
        currentBucket: STORED,
        declinedBucket: null,
      }),
    ).toBe('sedentary');
  });

  it('states the acceptance test for unflagging, in numbers', () => {
    // d(damped)/dc = measured - anchor. Better logging raises the estimate
    // only when the anchor sits BELOW the measured value. Today it does not.
    const measuredAtWindow42 = 2267;
    const anchorToday = BASAL * ACTIVITY_MULTIPLIERS[STORED];
    expect(anchorToday).toBeGreaterThan(measuredAtWindow42); // => gradient negative
  });
});
