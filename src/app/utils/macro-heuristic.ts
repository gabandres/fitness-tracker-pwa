/**
 * Heuristic kcal + protein targets driven by current weight and goal
 * direction. Locked in Q10 of the UX revamp v2 plan.
 *
 *   kcal     = weight_lb × { 11 lose | 14 maintain | 17 gain }   → round to 10
 *   protein  = weight_lb × { 1.0 lose | 0.9 maintain | 0.8 gain }→ round to 5g
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

export const PROTEIN_MULTIPLIER: Record<GoalDirection, number> = {
  lose: 1.0,
  maintain: 0.9,
  gain: 0.8,
};

export const WEIGHT_MIN_LB = 60;
export const WEIGHT_MAX_LB = 700;

export function computeKcal(weightLb: number, goal: GoalDirection): number {
  return Math.round((weightLb * KCAL_MULTIPLIER[goal]) / 10) * 10;
}

export function computeProtein(weightLb: number, goal: GoalDirection): number {
  return Math.round((weightLb * PROTEIN_MULTIPLIER[goal]) / 5) * 5;
}
