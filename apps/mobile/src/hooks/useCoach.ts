import { useMemo } from 'react';
import {
  type DailyLog,
  type ProfileFields,
  type TdeeResult,
  dailyTargets,
  toProfileFields,
} from '@macrolog/core';
import { useCoreSnapshot } from '@/hooks/useCoreSnapshot';

export interface CoachData {
  loading: boolean;
  logs: DailyLog[];
  tdee: TdeeResult;
  /** Completed profile as ProfileFields, or null pre-onboarding. */
  profile: ProfileFields | null;
  dailyWeights: Record<string, number>;
}

/**
 * Reactive data the AI coach grounds on: the recent log, per-day weights, the
 * completed profile, and the adaptive-TDEE output.
 *
 * Reads the shared core triple through {@link useCoreSnapshot} — its own
 * `onSnapshot` channels, per ADR-0016, just not its own copy of the wiring.
 * The window it used to declare locally was 400, the same number
 * `LOG_WINDOW_ROWS` has always held; it is deliberately wider than the coach's
 * own window because the adaptive-TDEE math needs a long series, and
 * `buildCoachSystemInstruction` trims to COACH_WINDOW_DAYS itself. Until
 * 2026-08-12 it did NOT trim, so all 400 rows (~100 days) went into the prompt
 * and were announced to the model as "400 days" — the mirror image of the web
 * app shipping a 14-ROW cache as "14 days".
 */
export function useCoach(): CoachData {
  const { logs, weights, profile, loaded } = useCoreSnapshot('Coach');

  const tdee = useMemo(() => dailyTargets(profile, logs, weights).tdee, [profile, logs, weights]);
  // Core's `toProfileFields` (the same narrowing `dailyTargets` uses) rather
  // than a local copy: this hook used to declare its own, which returned a
  // hard-coded 6-key literal and so silently dropped `calorieFloor`,
  // `proteinFloor`, `activityMultiplier` and `travelMode` — the coach prompt
  // was grounded on a different profile than the target math on the same
  // screen. The extra `profileCompleted` gate is this hook's own and stays:
  // the prompt wants a finished profile, where the TDEE math is happy with any
  // profile carrying the five anchor fields.
  const profileFields = useMemo(
    () => (profile?.profileCompleted ? toProfileFields(profile) : null),
    [profile],
  );

  return { loading: !loaded, logs, tdee, profile: profileFields, dailyWeights: weights };
}
