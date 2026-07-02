import { useEffect, useMemo, useState } from 'react';
import {
  type DailyLog,
  type Profile,
  type ProfileFields,
  type TdeeResult,
  dailyTargets,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyWeights, subscribeProfile, subscribeRecentLogs } from '@/lib/ledger';

// The coach grounds on the same rolling window the web app uses. A wide log
// subscription is cheap (already cached by other tabs) and lets the prompt
// builder trim to its own 14-day view.
const LOG_WINDOW = 400;

export interface CoachData {
  loading: boolean;
  logs: DailyLog[];
  tdee: TdeeResult;
  /** Completed profile as ProfileFields, or null pre-onboarding. */
  profile: ProfileFields | null;
  dailyWeights: Record<string, number>;
}

/** Narrow a loosely-typed Profile to ProfileFields once onboarding is done and
 *  the load-bearing fields are present; else null (the prompt handles null). */
function toProfileFields(p: Profile | null): ProfileFields | null {
  if (
    !p || !p.profileCompleted ||
    p.heightIn == null || p.age == null || p.sex == null ||
    p.activityLevel == null || p.targetPaceLbsPerWeek == null
  ) {
    return null;
  }
  return {
    heightIn: p.heightIn,
    age: p.age,
    sex: p.sex,
    activityLevel: p.activityLevel,
    targetPaceLbsPerWeek: p.targetPaceLbsPerWeek,
    goalWeightLbs: p.goalWeightLbs,
  };
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
  const profileFields = useMemo(() => toProfileFields(profile), [profile]);

  return { loading, logs, tdee, profile: profileFields, dailyWeights: weights };
}
