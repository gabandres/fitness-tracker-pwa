import type { DocCodec } from './firestore-writers';
import { onboardingSeed } from './onboarding-seed';
import type { Profile } from './types';

/**
 * Maintenance mode — what the app becomes once the goal weight is reached
 * (retention lever 7, `STATUS.md` §3, 2026-09-02).
 *
 * ## What it is, stated once
 *
 * **Maintenance mode is `goalDirection === 'maintain'`. There is no second
 * flag.** A user who onboarded as "maintain" on day one and a user who reached
 * a cut goal and switched are in the same state, because the product asks the
 * same thing of both: eat around maintenance, keep an eye on the trend, and do
 * not treat a skipped day as a failure. A separate `maintenanceMode` field
 * would need a `firestore.rules` change and would then have to be kept in step
 * with the direction it duplicates — the "two fields for one goal weight" bug
 * `toOnboardingV2Patch` already had to clean up once.
 *
 * ## Why the switch exists as a one-tap action
 *
 * Reaching the goal used to change nothing. `goal-reached` went on record
 * (#110) and the target chain kept prescribing the deficit, forever, because
 * the pace and the direction are only ever written by the onboarding wizard —
 * which Settings → Edit goals reruns in full. A person who has arrived is asked
 * to sit through the plan they just finished to say "and now hold it". Week
 * 8–12 is where the category loses people who got what they came for; the
 * switch is one tap at the moment the trend crosses the line.
 *
 * ## What "looser logging" means here, and what it does NOT
 *
 * - The streak needs no loosening: `STREAK_FREEZE_MAX_GAP_PRO` (7 days) is
 *   already in force for everyone while `PRO_ENABLED` is false.
 * - Reminders get quieter (`planReminders`, `maintaining`): the streak-at-risk
 *   nudge is dropped — a streak is deficit-era pressure — and the day-3 lapsed
 *   nudge goes with it, leaving the day-7 one. Meal windows are the user's own
 *   setting and are untouched; the weigh-in nudge stays, because the trend is
 *   the one number that matters in maintenance.
 * - The daily target becomes maintenance itself: pace 0, and the target mode
 *   back to `'auto'` so a custom deficit number no longer overrides it.
 *
 * Nothing here celebrates, counts down, or grades. `UX_AUDIT.md` §S12 still
 * applies, and `milestones.ts` explains why.
 */

/** True when the profile's goal is to hold weight. Absent direction is not
 *  maintenance — every pre-v2 account has no direction and is a cut. */
export function isMaintaining(
  profile: Pick<Profile, 'goalDirection'> | null | undefined,
): boolean {
  return profile?.goalDirection === 'maintain';
}

/**
 * `users/{uid}` patch that moves a profile onto maintenance.
 *
 * Mirrors what an onboarding redo with "maintain" writes, minus the wizard:
 *
 * - `goalDirection: 'maintain'`, `targetPaceLbsPerWeek: 0` — the two inputs
 *   the target chain reads (`paceOffsetKcal` is zero for pace 0 whatever the
 *   direction, so both are set for the copy and the rules, not just the math).
 * - `targetMode: 'auto'` — a custom number typed for the cut would otherwise
 *   outrank everything, including the maintenance estimate the user just
 *   asked for. The stored custom values are left in place, as `targetMode`'s
 *   own contract promises, so switching back to custom restores them.
 * - The goal weight is CLEARED in both legacy fields, the same way the
 *   wizard clears them for "maintain" — a stale `goalWeightLbs` would keep the
 *   Body progress bar reading "reached" against a target that no longer
 *   exists.
 * - The onboarding seed is REWRITTEN for maintenance when the profile carries
 *   one, because in `'auto'` mode a stored seed outranks formula mode
 *   (`dailyTargets`, the third branch) — left alone, a 2-question-onboarded
 *   user would keep eating at the cut seed with "Maintain" in Settings. A
 *   profile with NO seed is left with none: writing one would hand a
 *   formula-mode user a heuristic they never had.
 *
 * `currentWeightLb` is what the seed is rebuilt from, and it is required
 * rather than optional: the only caller is the Body tab at the moment the
 * fitted trend crosses the goal, which cannot happen without weigh-ins.
 */
export function toMaintenanceSwitchPatch<TS>(
  profile: Profile,
  currentWeightLb: number,
  codec: DocCodec<TS>,
  now: Date = new Date(),
): Record<string, unknown> {
  const hasSeed = profile.manualCaloriesTarget != null && profile.manualCaloriesTarget > 0;
  const seed =
    hasSeed && Number.isFinite(currentWeightLb) && currentWeightLb > 0
      ? onboardingSeed({
          weightLbs: currentWeightLb,
          goal: 'maintain',
          sex: profile.sex,
          heightIn: profile.heightIn,
          age: profile.age,
          activityLevel: profile.activityLevel,
          calorieFloor: profile.calorieFloor,
        }).kcal
      : null;
  return {
    goalDirection: 'maintain',
    targetPaceLbsPerWeek: 0,
    targetMode: 'auto',
    targetWeightLbs: codec.remove(),
    goalWeightLbs: codec.remove(),
    ...(seed != null ? { manualCaloriesTarget: seed } : {}),
    lastSeenAt: codec.timestamp(now),
  };
}
