/**
 * Is this food's nutrition data believable?
 *
 * ## Why this exists
 *
 * Ignia searches two databases. The bundled USDA set is lab-analyzed or
 * survey-curated and its numbers are trustworthy by construction. **Open Food
 * Facts is crowdsourced** — anyone can type a value — and it is where the
 * branded coverage comes from, so it cannot simply be dropped. That is the
 * exact weakness Cronometer markets against ("verified, not crowdsourced"), and
 * until now nothing in this app checked an OFF number at all: the search filter
 * asked only whether an energy value *existed*.
 *
 * The dominant real-world defect is not a subtle inaccuracy, it is an order of
 * magnitude. OFF's energy fields are `energy-kcal_100g` and `energy_100g`
 * (kilojoules), and contributors routinely put the kJ figure in the kcal field.
 * 1 kcal = 4.184 kJ, so a 100 kcal yogurt arrives claiming 418. Logging one
 * blows a day's budget in a single tap, and the user has no way to tell.
 *
 * ## The check
 *
 * Atwater: energy should be about `4·protein + 4·carb + 9·fat` per 100 g. Wildly
 * approximate as chemistry, and exactly right as a lie detector — the failure it
 * catches is a factor of four, not a factor of 1.1.
 *
 * ## The asymmetry, which is the important design decision here
 *
 * **Too much energy for the macros is rejected. Too little is only suspect.**
 * They are not the same error:
 *
 *   - **kcal far ABOVE the macros** has essentially one cause in this data — a
 *     unit mistake or a typo. Nothing edible carries energy the macros cannot
 *     account for; the Atwater factors are already the maximum.
 *   - **kcal far BELOW the macros** is routinely *correct*. Fibre is counted
 *     inside carbohydrate but yields ~2 kcal/g rather than 4, and sugar alcohols
 *     (erythritol ~0.2 kcal/g) are too — so keto bars, diet chocolate and
 *     high-fibre cereals legitimately look "too light". Rejecting those would
 *     delete a whole category of real food from search, which is a worse failure
 *     than showing a low number.
 *
 * So the band is deliberately lopsided, and a symmetric tolerance would be a
 * bug rather than a simplification.
 *
 * Pure and framework-free: both frontends and the Cloud Functions import it, and
 * every threshold below is exercised in `food-plausibility.test.ts`.
 */

/** Per-100 g macros as any of our sources express them. All optional but
 *  `kcal`, because a food with no energy value cannot be logged at all. */
export interface MacroSample {
  kcal: number;
  protein?: number | null;
  carb?: number | null;
  fat?: number | null;
}

/**
 * - `ok` — consistent, or with too little evidence to doubt it.
 * - `suspect` — usable, but ranked below anything `ok`. Never hidden: a
 *   suspect number the user recognises is better than an empty search.
 * - `reject` — not shown, and not loggable. Reserved for values that are
 *   impossible rather than merely odd.
 */
export type Plausibility = 'ok' | 'suspect' | 'reject';

export type PlausibilityReason =
  | 'kcal-not-finite'
  | 'kcal-negative'
  | 'kcal-impossible'
  | 'macros-exceed-mass'
  | 'energy-far-above-macros'
  | 'energy-above-macros'
  | 'energy-below-macros'
  | 'macros-missing';

export interface PlausibilityVerdict {
  verdict: Plausibility;
  reason?: PlausibilityReason;
  /** `kcal ÷ (4p + 4c + 9f)`, when it could be computed. Exposed for logging
   *  and tests, not for display — a ratio means nothing to a user. */
  atwaterRatio?: number;
}

/**
 * Hard ceiling on energy per 100 g.
 *
 * Pure fat is the most energy-dense edible substance at ~884 kcal/100 g. 900
 * leaves headroom for rounding and for oils reported slightly high; anything
 * beyond it is not a food, it is a unit error. (The kJ mistake lands around
 * 1,500–3,700 for ordinary products, comfortably outside.)
 */
export const KCAL_PER_100G_MAX = 900;

/** Macros cannot outweigh the food. 105 g per 100 g absorbs rounding and the
 *  common practice of reporting each macro independently rounded. */
const MACRO_MASS_MAX_G = 105;

/** Above this multiple of the Atwater estimate, the value is impossible. Set
 *  below the kJ/kcal factor of 4.184 with a wide margin, and above any
 *  legitimate excess — alcohol (7 kcal/g) is the only unmodelled energy source
 *  and cannot get a product anywhere near double. */
const ATWATER_REJECT_ABOVE = 2.0;

/** Above this, plausible but worth demoting. */
const ATWATER_SUSPECT_ABOVE = 1.25;

