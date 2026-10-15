import { toOnboardingV2Patch } from './firestore-writers';
import type { GoalDirection } from './macro-heuristic';
import type { OnboardingV2Submission, Profile } from './types';

/**
 * The profile as it will read AFTER an onboarding save — the patch the save
 * writes, applied in memory.
 *
 * ## Why the plan step needs this (2026-10-15)
 *
 * The plan step used to show the onboarding SEED: Mifflin × activity minus
 * the pace, or weight × a constant. For a first run that is the number saved.
 * For a redo it usually is not — an 'auto' redo writes no seed, so the target
 * after Save is whatever the chain computes from this user's measured
 * history, and a 'custom' user's own numbers win over both. The owner's redo
 * showed 2,110 kcal / 110 g against a real outcome of 1,850 / 140. A plan step
 * may only show what Save will do, so it is computed from the SAME patch the
 * save writes rather than from a second opinion about it.
 */
export function profileAfterOnboarding(
  profile: Profile,
  submission: OnboardingV2Submission,
  now: Date = new Date(),
): Profile {
  const REMOVE = Symbol('remove');
  const patch = toOnboardingV2Patch(submission, { timestamp: (d: Date) => d, remove: () => REMOVE }, now);
  const out: Record<string, unknown> = { ...profile };
  for (const [key, value] of Object.entries(patch)) {
    if (value === REMOVE) delete out[key];
    else out[key] = value;
  }
  return out as unknown as Profile;
}

/**
 * Why a goal weight cannot go with this goal, or null when it can.
 *
 * A "lose" goal at or above the current weight (or "gain" at or below it) was
 * accepted, and Body's goal-progress bar then measured toward a line on the
 * wrong side. Only the direction is checked here; the plausible band is
 * `weightInBand`'s, and "maintain" has no goal weight at all.
 */
export function goalWeightIssue(
  goal: GoalDirection | null,
  currentLb: number | null | undefined,
  goalLb: number | null | undefined,
): 'notBelow' | 'notAbove' | null {
  if (goal == null || currentLb == null || goalLb == null) return null;
  if (goal === 'lose' && goalLb >= currentLb) return 'notBelow';
  if (goal === 'gain' && goalLb <= currentLb) return 'notAbove';
  return null;
}
