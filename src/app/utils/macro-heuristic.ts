/**
 * Heuristic kcal + protein targets. Calories track weight and goal
 * direction; protein tracks body weight on the evidence-based g/kg
 * standard, independent of the calorie target.
 *
 *   kcal     = weight_lb × { 11 lose | 14 maintain | 17 gain }   → round to 10
 *   protein  = weight_kg × gPerKg (default 1.6, clamp 1.6–2.2)    → round to 5g
 *
 * Protein moved from a flat g/lb multiplier (lose = 1.0 g/lb ≈ 2.2 g/kg,
 * bodybuilder-tier) to g/kg with a 1.6 g/kg default — the muscle-retention
 * floor for a fat-loss cut. The basis is body weight only; it is no longer
 * coupled to the goal direction or to calories.
 *
 * Used by:
 *   - onboarding-v2 (authed, persists results)
 *   - /calculator (public, no persistence)
 *   - /macros/:goal/:weight programmatic SEO pages (public)
 */
export type GoalDirection = 'lose' | 'maintain' | 'gain';

export const KCAL_MULTIPLIER: Record<GoalDirection, number> = {
  lose: 11,
  maintain: 14,
  gain: 17,
};

const LB_PER_KG = 2.20462;

/** Muscle-retention floor on a cut; default protein target basis. */
export const DEFAULT_PROTEIN_G_PER_KG = 1.6;
export const PROTEIN_G_PER_KG_MIN = 1.6;
export const PROTEIN_G_PER_KG_MAX = 2.2;

export const WEIGHT_MIN_LB = 60;
export const WEIGHT_MAX_LB = 700;

export function computeKcal(weightLb: number, goal: GoalDirection): number {
  return Math.round((weightLb * KCAL_MULTIPLIER[goal]) / 10) * 10;
}

/**
 * Protein target from body weight on the g/kg standard. `gPerKg` is clamped
 * to [1.6, 2.2]; the 1.6 default suits general fat loss. Independent of the
 * calorie target and goal direction.
 */
export function computeProtein(
  weightLb: number,
  gPerKg: number = DEFAULT_PROTEIN_G_PER_KG,
): number {
  const clamped = Math.min(PROTEIN_G_PER_KG_MAX, Math.max(PROTEIN_G_PER_KG_MIN, gPerKg));
  const kg = weightLb / LB_PER_KG;
  return Math.round((kg * clamped) / 5) * 5;
}