/** Below this, demote — but never reject. See the asymmetry note above. */
const ATWATER_SUSPECT_BELOW = 0.5;

/**
 * The Atwater energy estimate for a sample, or `null` when no macro is known.
 *
 * A single known macro is enough to compute one; that is deliberate. A product
 * listing 100 g of fat and nothing else still tells us it cannot be 50 kcal.
 */
export function atwaterKcal(m: MacroSample): number | null {
  const p = num(m.protein);
  const c = num(m.carb);
  const f = num(m.fat);
  if (p == null && c == null && f == null) return null;
  return 4 * (p ?? 0) + 4 * (c ?? 0) + 9 * (f ?? 0);
}

/**
 * Judge one food's per-100 g numbers.
 *
 * Order matters: the impossible cases are checked before the merely
 * inconsistent ones, so a reason always names the worst thing found rather than
 * the first.
 */
export function assessMacros(m: MacroSample): PlausibilityVerdict {
  if (!Number.isFinite(m.kcal)) return { verdict: 'reject', reason: 'kcal-not-finite' };
  if (m.kcal < 0) return { verdict: 'reject', reason: 'kcal-negative' };
  if (m.kcal > KCAL_PER_100G_MAX) return { verdict: 'reject', reason: 'kcal-impossible' };

  const p = num(m.protein);
  const c = num(m.carb);
  const f = num(m.fat);
  for (const v of [p, c, f]) {
    if (v != null && (v < 0 || v > MACRO_MASS_MAX_G)) {
      return { verdict: 'reject', reason: 'macros-exceed-mass' };
    }
  }
  if ((p ?? 0) + (c ?? 0) + (f ?? 0) > MACRO_MASS_MAX_G) {
    return { verdict: 'reject', reason: 'macros-exceed-mass' };
  }

  const estimate = atwaterKcal(m);
  // No macros at all: nothing to reconcile against. Common for drinks and for
  // sparse OFF entries, and not itself a reason to hide the food — but it is a
  // reason to rank it below a food whose numbers add up.
  if (estimate == null) return { verdict: 'suspect', reason: 'macros-missing' };

  // A zero estimate with real energy is the same unit error in its purest form
  // (all macros zero, hundreds of kcal). Pure alcohol is the one honest case and
  // it is not something this app can price anyway.
  if (estimate === 0) {
    if (m.kcal === 0) return { verdict: 'ok', atwaterRatio: 1 };
    return { verdict: 'suspect', reason: 'energy-above-macros' };
  }

  const ratio = m.kcal / estimate;
  if (ratio > ATWATER_REJECT_ABOVE) {
    return { verdict: 'reject', reason: 'energy-far-above-macros', atwaterRatio: ratio };
  }
  if (ratio > ATWATER_SUSPECT_ABOVE) {
    return { verdict: 'suspect', reason: 'energy-above-macros', atwaterRatio: ratio };
  }
  if (ratio < ATWATER_SUSPECT_BELOW) {
    // Fibre and sugar alcohols land here legitimately — demoted, never dropped.
    return { verdict: 'suspect', reason: 'energy-below-macros', atwaterRatio: ratio };
  }
  return { verdict: 'ok', atwaterRatio: ratio };
}

/** Convenience: may this food be shown and logged at all? */
export function isLoggableFood(m: MacroSample): boolean {
  return assessMacros(m).verdict !== 'reject';
}

/**
 * How much a source is trusted, independent of any individual number.
 *
 * Drives both ranking and what the user is shown. The three buckets are the
 * honest distinctions available: a lab assay, a curated reference/survey value,
 * and something a stranger typed.
 */
export type FoodTrust = 'lab' | 'reference' | 'community';

/**
 * Map a wire `dataType` onto a trust bucket.
 *
 * `foundation_food` is USDA's lab-analyzed set. `sr_legacy_food` and
 * `survey_fndds_food` are curated reference and survey data — good, not
 * measured per-sample. `OFF` is crowdsourced. Anything unrecognised is treated
 * as community: the safe direction to be wrong in is downward.
 */
export function trustForDataType(dataType: string | undefined): FoodTrust {
  switch (dataType) {
    case 'foundation_food':
      return 'lab';
    case 'sr_legacy_food':
    case 'survey_fndds_food':
      return 'reference';
    default:
      return 'community';
  }
}

/** Sort weight for a trust bucket — higher is better. */
export function trustRank(trust: FoodTrust): number {
  return trust === 'lab' ? 2 : trust === 'reference' ? 1 : 0;
}

function num(v: number | null | undefined): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
