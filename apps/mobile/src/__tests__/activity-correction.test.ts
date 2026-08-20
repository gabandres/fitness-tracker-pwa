import { FEATURES } from '@/lib/features';
import { ACTIVITY_MULTIPLIERS, basalMifflinStJeor } from '@macrolog/core/tdee';
import {
  activityMultiplier,
  deriveActivityLevel,
  impliedMultiplier,
  reduceActivityWindow,
  snapMultiplier,
  suggestActivityLevel,
} from '@macrolog/core/activity-level';

/**
 * The activity correction, now LIVE in measured mode.
 *
 * It shipped dark on 2026-08-19 because the suggestion was worse than the
 * setting it replaced: the five-bucket ladder snapped a 1.279 implied
 * multiplier to `sedentary` (1.2), 17.9% below the account's own benchmark,
 * against a stored `moderate` that was 6.1% above it. Two changes unblocked it
 * — a continuous multiplier floored at the FAO/WHO/UNU free-living PAL of
 * 1.40, and a label derived from the value that is actually STORED rather than
 * the raw one.
 *
 * These tests pin the conditions that made it safe to turn on. If any of them
 * fails, the card is misleading again and should go back behind a flag.
 */

// The owner's real trailing window, read from Firestore 2026-08-19: 28 of 28
// usable days, mean activeKcal 246/day, mean steps 5,213.
const BASAL = basalMifflinStJeor({ heightIn: 68, age: 33, sex: 'male' }, 157);
const MEAN_ACTIVE_KCAL = 246;
const STORED_BUCKET = 'moderate' as const;
/** Plain energy balance over the account's 97-day gap-free run. */
const BENCHMARK = 2385;

const errVsBenchmark = (multiplier: number) => Math.abs((BASAL * multiplier) / BENCHMARK - 1);

describe('the correction is live and no longer flag-gated', () => {
  it('the dark flag is gone, not merely flipped', () => {
    // A flag that gates nothing is dead code that reads like a safeguard.
    expect('activityTdeeInMeasured' in FEATURES).toBe(false);
  });

  it('the feature kill-switch still exists — this removed a gate, not the brake', () => {
    expect(FEATURES.activityTdee).toBe(true);
  });
});

describe('what made it safe to show', () => {
  it('the suggestion is now BETTER than the stored setting, which is the whole bar', () => {
    const stored = errVsBenchmark(ACTIVITY_MULTIPLIERS[STORED_BUCKET]);
    const applied = errVsBenchmark(activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)!);
    expect(applied).toBeLessThan(stored);   // 4.2% vs 6.1%
    expect(applied).toBeLessThan(0.05);     // and inside the accepted target
  });

  it('the label names the value that gets stored, not the raw one', () => {
    // The copy bug. Naming the raw implied value said "sedentary" while the
    // stored 1.40 produces a target between light and moderate.
    expect(snapMultiplier(impliedMultiplier(MEAN_ACTIVE_KCAL, BASAL))).toBe('sedentary');
    expect(deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)).toBe('light');
  });

  it('the label and the stored number agree to within one rung', () => {
    // The invariant the copy depends on: whatever word the card says, the
    // number it stores must be the nearest thing that word can mean.
    const m = activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)!;
    const label = deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL);
    expect(Math.abs(ACTIVITY_MULTIPLIERS[label] - m)).toBeLessThan(0.0875); // half a rung
  });

  it('a lost multiplier degrades to a bucket that is still defensible', () => {
    // The bucket is the fallback if `activityMultiplier` is ever absent.
    // Under the old label it would have been sedentary — worse than doing
    // nothing at all.
    const fallback = ACTIVITY_MULTIPLIERS[deriveActivityLevel(MEAN_ACTIVE_KCAL, BASAL)];
    expect(errVsBenchmark(fallback)).toBeLessThan(errVsBenchmark(ACTIVITY_MULTIPLIERS.sedentary));
    expect(errVsBenchmark(fallback)).toBeLessThan(0.07);
  });

  it('still fires for this account — the deadband did not swallow it', () => {
    // The deadband is scored on the RAW implied value (gap 0.271, fires) while
    // the label uses the clamped one (move 0.15, inside the deadband). Scoring
    // it on the clamped value would silently suppress the card.
    const window = Array.from({ length: 28 }, () => MEAN_ACTIVE_KCAL);
    expect(reduceActivityWindow(window)).toEqual({ mean: MEAN_ACTIVE_KCAL, usableDays: 28 });
    expect(
      suggestActivityLevel({
        activeKcals: window,
        basalKcal: BASAL,
        currentBucket: STORED_BUCKET,
        declinedBucket: null,
      }),
    ).toBe('light');
  });

  it('settles after acceptance instead of re-suggesting forever', () => {
    // Once the user is on the suggested bucket the card must stop appearing,
    // or a "correction" becomes a permanent nag.
    expect(
      suggestActivityLevel({
        activeKcals: Array.from({ length: 28 }, () => MEAN_ACTIVE_KCAL),
        basalKcal: BASAL,
        currentBucket: 'light',
        declinedBucket: null,
      }),
    ).toBeNull();
  });

  it('the burn the card promises is the burn the accept flow stores', () => {
    // Trends computes the headline figure from `activityMultiplier`, and
    // refine-targets stores the value from the same function on the same
    // inputs. If these ever diverge the card lies about its own outcome.
    const m = activityMultiplier(MEAN_ACTIVE_KCAL, BASAL)!;
    // 1,631.6 bare Mifflin x 1.40. Asserted exactly, because a drift here
    // means the card's headline and the stored value have come apart.
    expect(Math.round(BASAL * m)).toBe(2284);
  });
});
