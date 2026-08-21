import { useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type Profile,
  type ProfileFields,
  type TdeeResult,
  dailyTargets,
  toProfileFields,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

// Deliberately wider than the coach's own window: the adaptive-TDEE math below
// needs a long series, and `buildCoachSystemInstruction` trims to
// COACH_WINDOW_DAYS itself. Until 2026-08-12 it did NOT trim, so all 400 rows
// (~100 days) went into the prompt and were announced to the model as "400
// days" — the mirror image of the web app shipping a 14-ROW cache as "14 days".
const LOG_WINDOW = 400;

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
 * completed profile, and the adaptive-TDEE output. Subscribes independently
 * (per-hook duplication is the app's precedent — the same collections back
 * other tabs) so the Coach screen needs no shared context.
 */
export function useCoach(): CoachData {
  const { user } = useAuth();
  const uid = user?.uid;
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!uid) return;
    setLoading(true);
    const unsubs = [
      subscribeRecentLogs(uid, LOG_WINDOW, (l) => { setLogs(l); setLoading(false); }, () => setLoading(false)),
      subscribeDailyWeights(uid, setWeights, () => {}),
      subscribeProfile(uid, setProfile, () => {}),
    ];
    return () => unsubs.forEach((u) => u());
  }, [uid]);

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

  return { loading, logs, tdee, profile: profileFields, dailyWeights: weights };
}
